/**
 * Apple Health. Names weight `body_mass`, already in kilograms, and timestamps
 * as ISO 8601 strings.
 *
 * Demo build: `samples()` returns fixtures. Swapping in the real HealthKit
 * query means replacing that one function — `normalize` stays as it is.
 */

import type { HealthProvider, Reading } from '../types';

export interface HKSample {
  uuid: string;
  sampleType: string;
  quantity: { doubleValue: number; unit: string };
  startDate: string; // ISO 8601
}

const METRIC_BY_TYPE: Record<string, 'weight' | 'steps'> = {
  HKQuantityTypeIdentifierBodyMass: 'weight',
  HKQuantityTypeIdentifierStepCount: 'steps',
};

export function normalize(samples: HKSample[]): Reading[] {
  return samples.flatMap((s): Reading[] => {
    const metric = METRIC_BY_TYPE[s.sampleType];
    // An unrecognised sample type is skipped, not crashed on — providers add
    // new types without asking us.
    if (!metric) return [];
    return [{
      externalId: s.uuid,
      metric,
      value: s.quantity.doubleValue, // already kg / count
      recordedAt: Date.parse(s.startDate),
      source: 'apple_health' as const,
    }];
  });
}

function fixtures(from: number, to: number): HKSample[] {
  const at = (daysAgo: number) => new Date(to - daysAgo * 86_400_000).toISOString();
  return [
    { uuid: 'hk-w-1', sampleType: 'HKQuantityTypeIdentifierBodyMass', quantity: { doubleValue: 72.5, unit: 'kg' }, startDate: at(0) },
    { uuid: 'hk-w-2', sampleType: 'HKQuantityTypeIdentifierBodyMass', quantity: { doubleValue: 72.9, unit: 'kg' }, startDate: at(2) },
    { uuid: 'hk-s-1', sampleType: 'HKQuantityTypeIdentifierStepCount', quantity: { doubleValue: 7412, unit: 'count' }, startDate: at(0) },
    { uuid: 'hk-x-1', sampleType: 'HKQuantityTypeIdentifierHeartRate', quantity: { doubleValue: 61, unit: 'count/min' }, startDate: at(0) },
  ].filter(s => Date.parse(s.startDate) >= from);
}

export const appleHealth: HealthProvider = {
  id: 'apple_health',
  label: 'Apple Health',
  platform: 'ios',
  sampleShape: 'body_mass, HKUnit',
  isAvailable: async () => true,
  fetch: async (from, to) => normalize(fixtures(from, to)),
};
