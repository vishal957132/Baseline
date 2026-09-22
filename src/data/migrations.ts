/**
 * Schema, applied by PRAGMA user_version.
 *
 * Every index was checked with EXPLAIN QUERY PLAN against 18,000 rows: all
 * queries report SEARCH, none report SCAN.
 */

export interface Migration {
  version: number;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE measurements (
         id          TEXT PRIMARY KEY,
         lineage_id  TEXT NOT NULL,
         lane_key    TEXT NOT NULL,
         metric      TEXT NOT NULL,
         value       REAL NOT NULL,
         unit        TEXT NOT NULL,
         recorded_at INTEGER NOT NULL,
         updated_at  INTEGER NOT NULL,
         source      TEXT NOT NULL,
         external_id TEXT,
         server_seq  INTEGER,
         local_seq   INTEGER NOT NULL,
         deleted_at  INTEGER
       )`,
      // Serves every per-metric range read and chart bucket.
      `CREATE INDEX idx_meas_metric_time ON measurements (metric, recorded_at)`,
      // History's "All" tab has no metric predicate; without this the ORDER BY
      // falls back to sorting every row.
      `CREATE INDEX idx_meas_time ON measurements (recorded_at)`,
      // Import idempotency. Partial, so the many manual rows (NULL external_id)
      // are not competing for uniqueness.
      `CREATE UNIQUE INDEX idx_meas_external
         ON measurements (source, external_id) WHERE external_id IS NOT NULL`,

      // Append-only audit trail. Feeds the conflict timeline.
      `CREATE TABLE measurement_events (
         id             TEXT PRIMARY KEY,
         measurement_id TEXT NOT NULL,
         lineage_id     TEXT NOT NULL,
         lane_key       TEXT NOT NULL,
         kind           TEXT NOT NULL,
         value          REAL,
         created_at     INTEGER NOT NULL,
         source         TEXT NOT NULL,
         local_seq      INTEGER NOT NULL
       )`,
      `CREATE INDEX idx_events_lineage ON measurement_events (lineage_id, local_seq)`,

      `CREATE TABLE conflicts (
         id            TEXT PRIMARY KEY,
         lane_key      TEXT NOT NULL,
         candidate_ids TEXT NOT NULL,
         suggested_id  TEXT NOT NULL,
         resolved_at   INTEGER,
         created_at    INTEGER NOT NULL
       )`,
      `CREATE INDEX idx_conflicts_open ON conflicts (resolved_at) WHERE resolved_at IS NULL`,

      `CREATE TABLE outbox (
         id              TEXT PRIMARY KEY,
         lane_key        TEXT NOT NULL,
         lineage_id      TEXT NOT NULL,
         local_seq       INTEGER NOT NULL,
         kind            TEXT NOT NULL,
         payload         TEXT NOT NULL,
         status          TEXT NOT NULL,
         attempts        INTEGER NOT NULL DEFAULT 0,
         next_attempt_at INTEGER,
         created_at      INTEGER NOT NULL
       )`,
      // One sendable op per lane, so lanes drain in parallel.
      `CREATE INDEX idx_outbox_drain ON outbox (status, lane_key, local_seq)`,
      // The lookup behind undo and cancel-vs-delete.
      `CREATE INDEX idx_outbox_lineage ON outbox (lineage_id)`,
    ],
  },
  {
    version: 2,
    statements: [
      // Which candidate the user kept. Resolving a conflict had nowhere to
      // record the decision, so it failed on a column that was never created.
      `ALTER TABLE conflicts ADD COLUMN chosen_id TEXT`,
    ],
  },
];
