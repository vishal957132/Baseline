/**
 * The upload queue.
 *
 * Ops live in lanes — `weight:2026-09-21`. Order is guaranteed inside a lane
 * and never across them, so a stuck weight upload cannot hold up an unrelated
 * water change.
 *
 * Two implementations of one interface: `sqliteOutbox` for the app,
 * `memoryOutbox` for tests and the demo. op-sqlite is a native module that
 * cannot load under Jest, so the SQL type below is structural — the real DB
 * satisfies it without this file importing it.
 */

export type OpStatus = 'pending' | 'sending' | 'failed' | 'dead' | 'conflict';

export interface Op {
  id: string;
  laneKey: string;
  lineageId: string;
  localSeq: number;
  kind: 'create' | 'update' | 'delete';
  payload: string;
  status: OpStatus;
  attempts: number;
  nextAttemptAt: number | null;
}

/**
 * Reading and retiring queued work.
 *
 * There is no enqueue here on purpose: ops are written by `measurementRepo`,
 * in the same transaction as the measurement and its audit event. A second
 * insert path outside that transaction could leave a change that never syncs.
 */
export interface Outbox {
  /** Lanes whose head op is sendable right now. */
  readyLanes(now: number): Promise<string[]>;
  /**
   * A lane's head op — lowest localSeq — if it is sendable, marked `sending`.
   *
   * Only ever the head. If the head is backing off, dead, or waiting on a
   * conflict, the lane yields nothing: that is what "held behind op 1 in this
   * lane" means. Skipping to the next op would apply an edit before its create.
   */
  claimNext(laneKey: string, now: number): Promise<Op | null>;
  complete(opId: string): Promise<void>;
  /** `nextAttemptAt: null` means give up — the lane is dead-lettered. */
  fail(opId: string, nextAttemptAt: number | null): Promise<void>;
  markConflict(opId: string): Promise<void>;
  /**
   * Put a blocked lane back in play — resets its dead and conflicted ops to
   * pending. Backs the Sync screen's "Retry this lane" and conflict resolution.
   */
  retryLane(laneKey: string): Promise<void>;
  /**
   * Drop un-sent ops for a lineage and report what was dropped.
   *
   * One primitive, two features: the five-second undo, and deleting an entry
   * whose create never reached the server (design page 07).
   */
  cancelPendingOp(lineageId: string): Promise<string[]>;
  all(): Promise<Op[]>;
}

