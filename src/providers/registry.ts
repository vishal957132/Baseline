/**
 * id → adapter. The app's only entry point into health data.
 *
 * Everything above this line asks for readings by provider id and gets back
 * canonical `Reading`s. It cannot tell a fixture from a real HealthKit query,
 * which is the point: to go live, one adapter's fetch is replaced here and
 * nothing else changes.
 */

import { Platform } from 'react-native';

import type { SourceId } from '../domain/types';
import { appleHealth } from './adapters/appleHealth';
import { healthConnect } from './adapters/healthConnect';
import { jsonFeed } from './adapters/jsonFeed';
import type { HealthProvider, Reading } from './types';

export const PROVIDERS: Partial<Record<SourceId, HealthProvider>> = {
  apple_health: appleHealth,
  health_connect: healthConnect,
  json_feed: jsonFeed,
};

export function provider(id: SourceId): HealthProvider {
  const found = PROVIDERS[id];
  if (!found) throw new Error(`Unknown provider: ${id}`);
  return found;
}

/** Providers that make sense on this device. Drives the Connect screen. */
export function providersForPlatform(os = Platform.OS): HealthProvider[] {
  return Object.values(PROVIDERS).filter(
    p => p.platform === 'both' || p.platform === os,
  );
}

/**
 * On by default. The legacy feed is off, matching design page 13 — it is the
 * odd one out, and a source whose field names lie should be opt-in.
 */
export const DEFAULT_CONNECTED: SourceId[] = ['apple_health', 'health_connect'];

/**
 * This device's providers with the user's on/off choice applied.
 *
 * The choice is passed in rather than read here, so the registry stays a pure
 * lookup and nothing above it has to mock storage to test importing.
 */
export function connectedProviders(
  connected: SourceId[],
  os = Platform.OS,
): HealthProvider[] {
  return providersForPlatform(os).filter(p => connected.includes(p.id));
}

export interface ImportResult {
  providerId: SourceId;
  readings: Reading[];
  /** Set when the provider refused or failed — one bad source degrades one
   *  card (design page 15), so the failure is returned, not thrown. */
  error?: string;
}

/**
 * Pull from several providers at once.
 *
 * `allSettled`, not `all`: if Apple Health has no weight permission, Health
 * Connect's steps should still arrive.
 */
export async function importFrom(
  ids: SourceId[],
  from: number,
  to: number,
): Promise<ImportResult[]> {
  const results = await Promise.allSettled(
    ids.map(id => provider(id).fetch(from, to)),
  );
  return results.map((r, i) => ({
    providerId: ids[i],
    readings: r.status === 'fulfilled' ? r.value : [],
    error: r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : undefined,
  }));
}
