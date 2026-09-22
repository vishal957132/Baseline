/**
 * Everything the app does to the measurements table.
 *
 * The one rule worth knowing: a user-visible change is three writes — the
 * measurement row, the audit event, and the outbox op — and they commit in one
 * transaction. If the row landed but the outbox op did not, the change would be
 * silently never synced and nothing in the UI could detect it.
 *
 * Queries are added when a screen needs them, not in advance.
 */

import { metric as descriptor } from '../domain/metrics';
import { laneKey as makeLaneKey } from '../domain/time';
import type {
  Conflict,
  DayBucket,
  EventKind,
  Measurement,
  MeasurementEvent,
  MetricId,
  SourceId,
} from '../domain/types';
import { bucketSql } from './bucketSql';
import { IMPORT_UPSERT_SQL } from './importSql';
import { resolve, type Candidate } from '../sync/conflict';
import { notifyDataChanged } from './changes';
import { getDb, nextLocalSeq } from './db';

const COLUMNS = `id, lineage_id, lane_key, metric, value, unit, recorded_at,
  updated_at, source, external_id, server_seq, local_seq, deleted_at`;

type Row = Record<string, unknown>;

function toMeasurement(r: Row): Measurement {
  return {
    id: String(r.id),
    lineageId: String(r.lineage_id),
    laneKey: String(r.lane_key),
    metric: String(r.metric) as MetricId,
    value: Number(r.value),
    unit: String(r.unit),
    recordedAt: Number(r.recorded_at),
    updatedAt: Number(r.updated_at),
    source: String(r.source) as SourceId,
    externalId: r.external_id == null ? null : String(r.external_id),
    serverSeq: r.server_seq == null ? null : Number(r.server_seq),
    localSeq: Number(r.local_seq),
    deletedAt: r.deleted_at == null ? null : Number(r.deleted_at),
  };
}

// ── reads ────────────────────────────────────────────────────────────────────

/** Readings in a half-open window, newest first. */
export async function listRange(
  metricId: MetricId,
  from: number,
  to: number,
): Promise<Measurement[]> {
  // recorded_at is compared bare so (metric, recorded_at) serves it. Wrapping
  // it in arithmetic here would silently turn this into a full scan.
  const { rows } = await getDb().execute(
    `SELECT ${COLUMNS} FROM measurements
     WHERE metric = ? AND recorded_at >= ? AND recorded_at < ?
       AND deleted_at IS NULL
     ORDER BY recorded_at DESC`,
    [metricId, from, to],
  );
  return (rows as Row[]).map(toMeasurement);
}

/** One point per local day. `buckets.length` is the days-with-data count. */
export async function bucketByDay(
  metricId: MetricId,
  from: number,
  to: number,
  tzOffsetMs: number,
): Promise<DayBucket[]> {
  const sql = bucketSql(descriptor(metricId).aggregate);
  const { rows } = await getDb().execute(sql, [tzOffsetMs, metricId, from, to]);
  return (rows as Row[]).map(r => ({
    day: Number(r.day),
    value: Number(r.value),
    count: Number(r.count),
  }));
}

/**
 * One page of History, newest first. Keyset rather than OFFSET, which degrades
 * with depth — the wrong shape for a list that grows for years.
 */
export async function historyPage(
  before: number,
  limit: number,
  metricId?: MetricId,
): Promise<Measurement[]> {
  const filter = metricId ? 'metric = ? AND ' : '';
  const params = metricId ? [metricId, before, limit] : [before, limit];
  const { rows } = await getDb().execute(
    `SELECT ${COLUMNS} FROM measurements
     WHERE ${filter}recorded_at < ? AND deleted_at IS NULL
     ORDER BY recorded_at DESC LIMIT ?`,
    params,
  );
  return (rows as Row[]).map(toMeasurement);
}

