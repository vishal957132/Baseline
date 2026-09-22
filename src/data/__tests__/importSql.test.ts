import { MIGRATIONS } from '../migrations';
import { IMPORT_UPSERT_SQL } from '../importSql';

const ddl = MIGRATIONS.flatMap(m => m.statements).join('\n');

/**
 * This failed at runtime with "ON CONFLICT clause does not match any PRIMARY
 * KEY or UNIQUE constraint" — a mistake no type checker can see, because the
 * SQL is a string and the constraint lives in a different file.
 */
describe('the import upsert', () => {
  it('targets the unique index on (source, external_id)', () => {
    expect(IMPORT_UPSERT_SQL).toContain('ON CONFLICT (source, external_id)');
  });

  /**
   * The index is partial, and SQLite will not match a partial index unless the
   * upsert repeats its predicate.
   */
  it('repeats the partial index predicate', () => {
    expect(IMPORT_UPSERT_SQL).toMatch(
      /ON CONFLICT \(source, external_id\)\s*WHERE external_id IS NOT NULL/,
    );
  });

  it('repeats the predicate the index was actually created with', () => {
    const index = ddl.match(
      /UNIQUE INDEX idx_meas_external[\s\S]*?WHERE (external_id IS NOT NULL)/,
    );
    expect(index).not.toBeNull();
    expect(IMPORT_UPSERT_SQL).toContain(`WHERE ${index![1]}`);
  });

  it('updates the reading rather than inserting a duplicate', () => {
    expect(IMPORT_UPSERT_SQL).toMatch(/DO UPDATE SET[\s\S]*value\s*=\s*excluded\.value/);
  });

  it('binds one placeholder per column it names', () => {
    const columns = IMPORT_UPSERT_SQL.match(/\(([^)]*deleted_at)\)/)![1]
      .split(',').length;
    const values = IMPORT_UPSERT_SQL.match(/VALUES \(([^)]*)\)/)![1].split(',').length;
    expect(values).toBe(columns);
  });
});
