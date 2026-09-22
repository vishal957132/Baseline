/**
 * The import upsert, kept out of the repository so it can be asserted.
 *
 * It failed at runtime with "ON CONFLICT clause does not match any PRIMARY KEY
 * or UNIQUE constraint". The unique index on `(source, external_id)` is
 * *partial* — it covers only rows with a non-null external_id, so the many
 * manual rows do not compete for it — and SQLite requires an upsert against a
 * partial index to repeat that predicate, or it will not match the index at
 * all. TypeScript cannot catch that, so a test does.
 *
 * Same reason `bucketSql` lives on its own: the repository imports op-sqlite,
 * which cannot load under Jest.
 */
export const IMPORT_UPSERT_SQL = `INSERT INTO measurements
    (id, lineage_id, lane_key, metric, value, unit, recorded_at,
     updated_at, source, external_id, server_seq, local_seq, deleted_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)
  ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET
    value       = excluded.value,
    recorded_at = excluded.recorded_at,
    lane_key    = excluded.lane_key,
    updated_at  = excluded.updated_at`;