/** Lanes needing a decision. A conflict is always scoped to one lane. */
export async function openConflicts(): Promise<Conflict[]> {
  const { rows } = await getDb().execute(
    `SELECT id, lane_key, candidate_ids, suggested_id, chosen_id, resolved_at
     FROM conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC`,
  );
  return (rows as Row[]).map(r => ({
    id: String(r.id),
    laneKey: String(r.lane_key),
    candidateIds: JSON.parse(String(r.candidate_ids)) as string[],
    suggestedId: String(r.suggested_id),
    chosenId: r.chosen_id == null ? null : String(r.chosen_id),
    resolvedAt: r.resolved_at == null ? null : Number(r.resolved_at),
  }));
}

/**
 * Bring in a batch of readings from a health provider.
 *
 * Imports never enqueue an outbox op: they came *from* outside, so there is
 * nothing to push back. Idempotency is the `(source, external_id)` unique
 * index — replaying the same batch updates rather than duplicating, which is
 * what makes a re-import safe.
 *
 * @returns how many rows were written, and which lanes now need a decision.
 */
export async function importMeasurements(
  readings: Array<{
    externalId: string;
    metric: MetricId;
    value: number;
    recordedAt: number;
    source: SourceId;
  }>,
  ctx: { tzOffsetMs: number; now: number },
): Promise<{ imported: number; conflicts: number }> {
  if (readings.length === 0) return { imported: 0, conflicts: 0 };

  const lanes = new Set<string>();

  await inTransaction(async tx => {
    for (const r of readings) {
      const lane = makeLaneKey(r.metric, r.recordedAt, ctx.tzOffsetMs);
      lanes.add(lane);
      const seq = nextLocalSeq();
      // The provider's own id is the local id too, so the same sample always
      // lands on the same row however many times it arrives.
      const id = `${r.source}:${r.externalId}`;

      await exec(tx, {
        sql: IMPORT_UPSERT_SQL,
        params: [
          id, id, lane, r.metric, r.value, descriptor(r.metric).unit,
          r.recordedAt, ctx.now, r.source, r.externalId, seq,
        ],
      });

      await writeEvent(tx, {
        measurementId: id, lineageId: id, laneKey: lane,
        kind: 'import', value: r.value, source: r.source, seq, now: ctx.now,
      });
    }
  });

  // An import is the other way a typed reading falls into contention.
  let conflicts = 0;
  for (const lane of lanes) {
    if (await detectConflict(lane, ctx.now)) conflicts += 1;
  }

  notifyDataChanged();
  return { imported: readings.length, conflicts };
}

/** One reading, for the edit form to fill itself from. */
export async function measurementById(id: string): Promise<Measurement | null> {
  const { rows } = await getDb().execute(
    `SELECT ${COLUMNS} FROM measurements WHERE id = ?`,
    [id],
  );
  return rows.length > 0 ? toMeasurement(rows[0] as Row) : null;
}

export interface StorageStats {
  records: number;
  /** Earliest reading, or null when there are none. */
  since: number | null;
  bytes: number;
}

/**
 * What this device is actually holding.
 *
 * Real numbers rather than the design's illustrative ones — the Settings
 * screen claims "18,420 records · 4.2 MB", and a claim about storage should
 * be measured, not written.
 */
export async function storageStats(): Promise<StorageStats> {
  const db = getDb();
  const counted = await db.execute(
    `SELECT COUNT(*) AS n, MIN(recorded_at) AS since FROM measurements
     WHERE deleted_at IS NULL`,
  );
  const size = await db.execute(
    'SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()',
  );
  return {
    records: Number(counted.rows[0]?.n ?? 0),
    since: counted.rows[0]?.since == null ? null : Number(counted.rows[0].since),
    bytes: Number(size.rows[0]?.bytes ?? 0),
  };
}

/**
 * What actually happened in a lane, oldest first.
 *
 * This is the append-only log, not the current rows — which is the whole
 * reason it exists. A create followed by a correction is two entries here and
 * one candidate on the conflict screen, and only this can tell the user the
 * difference.
 */
