import { METRICS } from '../../domain/metrics';
import { bucketSql } from '../bucketSql';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const AGGREGATES = ['sum', 'avg', 'latest'] as const;

describe('bucketSql', () => {
  /**
   * Three water logs of 250/300/250 are 800 ml for the day, not 267. A
   * hardcoded AVG would render a plausible wrong number on four of five
   * metrics, so the aggregate comes from the descriptor.
   */
  it('sums additive metrics', () => {
    expect(bucketSql('sum')).toContain('SUM(value)');
    expect(bucketSql('avg')).toContain('AVG(value)');
    expect(bucketSql(METRICS.water.aggregate)).toContain('SUM(');
    expect(bucketSql(METRICS.sleep.aggregate)).toContain('SUM(');
  });

  /**
   * Weight is the day's most recent reading, not its mean.
   *
   * Averaging is what made a typed 77.5 appear as 71.8 against a morning
   * reading of 66.1 — a number that was never on the scale, and which reads as
   * the entry having been ignored rather than as an average.
   */
  it('takes the latest reading of the day for weight', () => {
    expect(METRICS.weight.aggregate).toBe('latest');
    const sql = norm(bucketSql('latest'));
    expect(sql).toContain('ROW_NUMBER()');
    expect(sql).toContain('WHERE rn = 1');
    expect(sql).not.toContain('AVG(');
    expect(sql).not.toContain('SUM(value)');
  });

  /**
   * The tiebreak is the whole point, and its absence was visible on screen.
   *
   * The log form records to the minute, so `recorded_at` is zeroed below it and
   * every reading saved in the same minute shares a timestamp. Four entries at
   * 20:41 left MAX(recorded_at) with a four-way tie and the dashboard showed an
   * arbitrary one of them — 99 kg, when the reading actually taken last was
   * 125 kg. Ordering by recorded_at alone is not enough.
   */
  it('breaks ties on recorded_at with local_seq', () => {
    const sql = norm(bucketSql('latest'));
    expect(sql).toContain('ORDER BY recorded_at DESC, local_seq DESC');
  });

  /**
   * local_seq orders within a timestamp and never on its own: a back-dated
   * entry carries a high local_seq and an old recorded_at, so sorting by it
   * alone would call yesterday's reading today's latest.
   */
  it('never sorts by local_seq alone', () => {
    const sql = norm(bucketSql('latest'));
    expect(sql).not.toMatch(/ORDER BY local_seq/);
  });

  /** One offset parameter, in the same position as every other aggregate. */
  it('takes the same four parameters as the other aggregates', () => {
    for (const aggregate of AGGREGATES) {
      expect((bucketSql(aggregate).match(/\?/g) ?? []).length).toBe(4);
    }
  });

  it('adds the timezone offset rather than subtracting it', () => {
    for (const aggregate of AGGREGATES) {
      expect(norm(bucketSql(aggregate)))
        .toContain('(recorded_at + ?) / 86400000 AS day');
      expect(bucketSql(aggregate)).not.toContain('recorded_at - ?');
    }
  });

  it('leaves the range predicate outside the arithmetic so the index applies', () => {
    for (const aggregate of AGGREGATES) {
      expect(norm(bucketSql(aggregate)))
        .toContain('recorded_at >= ? AND recorded_at < ?');
    }
  });

  it('excludes soft-deleted rows', () => {
    for (const aggregate of AGGREGATES) {
      expect(bucketSql(aggregate)).toContain('deleted_at IS NULL');
    }
  });

  /** Every metric's descriptor has to name an aggregate this can build. */
  it('builds a statement for every metric in the registry', () => {
    for (const descriptor of Object.values(METRICS)) {
      expect(() => bucketSql(descriptor.aggregate)).not.toThrow();
    }
  });

  it('rejects an unknown aggregate instead of interpolating it', () => {
    expect(() => bucketSql('COUNT(*) FROM sqlite_master; --' as never)).toThrow(
      /Unsupported aggregate/,
    );
  });
});
