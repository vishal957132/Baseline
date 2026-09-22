/**
 * Pulls readings from the connected health providers into the database.
 *
 * This is the seam the whole adapter layer exists for: it asks the registry
 * for providers, gets back canonical `Reading`s, and hands them to the
 * repository. Nothing here knows that Apple Health calls weight `body_mass`,
 * that Health Connect reports grams, or that the legacy feed's `weight_kg`
 * field actually carries pounds — each adapter has already dealt with that.
 *
 * Swapping a fixture for a real HealthKit query changes one adapter and
 * nothing else, including this file.
 */

import { importMeasurements } from '../data/measurementRepo';
import { getConnectedSources, getImportedMetrics } from '../data/prefs';
import { ALL_METRICS } from '../domain/metrics';
import { deviceTzOffsetMs, MS_PER_DAY } from '../domain/time';
import type { SourceId } from '../domain/types';
import {
  connectedProviders, DEFAULT_CONNECTED, importFrom,
} from '../providers/registry';

/** How far back an import reaches. */
const WINDOW_DAYS = 30;

export interface ImportSummary {
  imported: number;
  conflicts: number;
  /** Providers that refused or failed. One bad source must not sink the rest. */
  failed: Array<{ providerId: SourceId; error: string }>;
  /** Readings a provider offered that the user does not want imported. */
  skipped: number;
}

export async function importHealthData(): Promise<ImportSummary> {
  const now = Date.now();
  const tzOffsetMs = deviceTzOffsetMs();
  // The stored choice is intersected with what this device actually has: a
  // saved preference for Apple Health must not cause a read on Android.
  const sources = connectedProviders(
    getConnectedSources(DEFAULT_CONNECTED),
  ).map(p => p.id);
  const wanted = getImportedMetrics(ALL_METRICS);

  if (sources.length === 0 || wanted.length === 0) {
    return { imported: 0, conflicts: 0, failed: [], skipped: 0 };
  }

  const results = await importFrom(sources, now - WINDOW_DAYS * MS_PER_DAY, now);

  const offered = results.flatMap(r => r.readings);
  // Filtered after normalisation, not before: an adapter reports whatever the
  // source holds, and which of it to keep is the user's decision, not the
  // provider's.
  const readings = offered.filter(r => wanted.includes(r.metric));

  const failed = results
    .filter(r => r.error !== undefined)
    .map(r => ({ providerId: r.providerId, error: r.error as string }));

  // Even when one provider failed, whatever the others returned still lands —
  // a partial import beats none, and the failure is reported alongside it.
  const { imported, conflicts } = await importMeasurements(readings, {
    tzOffsetMs,
    now,
  });

  return { imported, conflicts, failed, skipped: offered.length - readings.length };
}