export async function laneEvents(lane: string): Promise<MeasurementEvent[]> {
  const { rows } = await getDb().execute(
    `SELECT id, measurement_id, lineage_id, lane_key, kind, value, created_at,
            source, local_seq
     FROM measurement_events WHERE lane_key = ? ORDER BY local_seq`,
    [lane],
  );
  return (rows as Row[]).map(r => ({
    id: String(r.id),
    measurementId: String(r.measurement_id),
    lineageId: String(r.lineage_id),
    laneKey: String(r.lane_key),
    kind: String(r.kind) as MeasurementEvent['kind'],
    value: r.value == null ? null : Number(r.value),
    createdAt: Number(r.created_at),
    source: String(r.source) as SourceId,
    localSeq: Number(r.local_seq),
  }));
}

/** Live readings in a lane — what a conflict is decided between. */
export async function laneCandidates(lane: string): Promise<Measurement[]> {
  const { rows } = await getDb().execute(
    `SELECT ${COLUMNS} FROM measurements
     WHERE lane_key = ? AND deleted_at IS NULL
     ORDER BY local_seq`,
    [lane],
  );
  return (rows as Row[]).map(toMeasurement);
}

function toCandidate(m: Measurement): Candidate {
  return {
    id: m.id,
    lineageId: m.lineageId,
    value: m.value,
    source: m.source,
    serverSeq: m.serverSeq,
    localSeq: m.localSeq,
    recordedAt: m.recordedAt,
  };
}

/**
 * Raise a conflict if this lane now needs a decision.
 *
 * The rule itself lives in `sync/conflict` and is pure; this only feeds it the
 * lane's live readings and stores the answer. It asks only when something the
 * user typed is in contention — two imports merge silently, and two manual
 * readings are just two readings.
 *
 * @returns whether a conflict was raised.
 */
export async function detectConflict(
  lane: string,
  now: number,
): Promise<boolean> {
  // One open question per lane at a time. Re-asking the same one would stack
  // duplicates on the Sync screen.
  const existing = await openConflicts();
  if (existing.some(c => c.laneKey === lane)) return false;

  const rows = await laneCandidates(lane);
  if (rows.length < 2) return false;

  const outcome = resolve(rows.map(toCandidate));
  if (outcome.outcome !== 'ask') return false;

  await getDb().execute(
    `INSERT INTO conflicts
       (id, lane_key, candidate_ids, suggested_id, resolved_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [
      `cf-${lane}-${now}`,
      lane,
      JSON.stringify(outcome.candidates.map(c => c.id)),
      outcome.winner.id,
      now,
    ],
  );
  return true;
}

/**
 * Record the user's decision.
 *
 * The losers are soft-deleted, not destroyed: they stop counting as current
 * readings, so the chart and the dashboard follow the winner, but their rows
 * and their events remain — which is what "the rest stay in history" protects.
 * It also means the lane now holds one live reading, so detection does not
 * immediately ask the same question again.
 */
export async function resolveConflict(args: {
  conflictId: string;
  chosenId: string;
  laneKey: string;
  source: SourceId;
  now: number;
}): Promise<void> {
  const losers = (await laneCandidates(args.laneKey)).filter(
    m => m.id !== args.chosenId,
  );

  await inTransaction(async tx => {
    await exec(tx, {
      sql: `UPDATE conflicts SET chosen_id = ?, resolved_at = ? WHERE id = ?`,
      params: [args.chosenId, args.now, args.conflictId],
    });

    for (const loser of losers) {
      const seq = nextLocalSeq();
      await exec(tx, {
        sql: `UPDATE measurements SET deleted_at = ?, updated_at = ?, local_seq = ?
              WHERE id = ?`,
        params: [args.now, args.now, seq, loser.id],
      });
      await writeEvent(tx, {
        measurementId: loser.id,
        lineageId: loser.lineageId,
        laneKey: args.laneKey,
        kind: 'delete',
        value: loser.value,
        source: loser.source,
        seq,
        now: args.now,
      });
    }
  });

  notifyDataChanged();
}

// ── writes ───────────────────────────────────────────────────────────────────

export interface NewMeasurement {
  id: string;
  metric: MetricId;
  value: number;
  recordedAt: number;
  source: SourceId;
  tzOffsetMs: number;
  now: number;
}

/**
 * Add a reading. lineageId defaults to id — a create starts its own lineage,
 * and later edits keep it, which is what lets the conflict screen collapse
 * "recorded 72.8, then corrected to 72.6" into one candidate.
 */
export async function addMeasurement(m: NewMeasurement): Promise<void> {
  const lane = makeLaneKey(m.metric, m.recordedAt, m.tzOffsetMs);
  const seq = nextLocalSeq();

  await getDb().transaction(async tx => {
    await tx.execute(
      `INSERT INTO measurements (${COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
      [
        m.id, m.id, lane, m.metric, m.value, descriptor(m.metric).unit,
        m.recordedAt, m.now, m.source, seq,
      ],
    );
    await writeEvent(tx, {
      measurementId: m.id, lineageId: m.id, laneKey: lane,
      kind: 'create', value: m.value, source: m.source, seq, now: m.now,
    });
    await queueOp(tx, {
      lineageId: m.id, laneKey: lane, kind: 'create', seq, now: m.now,
      payload: { id: m.id, metric: m.metric, value: m.value, recordedAt: m.recordedAt },
    });
  });

  await detectConflict(lane, m.now);
  notifyDataChanged();
}

