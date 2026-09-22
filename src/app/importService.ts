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
import { getConnectedSources } from '../data/prefs';
import { deviceTzOffsetMs, MS_PER_DAY } from '../domain/time';
import type { SourceId } from '../domain/types';
import { DEFAULT_CONNECTED, importFrom } from '../providers/registry';

/** How far back an import reaches. */
const WINDOW_DAYS = 30;

export interface ImportSummary {
  imported: number;
  conflicts: number;
  /** Providers that refused or failed. One bad source must not sink the rest. */
  failed: Array<{ providerId: SourceId; error: string }>;
}

export async function importHealthData(): Promise<ImportSummary> {
  const now = Date.now();
  const tzOffsetMs = deviceTzOffsetMs();
  const sources = getConnectedSources(DEFAULT_CONNECTED);

  if (sources.length === 0) {
    return { imported: 0, conflicts: 0, failed: [] };
  }

  const results = await importFrom(sources, now - WINDOW_DAYS * MS_PER_DAY, now);

  const readings = results.flatMap(r => r.readings);
  const failed = results
    .filter(r => r.error !== undefined)
    .map(r => ({ providerId: r.providerId, error: r.error as string }));

  // Even when one provider failed, whatever the others returned still lands —
  // a partial import beats none, and the failure is reported alongside it.
  const { imported, conflicts } = await importMeasurements(readings, {
    tzOffsetMs,
    now,
  });

  return { imported, conflicts, failed };
}
