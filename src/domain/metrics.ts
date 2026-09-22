/**
 * The metric registry. One map, read by the chart, the log form, and the
 * repository's bucket query.
 *
 * `aggregate` is the field that matters: same-day readings combine differently
 * per metric. Three water logs of 250/300/250 are 800 ml for the day, not 267,
 * so a hardcoded AVG would render a plausible wrong number.
 *
 * Weight is 'latest', not 'avg', and the difference is user-visible: weighing
 * twice in a day and averaging reports a number that was never on the scale.
 * Type 77.5 against a morning reading of 66.1 and an averaging card shows
 * 71.8 — which reads as "my entry was ignored" rather than as an average.
 * A point-in-time measurement's value for a day is its most recent reading.
 */

import type { MetricId } from './types';

/**
 * How a day's readings collapse to one number.
 *
 * 'sum'    cumulative — water, sleep, steps, energy: the day's total.
 * 'latest' point-in-time — weight: the most recent reading of that day.
 * 'avg'    kept for metrics where a mean is the honest summary. Nothing uses
 *          it today; it stays because removing it would make `bucketSql`'s
 *          aggregate parameter a two-valued flag pretending to be a type.
 */
export type Aggregation = 'sum' | 'avg' | 'latest';

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
  weight: { label: 'Weight', unit: 'kg',    aggregate: 'latest', direction: 'down', editable: true,  precision: 1 },
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

/**
 * How far toward the goal, from 0 to 1.
 *
 * Direction-aware, and that is the whole point: `value / goal` is only
 * meaningful when higher is better. Applied to weight it reports a goal of
 * 70 kg as complete while the reading is 72.6, because the fill was clamped to
 * the goal rather than measured against it.
 *
 * For a falling metric the ratio is inverted, so progress rises as the reading
 * falls and reaches 1 exactly when the goal is met.
 */
export function goalProgress(id: MetricId, value: number, goal: number): number {
  if (goal <= 0) return 0;
  if (metric(id).direction === 'up') return clamp(value / goal);
  return value <= goal ? 1 : clamp(goal / value);
}

/** What is left to do, in the metric's own units. Never negative. */
export function goalRemaining(id: MetricId, value: number, goal: number): number {
  const remaining =
    metric(id).direction === 'up' ? goal - value : value - goal;
  return Math.max(0, remaining);
}

export function goalMet(id: MetricId, value: number, goal: number): boolean {
  return goalRemaining(id, value, goal) === 0;
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** `↓ 0.5 kg` is good news; `↑ 180 kcal` is good news. Direction decides. */
export function isImprovement(id: MetricId, delta: number): boolean {
  if (delta === 0) return false;
  return metric(id).direction === 'down' ? delta < 0 : delta > 0;
}