export async function editMeasurement(args: {
  id: string;
  lineageId: string;
  metric: MetricId;
  value: number;
  recordedAt: number;
  source: SourceId;
  tzOffsetMs: number;
  now: number;
}): Promise<void> {
  const lane = makeLaneKey(args.metric, args.recordedAt, args.tzOffsetMs);
  const seq = nextLocalSeq();

  await getDb().transaction(async tx => {
    await tx.execute(
      `UPDATE measurements
       SET value = ?, recorded_at = ?, lane_key = ?, updated_at = ?, local_seq = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [args.value, args.recordedAt, lane, args.now, seq, args.id],
    );
    await writeEvent(tx, {
      measurementId: args.id, lineageId: args.lineageId, laneKey: lane,
      kind: 'update', value: args.value, source: args.source, seq, now: args.now,
    });
    await queueOp(tx, {
      lineageId: args.lineageId, laneKey: lane, kind: 'update', seq, now: args.now,
      payload: { id: args.id, value: args.value, recordedAt: args.recordedAt },
    });
  });

  await detectConflict(lane, args.now);
  notifyDataChanged();
}

/**
 * Soft delete — rows are never removed, because the conflict screen promises
 * losing versions stay in history.
 *
 * `cancelOpIds` is the cancel-vs-delete branch from page 07: if the entry never
 * reached the server, its queued upload is dropped instead of a delete being
 * sent. The sync engine decides which ops those are; this guarantees the
 * cancellation and the delete commit together.
 */
export async function removeMeasurement(args: {
  id: string;
  lineageId: string;
  laneKey: string;
  source: SourceId;
  now: number;
  /** What the undo snackbar calls it, e.g. "73.4 kg". */
  label?: string;
  cancelOpIds?: string[];
}): Promise<void> {
  const seq = nextLocalSeq();
  const cancelled = args.cancelOpIds ?? [];

  await getDb().transaction(async tx => {
    await tx.execute(
      `UPDATE measurements SET deleted_at = ?, updated_at = ?, local_seq = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [args.now, args.now, seq, args.id],
    );
    for (const opId of cancelled) {
      await tx.execute('DELETE FROM outbox WHERE id = ?', [opId]);
    }
    await writeEvent(tx, {
      measurementId: args.id, lineageId: args.lineageId, laneKey: args.laneKey,
      kind: 'delete', value: null, source: args.source, seq, now: args.now,
    });
    // Nothing to send if the create never left the device.
    if (cancelled.length === 0) {
      await queueOp(tx, {
        lineageId: args.lineageId, laneKey: args.laneKey, kind: 'delete',
        seq, now: args.now, payload: { id: args.id },
      });
    }
  });

  notifyDataChanged();
}

export interface UndoableDeletion {
  id: string;
  lineageId: string;
  label: string;
  at: number;
}

/**
 * The last deletion, consumed once.
 *
 * The sheet performs the delete and closes; History is what shows the undo.
 * Rather than threading it through navigation, the deletion is left here and
 * taken by whichever screen asks first.
 */
let lastDeletion: UndoableDeletion | null = null;

