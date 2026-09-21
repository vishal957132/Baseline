/**
 * Health Connect. Names weight `weight` and reports it in GRAMS, with
 * timestamps as epoch milliseconds.
 */

import type { HealthProvider, Reading } from '../types';

export interface HCRecord {
  metadata: { id: string };
  recordType: string;
  weight?: { grams: number };
  count?: number;
  time: number; // epoch ms
}

export function normalize(records: HCRecord[]): Reading[] {
  return records.flatMap((r): Reading[] => {
    const base = { externalId: r.metadata.id, recordedAt: r.time, source: 'health_connect' as const };

    if (r.recordType === 'weight' && r.weight) {
      // Grams to kilograms. The unit is in the field name, not a unit field.
      return [{ ...base, metric: 'weight' as const, value: r.weight.grams / 1000 }];
    }
    if (r.recordType === 'steps' && r.count != null) {
      return [{ ...base, metric: 'steps' as const, value: r.count }];
    }
    return [];
  });
}

function fixtures(from: number, to: number): HCRecord[] {
  const at = (daysAgo: number) => to - daysAgo * 86_400_000;
  return [
    { metadata: { id: 'hc-w-1' }, recordType: 'weight', weight: { grams: 72_600 }, time: at(0) },
    { metadata: { id: 'hc-w-2' }, recordType: 'weight', weight: { grams: 73_100 }, time: at(3) },
    { metadata: { id: 'hc-s-1' }, recordType: 'steps', count: 8140, time: at(0) },
    { metadata: { id: 'hc-x-1' }, recordType: 'hydration', time: at(0) },
  ].filter(r => r.time >= from);
}

export const healthConnect: HealthProvider = {
  id: 'health_connect',
  label: 'Health Connect',
  platform: 'android',
  sampleShape: 'weight, grams',
  isAvailable: async () => true,
  fetch: async (from, to) => normalize(fixtures(from, to)),
};
