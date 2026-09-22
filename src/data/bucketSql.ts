import type { Aggregation } from '../domain/metrics';

/**
 * The chart bucket query.
 *
 * Its own file, with no op-sqlite import, so it stays loadable under Jest —
 * everything here would produce a plausible wrong number rather than an error,
 * so it needs tests:
 *
 *  - the offset is ADDED (subtracting shifts the day boundary the wrong way);
 *  - the aggregate comes from the metric descriptor (SUM for water, LATEST for
 *    weight — a hardcoded AVG turns 250+300+250 ml into 267, and turns two
 *    weigh-ins into a number that was never on the scale).
 *
 * The range predicate stays outside the arithmetic so (metric, recorded_at)
 * still serves it.
 */
export function bucketSql(aggregate: Aggregation): string {
  const tail = `FROM measurements
          WHERE metric = ? AND recorded_at >= ? AND recorded_at < ?
            AND deleted_at IS NULL
          GROUP BY day ORDER BY day`;

  if (aggregate === 'latest') {
    /*
     * The day's most recent reading, with ties broken by local_seq.
     *
     * This was a bare `value` beside MAX(recorded_at), relying on SQLite
     * taking bare columns from the max row. That guarantee holds, but it says
     * nothing about which row wins when several share the maximum — and they
     * routinely do. The log form's time field is HH:MM, so `recorded_at` is
     * zeroed to the minute and every reading saved within the same minute
     * carries an identical timestamp. Four entries at 20:41 gave a four-way
     * tie, and the dashboard showed an arbitrary one of them: 99 kg while the
     * reading actually taken last was 125 kg.
     *
     * local_seq is the tiebreak because it is the only monotonic record of
     * write order. It cannot be the sole sort key — a back-dated entry gets a
     * high local_seq and an old recorded_at — so it orders within equal
     * timestamps and nothing more.
     *
     * `day` is computed one level down so the window clauses can partition on
     * it by name: PARTITION BY cannot see a SELECT alias, and repeating the
     * expression would mean repeating the offset parameter, leaving the
     * parameter list different from the other aggregates for no gain.
     */
    return `SELECT day, value, count FROM (
            SELECT day, value,
                   COUNT(*) OVER (PARTITION BY day) AS count,
                   ROW_NUMBER() OVER (
                     PARTITION BY day
                     ORDER BY recorded_at DESC, local_seq DESC
                   ) AS rn
            FROM (
              SELECT (recorded_at + ?) / 86400000 AS day,
                     value, recorded_at, local_seq
              ${tail.replace('GROUP BY day ORDER BY day', '')}
            )
          ) WHERE rn = 1 ORDER BY day`;
  }

  if (aggregate !== 'sum' && aggregate !== 'avg') {
    throw new Error(`Unsupported aggregate: ${aggregate}`);
  }

  return `SELECT (recorded_at + ?) / 86400000 AS day,
                 ${aggregate === 'sum' ? 'SUM' : 'AVG'}(value) AS value,
                 COUNT(*) AS count
          ${tail}`;
}
