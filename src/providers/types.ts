import type { MetricId, SourceId } from '../domain/types';

/**
 * A reading in the app's shape, whatever the provider called it.
 *
 * Past this point nothing knows or cares where the data came from — that is
 * the whole purpose of the adapter layer.
 */
export interface Reading {
  /** The provider's own id. Becomes `external_id`, which is the import
   *  idempotency key, so re-importing the same sample is a no-op. */
  externalId: string;
  metric: MetricId;
  /** Always the metric's canonical unit: kg, ml, min, count, kcal. */
  value: number;
  /** Epoch milliseconds, whatever the provider used. */
  recordedAt: number;
  source: SourceId;
}

export interface HealthProvider {
  id: SourceId;
  label: string;
  /** Where this source exists. Drives the Connect screen's platform note. */
  platform: 'ios' | 'android' | 'both';
  /** What the raw payload calls things — shown to the user on Connect. */
  sampleShape: string;
  isAvailable(): Promise<boolean>;
  /** Readings in the half-open window [from, to). */
  fetch(from: number, to: number): Promise<Reading[]>;
}

/** Thrown when permission was refused or the store did not answer. */
export class ProviderUnavailableError extends Error {
  constructor(readonly providerId: SourceId, message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
