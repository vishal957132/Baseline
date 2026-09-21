/**
 * Development seed: ~18,000 readings over 1,300 days.
 *
 * The scale matches what the design's Settings screen claims, so the
 * performance numbers in the README are measured rather than estimated.
 *
 * Inserts go through executeBatch (one prepared statement, many parameter
 * sets) and the audit events are generated with INSERT..SELECT inside SQLite —
 * 18,000 individual inserts takes minutes on a phone and looks like a hang.
 */

import type { DB } from '@op-engineering/op-sqlite';

import { METRICS } from '../domain/metrics';
import { laneKey, MS_PER_DAY } from '../domain/time';
import type { MetricId, SourceId } from '../domain/types';

const SPAN_DAYS = 1300;
const CHUNK = 500;

/** Readings per day. Water is logged many times a day; the rest once. */
const PER_DAY: Record<MetricId, number> = {
  weight: 1, steps: 1, sleep: 1, energy: 1, water: 10,
};

/** Deterministic, so the same seed always gives the same database. */
/* eslint-disable no-bitwise -- a PRNG is bitwise by definition */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* eslint-enable no-bitwise */

const SQL = `INSERT OR IGNORE INTO measurements
  (id, lineage_id, lane_key, metric, value, unit, recorded_at, updated_at,
   source, external_id, server_seq, local_seq, deleted_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`;

type Params = (string | number | null)[];

/** Built without touching the database, so the generator is testable. */
export function buildSeedRows(now: number, tzOffsetMs: number, seed = 1): Params[] {
  const rnd = mulberry32(seed);
  const rows: Params[] = [];
  const start = now - SPAN_DAYS * MS_PER_DAY;
  let weight = 75.4;
  let seq = 0;

  for (let day = 0; day < SPAN_DAYS; day++) {
    const dayStart = start + day * MS_PER_DAY;
    const weekend = [0, 6].includes(new Date(dayStart).getUTCDay());

    for (const id of Object.keys(PER_DAY) as MetricId[]) {
      for (let n = 0; n < PER_DAY[id]; n++) {
        // Spread across waking hours rather than clustering at midnight.
        const at = dayStart + (6 + rnd() * 16) * 3_600_000;
        let value: number;
        let source: SourceId = 'manual';

        if (id === 'weight') {
          weight += (rnd() - 0.52) * 0.28; // a slow downward drift
          value = Math.round(weight * 10) / 10;
          source = rnd() < 0.6 ? 'manual' : 'withings';
        } else if (id === 'steps') {
          value = Math.round((weekend ? 3200 : 6400) + rnd() * 7600);
          source = 'apple_health';
        } else if (id === 'sleep') {
          value = Math.round(300 + rnd() * 240);
          source = 'apple_health';
        } else if (id === 'energy') {
          value = Math.round(1750 + rnd() * 900);
          source = 'apple_health';
        } else {
          value = Math.round(180 + rnd() * 180);
        }

        seq += 1;
        const rowId = `seed-${id}-${day}-${n}`;
        rows.push([
          rowId, rowId, laneKey(id, at, tzOffsetMs), id, value,
          METRICS[id].unit, Math.round(at), Math.round(at), source,
          // Manual rows carry no external id — that is what lets the partial
          // unique index tolerate many of them.
          source === 'manual' ? null : `${source}:${rowId}`,
          seq, seq,
        ]);
      }
    }
  }
  return rows;
}

export async function seedDatabase(
  db: DB,
  now: number,
  tzOffsetMs: number,
  force = false,
): Promise<number> {
  const existing = await db.execute('SELECT COUNT(*) AS c FROM measurements');
  if (Number(existing.rows[0]?.c ?? 0) > 0 && !force) return 0;

  const rows = buildSeedRows(now, tzOffsetMs);
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.executeBatch([[SQL, rows.slice(i, i + CHUNK)]]);
  }

  await db.execute(
    `INSERT OR IGNORE INTO measurement_events
       (id, measurement_id, lineage_id, lane_key, kind, value, created_at, source, local_seq)
     SELECT 'ev-' || id, id, lineage_id, lane_key,
            CASE WHEN source = 'manual' THEN 'create' ELSE 'import' END,
            value, recorded_at, source, local_seq
     FROM measurements`,
  );

  return rows.length;
}

/** The unsent tail from design page 09: three ops in two lanes, one retrying. */
export async function seedSyncFixtures(db: DB, now: number, tz: number) {
  const weight = laneKey('weight', now, tz);
  const water = laneKey('water', now, tz);

  await db.transaction(async tx => {
    await tx.execute('DELETE FROM outbox');
    await tx.execute('DELETE FROM conflicts');

    const ops: Params[] = [
      ['op-4f19a2', weight, 'fx-weight', 12, 'create', '{"value":72.8}', 3, now + 8_000],
      ['op-7c02d8', weight, 'fx-weight', 13, 'update', '{"value":72.6}', 0, null],
      ['op-b81e40', water, 'fx-water', 14, 'delete', '{"value":250}', 0, null],
    ];
    for (const op of ops) {
      await tx.execute(
        `INSERT INTO outbox (id, lane_key, lineage_id, local_seq, kind, payload,
           status, attempts, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ${now})`,
        op,
      );
    }
    await tx.execute(
      `INSERT INTO conflicts (id, lane_key, candidate_ids, suggested_id, resolved_at, created_at)
       VALUES ('cf-weight', ?, ?, 'fx-weight', NULL, ?)`,
      [weight, JSON.stringify(['fx-weight', 'fx-import', 'fx-ipad']), now],
    );
  });
}
