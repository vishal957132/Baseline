/**
 * Legacy JSON feed. Its weight field is named `weight_kg` but the values are
 * POUNDS, and timestamps are epoch SECONDS.
 *
 * This is the one that makes the case for an adapter layer: a field name that
 * lies. Trusting it would store pounds as kilograms — a believable number that
 * is wrong by a factor of 2.2, with nothing to signal the error.
 */

import type { HealthProvider, Reading } from '../types';

const LB_TO_KG = 0.453_592_37;

export interface FeedRow {
  id: string;
  field: string;
  val: number;
  unit: string;
  ts: number; // epoch SECONDS
}

export function normalize(rows: FeedRow[]): Reading[] {
  return rows.flatMap((row): Reading[] => {
    const base = {
      externalId: row.id,
      recordedAt: row.ts * 1000, // seconds to milliseconds
      source: 'json_feed' as const,
    };

    if (row.field === 'weight_kg') {
      // Trust the unit field, never the field name.
      const kg = row.unit === 'lb' ? row.val * LB_TO_KG : row.val;
      return [{ ...base, metric: 'weight' as const, value: kg }];
    }
    if (row.field === 'step_count') {
      return [{ ...base, metric: 'steps' as const, value: row.val }];
    }
    return [];
  });
}

function fixtures(from: number, to: number): FeedRow[] {
  const at = (daysAgo: number) => Math.floor((to - daysAgo * 86_400_000) / 1000);
  return [
    { id: 'jf-w-1', field: 'weight_kg', val: 160, unit: 'lb', ts: at(1) },
    { id: 'jf-w-2', field: 'weight_kg', val: 72.4, unit: 'kg', ts: at(4) },
    { id: 'jf-s-1', field: 'step_count', val: 6200, unit: 'steps', ts: at(1) },
    { id: 'jf-x-1', field: 'vo2max', val: 41, unit: 'ml/kg/min', ts: at(1) },
  ].filter(r => r.ts * 1000 >= from);
}

export const jsonFeed: HealthProvider = {
  id: 'json_feed',
  label: 'Legacy JSON feed',
  platform: 'both',
  sampleShape: 'weight_kg, lb values',
  isAvailable: async () => true,
  fetch: async (from, to) => normalize(fixtures(from, to)),
};
