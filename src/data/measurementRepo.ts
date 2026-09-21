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
import { laneKey } from '../domain/time';
import type {
  Conflict,
  DayBucket,
  EventKind,
  Measurement,
  MetricId,
  SourceId,
} from '../domain/types';
import { bucketSql } from './bucketSql';
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
    `SELECT id, lane_key, candidate_ids, suggested_id, resolved_at
     FROM conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC`,
  );
  return (rows as Row[]).map(r => ({
    id: String(r.id),
    laneKey: String(r.lane_key),
    candidateIds: JSON.parse(String(r.candidate_ids)) as string[],
    suggestedId: String(r.suggested_id),
    resolvedAt: r.resolved_at == null ? null : Number(r.resolved_at),
  }));
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
  const lane = laneKey(m.metric, m.recordedAt, m.tzOffsetMs);
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
  const lane = laneKey(args.metric, args.recordedAt, args.tzOffsetMs);
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
}

// ── shared write helpers ─────────────────────────────────────────────────────

interface Tx {
  execute: (sql: string, params?: (string | number | null)[]) => Promise<unknown>;
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
  return tx.execute(
    `INSERT INTO outbox
       (id, lane_key, lineage_id, local_seq, kind, payload, status, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?)`,
    [
      `op-${op.lineageId}-${op.seq}`, op.laneKey, op.lineageId, op.seq,
      op.kind, JSON.stringify(op.payload), op.now,
    ],
  );
}
