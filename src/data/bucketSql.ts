import type { Aggregation } from '../domain/metrics';

/**
 * The chart bucket query.
 *
 * Its own file, with no op-sqlite import, so it stays loadable under Jest —
 * the two things here would both produce plausible wrong numbers rather than
 * errors, so they need tests:
 *
 *  - the offset is ADDED (subtracting shifts the day boundary the wrong way);
 *  - the aggregate comes from the metric descriptor (SUM for water, AVG for
 *    weight — a hardcoded AVG turns 250+300+250 ml into 267).
 *
 * The range predicate stays outside the arithmetic so (metric, recorded_at)
 * still serves it.
 */
export function bucketSql(aggregate: Aggregation): string {
  if (aggregate !== 'sum' && aggregate !== 'avg') {
    throw new Error(`Unsupported aggregate: ${aggregate}`);
  }
  return `SELECT (recorded_at + ?) / 86400000 AS day,
                 ${aggregate === 'sum' ? 'SUM' : 'AVG'}(value) AS value,
                 COUNT(*) AS count
          FROM measurements
          WHERE metric = ? AND recorded_at >= ? AND recorded_at < ?
            AND deleted_at IS NULL
          GROUP BY day ORDER BY day`;
}
