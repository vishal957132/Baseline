import type { DB } from '@op-engineering/op-sqlite';

import { laneKey, startOfLocalDayMs } from '../../domain/time';
import { buildSeedRows, seedDatabase, seedSyncFixtures } from '../seed';

/**
 * A tiny fake that records statements and answers COUNT queries from a number
 * the test controls. Enough to prove the guard, without a native database.
 */
function fakeDb(existingRows: number) {
  const statements: string[] = [];
  const execute = jest.fn(async (sql: string) => {
    statements.push(sql.replace(/\s+/g, ' ').trim());
    return { rows: [{ c: existingRows, n: existingRows }], rowsAffected: 0 };
  });
  const db = {
    execute,
    executeBatch: jest.fn(async () => ({ rowsAffected: 0 })),
    transaction: async (fn: (tx: { execute: typeof execute }) => Promise<void>) =>
      fn({ execute }),
  } as unknown as DB;
  return { db, statements };
}

const NOW = Date.UTC(2026, 8, 22, 10, 0);

describe('the sync fixtures', () => {
  /**
   * They used to clear the outbox first, so every reload deleted whatever the
   * user had queued. Their readings stayed marked Pending with no op left to
   * send them — permanently stuck, and it looked like sync was broken.
   */
  it('never deletes queued work', async () => {
    const { db, statements } = fakeDb(3);
    await seedSyncFixtures(db, NOW, 0);
    expect(statements.some(s => s.includes('DELETE FROM outbox'))).toBe(false);
  });

  it('does not seed at all when the queue is not empty', async () => {
    const { db, statements } = fakeDb(3);
    await seedSyncFixtures(db, NOW, 0);
    expect(statements.some(s => s.includes('INSERT INTO outbox'))).toBe(false);
  });

  it('seeds the design fixtures on a clean slate', async () => {
    const { db, statements } = fakeDb(0);
    await seedSyncFixtures(db, NOW, 0);
    expect(statements.filter(s => s.includes('INSERT OR IGNORE INTO outbox')))
      .toHaveLength(3);
  });

  /**
   * It used to seed one on today's weight lane, which is where a typed weight
   * entry lands — and detection will not raise a conflict where one is already
   * open, so the fixture shadowed every real conflict the user could cause.
   */
  it('seeds no conflict, leaving that lane free for a real one', async () => {
    const { db, statements } = fakeDb(0);
    await seedSyncFixtures(db, NOW, 0);
    expect(statements.some(s => s.includes('INTO conflicts'))).toBe(false);
  });

  /**
   * Checking only the outbox was not enough. Once the three ops had drained,
   * the queue looked empty again, so the conflict row was re-inserted and hit
   * its primary key — which failed the launch outright.
   */
  it('counts open conflicts too, not just the queue', async () => {
    const { db, statements } = fakeDb(1);
    await seedSyncFixtures(db, NOW, 0);
    expect(statements[0]).toContain('FROM conflicts');
    expect(statements.some(s => s.includes('INSERT'))).toBe(false);
  });

  it('inserts idempotently, so a re-run can never fail the launch', async () => {
    const { db, statements } = fakeDb(0);
    await seedSyncFixtures(db, NOW, 0);
    const inserts = statements.filter(s => s.startsWith('INSERT'));
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts.every(s => s.startsWith('INSERT OR IGNORE'))).toBe(true);
  });
});

describe('the history seed', () => {
  /**
   * Half of what makes `ensureDemoData` safe to run on every session start.
   * The other half is the fixture guard above.
   */
  it('inserts nothing when readings already exist', async () => {
    const { db } = fakeDb(18_000);
    await expect(seedDatabase(db, NOW, 0)).resolves.toBe(0);
  });

  it('inserts when the table is empty', async () => {
    const { db } = fakeDb(0);
    await expect(seedDatabase(db, NOW, 0)).resolves.toBeGreaterThan(0);
  });

  it('is reproducible for a given seed', () => {
    expect(buildSeedRows(NOW, 0, 7)).toEqual(buildSeedRows(NOW, 0, 7));
  });

  it('differs for a different seed', () => {
    expect(buildSeedRows(NOW, 0, 1)).not.toEqual(buildSeedRows(NOW, 0, 2));
  });

  it('marks its history as already synced, so only real entries show Pending', () => {
    // server_seq is the 12th bound value; a number there means the server has it.
    const [row] = buildSeedRows(NOW, 0, 7);
    expect(typeof row[11]).toBe('number');
  });

  it('gives manual rows no external id, so the partial unique index allows many', () => {
    const manual = buildSeedRows(NOW, 0, 7).filter(r => r[8] === 'manual');
    expect(manual.length).toBeGreaterThan(0);
    expect(manual.every(r => r[9] === null)).toBe(true);
  });
});

/**
 * The seed used to stop at yesterday, so every lane for today was empty — a
 * reading entered now had nothing to be in contention with, and a conflict was
 * unreachable however hard you tried.
 */
describe('the seed reaches today', () => {
  const TZ = 0;
  const rows = () => buildSeedRows(NOW, TZ, 7);

  // Columns, in bind order: id, lineage, lane_key, metric, value, unit,
  // recorded_at, updated_at, source, external_id, server_seq, local_seq.
  const LANE = 2;
  const METRIC = 3;
  const RECORDED_AT = 6;
  const SOURCE = 8;

  it('puts readings in today\u2019s lanes', () => {
    const todayLane = laneKey('weight', NOW, TZ);
    expect(rows().some(r => r[LANE] === todayLane)).toBe(true);
  });

  it('records nothing in the future', () => {
    expect(rows().every(r => Number(r[RECORDED_AT]) <= NOW)).toBe(true);
  });

  it('aligns days with local midnight, so lanes line up with the chart', () => {
    const midnight = startOfLocalDayMs(NOW, TZ);
    const todays = rows().filter(r => Number(r[RECORDED_AT]) >= midnight);
    expect(todays.length).toBeGreaterThan(0);
  });

  /** So typing a weight today reliably raises a conflict against the scale. */
  it('makes today\u2019s weight come from the scale, not from typing', () => {
    const todayLane = laneKey('weight', NOW, TZ);
    const todaysWeight = rows().filter(
      r => r[METRIC] === 'weight' && r[LANE] === todayLane,
    );
    expect(todaysWeight.length).toBeGreaterThan(0);
    expect(todaysWeight.every(r => r[SOURCE] === 'withings')).toBe(true);
  });

  it('still mixes sources on earlier days', () => {
    const sources = new Set(
      rows().filter(r => r[METRIC] === 'weight').map(r => r[SOURCE]),
    );
    expect(sources.size).toBeGreaterThan(1);
  });
});
