import { METRICS } from '../../domain/metrics';
import { bucketSql } from '../bucketSql';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('bucketSql', () => {
  /**
   * Three water logs of 250/300/250 are 800 ml for the day, not 267. A
   * hardcoded AVG would render a plausible wrong number on four of five
   * metrics, so the aggregate comes from the descriptor.
   */
  it('sums additive metrics and averages weight', () => {
    expect(bucketSql('sum')).toContain('SUM(value)');
    expect(bucketSql('avg')).toContain('AVG(value)');
    expect(bucketSql(METRICS.water.aggregate)).toContain('SUM(');
    expect(bucketSql(METRICS.weight.aggregate)).toContain('AVG(');
  });

  it('adds the timezone offset rather than subtracting it', () => {
    expect(norm(bucketSql('avg'))).toContain('(recorded_at + ?) / 86400000 AS day');
    expect(bucketSql('avg')).not.toContain('recorded_at - ?');
  });

  it('leaves the range predicate outside the arithmetic so the index applies', () => {
    expect(norm(bucketSql('avg'))).toContain('recorded_at >= ? AND recorded_at < ?');
  });

  it('excludes soft-deleted rows', () => {
    expect(bucketSql('avg')).toContain('deleted_at IS NULL');
  });

  it('rejects an unknown aggregate instead of interpolating it', () => {
    expect(() => bucketSql('COUNT(*) FROM sqlite_master; --' as never)).toThrow(
      /Unsupported aggregate/,
    );
  });
});