/** Only what this file needs. op-sqlite's DB satisfies it structurally. */
export interface SqlDb {
  execute(
    sql: string,
    params?: (string | number | null)[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

const COLUMNS =
  'id, lane_key, lineage_id, local_seq, kind, payload, status, attempts, next_attempt_at';

function toOp(r: Record<string, unknown>): Op {
  return {
    id: String(r.id),
    laneKey: String(r.lane_key),
    lineageId: String(r.lineage_id),
    localSeq: Number(r.local_seq),
    kind: String(r.kind) as Op['kind'],
    payload: String(r.payload),
    status: String(r.status) as OpStatus,
    attempts: Number(r.attempts),
    nextAttemptAt: r.next_attempt_at == null ? null : Number(r.next_attempt_at),
  };
}

/** Ops still in play. `pending` and `failed` can be sent; the others block. */
const LIVE = "status IN ('pending', 'failed', 'sending', 'dead', 'conflict')";

/** A head op that may be sent right now. */
const SENDABLE = `status IN ('pending', 'failed')
  AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`;

/** The head of a lane: its lowest-localSeq op still in play. */
const IS_HEAD = `local_seq = (SELECT MIN(local_seq) FROM outbox WHERE lane_key = ? AND ${LIVE})`;

export function sqliteOutbox(db: SqlDb): Outbox {
  return {
    async readyLanes(now) {
      const { rows } = await db.execute(
        `SELECT lane_key FROM outbox o
         WHERE ${SENDABLE}
           AND local_seq = (SELECT MIN(local_seq) FROM outbox
                            WHERE lane_key = o.lane_key AND ${LIVE})
         ORDER BY local_seq`,
        [now],
      );
      return rows.map(r => String(r.lane_key));
    },

    async claimNext(laneKey, now) {
      const { rows } = await db.execute(
        `SELECT ${COLUMNS} FROM outbox
         WHERE lane_key = ? AND ${SENDABLE} AND ${IS_HEAD}
         LIMIT 1`,
        [laneKey, now, laneKey],
      );
      if (rows.length === 0) return null;
      const op = toOp(rows[0]);
      await db.execute("UPDATE outbox SET status = 'sending' WHERE id = ?", [op.id]);
      return { ...op, status: 'sending' };
    },

    async complete(opId) {
      await db.execute('DELETE FROM outbox WHERE id = ?', [opId]);
    },

    async fail(opId, nextAttemptAt) {
      await db.execute(
        `UPDATE outbox
         SET status = ?, attempts = attempts + 1, next_attempt_at = ?
         WHERE id = ?`,
        [nextAttemptAt === null ? 'dead' : 'failed', nextAttemptAt, opId],
      );
    },

    async markConflict(opId) {
      await db.execute("UPDATE outbox SET status = 'conflict' WHERE id = ?", [opId]);
    },

    async retryLane(laneKey) {
      await db.execute(
        `UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = NULL
         WHERE lane_key = ? AND status IN ('dead', 'conflict')`,
        [laneKey],
      );
    },

    async cancelPendingOp(lineageId) {
      const { rows } = await db.execute(
        `SELECT id FROM outbox
         WHERE lineage_id = ? AND status IN ('pending', 'failed')`,
        [lineageId],
      );
      const ids = rows.map(r => String(r.id));
      for (const id of ids) {
        await db.execute('DELETE FROM outbox WHERE id = ?', [id]);
      }
      return ids;
    },

    async all() {
      const { rows } = await db.execute(
        `SELECT ${COLUMNS} FROM outbox ORDER BY local_seq`,
      );
      return rows.map(toOp);
    },
  };
}

/** Same behaviour, an array instead of a table. Used by tests and the demo. */
export function memoryOutbox(seed: Op[] = []): Outbox {
  let ops = [...seed];

  const sendable = (o: Op, now: number) =>
    (o.status === 'pending' || o.status === 'failed') &&
    (o.nextAttemptAt === null || o.nextAttemptAt <= now);

  /** The lane's lowest-localSeq op. Nothing behind it may be sent. */
  const head = (laneKey: string) =>
    ops
      .filter(o => o.laneKey === laneKey)
      .sort((a, b) => a.localSeq - b.localSeq)[0];

  return {
    async readyLanes(now) {
      const lanes = [...new Set(ops.map(o => o.laneKey))];
      return lanes.filter(lane => {
        const first = head(lane);
        return first !== undefined && sendable(first, now);
      });
    },
    async claimNext(laneKey, now) {
      const first = head(laneKey);
      if (!first || !sendable(first, now)) return null;
      first.status = 'sending';
      return { ...first };
    },
    async complete(opId) {
      ops = ops.filter(o => o.id !== opId);
    },
    async fail(opId, nextAttemptAt) {
      const op = ops.find(o => o.id === opId);
      if (!op) return;
      op.status = nextAttemptAt === null ? 'dead' : 'failed';
      op.attempts += 1;
      op.nextAttemptAt = nextAttemptAt;
    },
    async markConflict(opId) {
      const op = ops.find(o => o.id === opId);
      if (op) op.status = 'conflict';
    },
    async retryLane(laneKey) {
      for (const op of ops) {
        if (op.laneKey === laneKey && (op.status === 'dead' || op.status === 'conflict')) {
          op.status = 'pending';
          op.attempts = 0;
          op.nextAttemptAt = null;
        }
      }
    },
    async cancelPendingOp(lineageId) {
      const doomed = ops.filter(
        o => o.lineageId === lineageId && (o.status === 'pending' || o.status === 'failed'),
      );
      ops = ops.filter(o => !doomed.includes(o));
      return doomed.map(o => o.id);
    },
    async all() {
      return [...ops].sort((a, b) => a.localSeq - b.localSeq);
    },
  };
}