export function takeLastDeletion(): UndoableDeletion | null {
  const held = lastDeletion;
  lastDeletion = null;
  return held;
}

/**
 * Put a deleted reading back, and drop its queued delete if it never left.
 *
 * This is the same primitive as cancel-vs-delete: remove the op before
 * dispatch. Within the undo window the server never hears about it at all.
 */
export async function undoDelete(id: string, lineageId: string): Promise<void> {
  const seq = nextLocalSeq();
  await inTransaction(async tx => {
    await exec(tx, {
      sql: `UPDATE measurements SET deleted_at = NULL, updated_at = ?, local_seq = ?
            WHERE id = ?`,
      params: [Date.now(), seq, id],
    });
    await exec(tx, {
      sql: `DELETE FROM outbox WHERE lineage_id = ? AND kind = 'delete'
            AND status IN ('pending', 'failed')`,
      params: [lineageId],
    });
  });
  notifyDataChanged();
}

/**
 * Record the number the server gave a reading.
 *
 * This is what clears the "Pending" badge: the badge asks whether `serverSeq`
 * is null, and until the server has accepted the row, it is. Keyed by lineage
 * so a create and its later edits all settle together.
 */
export async function markSynced(
  lineageId: string,
  serverSeq: number,
): Promise<void> {
  await getDb().execute(
    'UPDATE measurements SET server_seq = ? WHERE lineage_id = ?',
    [serverSeq, lineageId],
  );
  // This is what flips the badge from Pending to a tick while the user watches.
  notifyDataChanged();
}

/**
 * Wipe every local table, in one transaction.
 *
 * Signing out has to remove the data, not just the session: the next person to
 * sign in on this device must not see the previous one's readings. The design
 * says as much — signing out discards unsent changes — which is also why the
 * button is disabled while the outbox is non-empty.
 */
export async function clearLocalData(): Promise<void> {
  await getDb().transaction(async tx => {
    // Children first, so nothing is briefly orphaned mid-transaction.
    for (const table of ['outbox', 'conflicts', 'measurement_events', 'measurements']) {
      await tx.execute(`DELETE FROM ${table}`);
    }
  });

  notifyDataChanged();
}

// ── shared write helpers ─────────────────────────────────────────────────────

interface Tx {
  execute: (sql: string, params?: (string | number | null)[]) => Promise<unknown>;
}

function exec(tx: Tx, q: { sql: string; params: (string | number | null)[] }) {
  return tx.execute(q.sql, q.params);
}

function inTransaction(fn: (tx: Tx) => Promise<void>): Promise<void> {
  return getDb().transaction(fn as never);
}

function writeEvent(
  tx: Tx,
  e: {
    measurementId: string;
    lineageId: string;
    laneKey: string;
    kind: EventKind;
    value: number | null;
    source: SourceId;
    seq: number;
    now: number;
  },
) {
  return tx.execute(
    `INSERT INTO measurement_events
       (id, measurement_id, lineage_id, lane_key, kind, value, created_at, source, local_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `ev-${e.measurementId}-${e.seq}`, e.measurementId, e.lineageId,
      e.laneKey, e.kind, e.value, e.now, e.source, e.seq,
    ],
  );
}

/**
 * Deletes are held for five seconds before they may be sent.
 *
 * That window is what makes Undo a cancellation rather than a correction: the
 * op is dropped before it ever reaches the server, so there is nothing to
 * apologise for afterwards. Design page 08 says as much — "Upload paused for 5s".
 */
export const UNDO_WINDOW_MS = 5_000;

function queueOp(
  tx: Tx,
  op: {
    lineageId: string;
    laneKey: string;
    kind: EventKind;
    seq: number;
    now: number;
    payload: object;
  },
) {
  const holdUntil = op.kind === 'delete' ? op.now + UNDO_WINDOW_MS : null;
  return tx.execute(
    `INSERT INTO outbox
       (id, lane_key, lineage_id, local_seq, kind, payload, status, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [
      `op-${op.lineageId}-${op.seq}`, op.laneKey, op.lineageId, op.seq,
      op.kind, JSON.stringify(op.payload), holdUntil, op.now,
    ],
  );
}
