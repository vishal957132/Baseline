/**
 * The metric registry. One map, read by the chart, the log form, and the
 * repository's bucket query.
 *
 * `aggregate` is the field that matters: same-day readings combine differently
 * per metric. Three water logs of 250/300/250 are 800 ml for the day, not 267,
 * so a hardcoded AVG would render a plausible wrong number.
 */

import type { MetricId } from './types';

export type Aggregation = 'sum' | 'avg';

export interface MetricDescriptor {
  label: string;
  unit: string;
  aggregate: Aggregation;
  /** Which way progress runs. Weight goes down; everything else goes up. */
  direction: 'up' | 'down';
  /** Whether the user can type it. Steps and energy are import-only (page 06). */
  editable: boolean;
  precision: number;
}

export const METRICS: Record<MetricId, MetricDescriptor> = {
  weight: { label: 'Weight', unit: 'kg',    aggregate: 'avg', direction: 'down', editable: true,  precision: 1 },
  water:  { label: 'Water',  unit: 'ml',    aggregate: 'sum', direction: 'up',   editable: true,  precision: 0 },
  sleep:  { label: 'Sleep',  unit: 'min',   aggregate: 'sum', direction: 'up',   editable: true,  precision: 0 },
  steps:  { label: 'Steps',  unit: 'count', aggregate: 'sum', direction: 'up',   editable: false, precision: 0 },
  energy: { label: 'Energy', unit: 'kcal',  aggregate: 'sum', direction: 'up',   editable: false, precision: 0 },
};

export const ALL_METRICS = Object.keys(METRICS) as MetricId[];

/** Drives the log form's metric picker. */
export const EDITABLE_METRICS = ALL_METRICS.filter(id => METRICS[id].editable);

export function isMetricId(value: string): value is MetricId {
  return value in METRICS;
}

/** Throws on an unknown id — a missing descriptor is a bug, not a state. */
export function metric(id: MetricId): MetricDescriptor {
  const d = METRICS[id];
  if (!d) throw new Error(`Unknown metric: ${id}`);
  return d;
}

export function formatValue(id: MetricId, value: number): string {
  return value.toFixed(metric(id).precision);
}

/** `↓ 0.5 kg` is good news; `↑ 180 kcal` is good news. Direction decides. */
export function isImprovement(id: MetricId, delta: number): boolean {
  if (delta === 0) return false;
  return metric(id).direction === 'down' ? delta < 0 : delta > 0;
}
