import { MIGRATIONS } from '../migrations';

/**
 * The runner had never actually run. Version 1 was all there was, so applying a
 * migration to a database that already existed was untested — and the first
 * time it mattered, resolving a conflict failed on a column that had been
 * dropped during simplification and never added back.
 */
describe('migrations', () => {
  it('are numbered from one, with no gaps', () => {
    expect(MIGRATIONS.map(m => m.version)).toEqual(
      MIGRATIONS.map((_, i) => i + 1),
    );
  });

  it('are in ascending order, because the runner applies them in sequence', () => {
    const versions = MIGRATIONS.map(m => m.version);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
  });

  it('never alter a version that has already shipped', () => {
    // Migration 1 creates; anything after it may only add.
    for (const m of MIGRATIONS.slice(1)) {
      expect(m.statements.every(s => !/^\s*CREATE TABLE/i.test(s))).toBe(true);
    }
  });

  it('adds the column that records which candidate was kept', () => {
    const v2 = MIGRATIONS.find(m => m.version === 2);
    expect(v2?.statements.join(' ')).toContain('ADD COLUMN chosen_id');
  });

  /** A migration that dropped or renamed would lose data on upgrade. */
  it('only adds — never drops a column or a table', () => {
    const later = MIGRATIONS.slice(1).flatMap(m => m.statements).join(' ');
    expect(later).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });

  it('gives every statement something to do', () => {
    for (const m of MIGRATIONS) {
      expect(m.statements.length).toBeGreaterThan(0);
      expect(m.statements.every(s => s.trim().length > 0)).toBe(true);
    }
  });
});
