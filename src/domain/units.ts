/**
 * Display units, and the bounds a typed value has to fall inside.
 *
 * Storage never moves: weight is always kilograms, water always millilitres,
 * sleep always minutes. A unit is a lens the user picks — applied on the way
 * out, reversed on the way in — so switching kg to lb reformats every reading
 * ever taken rather than rewriting a single row. Converting on write would
 * make the stored number depend on a setting that can change afterwards, and
 * there would be no way to tell which rows were written under which one.
 *
 * The bounds live here rather than in the metric registry because they are
 * per-unit, not per-metric: "no more than 500" is a different number in
 * kilograms and in pounds, and a limit expressed in the wrong one silently
 * rejects a legitimate reading.
 *
 * No I/O, so this is testable without a device.
 */

import type { MetricId } from './types';

/** Exact by definition: 1 lb = 0.45359237 kg. */
export const LB_PER_KG = 1 / 0.45359237;

export type UnitId = 'kg' | 'lb' | 'ml' | 'l' | 'min' | 'hr' | 'count' | 'kcal';

export interface UnitOption {
  id: UnitId;
  /** Suffix beside a value: `72.6 kg`. */
  label: string;
  /** Full name, for the settings picker. */
  name: string;
  /** Stored value → what the user reads. */
  toDisplay: (canonical: number) => number;
  /** What the user typed → what gets stored. */
  toCanonical: (display: number) => number;
  /** Decimals shown, and the most that may be typed. */
  precision: number;
  /** Accepted range, in this unit. */
  min: number;
  max: number;
}

const same = (v: number) => v;

/**
 * The first option of each metric is the canonical one, which is what makes
 * `unitFor` safe to fall back to when a stored preference is unrecognised.
 */
export const UNIT_OPTIONS: Record<MetricId, UnitOption[]> = {
  weight: [
    { id: 'kg', label: 'kg', name: 'Kilograms', toDisplay: same, toCanonical: same,
      precision: 1, min: 20, max: 500 },
    { id: 'lb', label: 'lb', name: 'Pounds',
      toDisplay: v => v * LB_PER_KG, toCanonical: v => v / LB_PER_KG,
      precision: 1, min: 44, max: 1102 },
  ],
  water: [
    { id: 'ml', label: 'ml', name: 'Millilitres', toDisplay: same, toCanonical: same,
      precision: 0, min: 1, max: 10_000 },
    { id: 'l', label: 'L', name: 'Litres',
      toDisplay: v => v / 1000, toCanonical: v => v * 1000,
      precision: 2, min: 0.01, max: 10 },
  ],
  sleep: [
    { id: 'min', label: 'min', name: 'Minutes', toDisplay: same, toCanonical: same,
      precision: 0, min: 1, max: 1440 },
    { id: 'hr', label: 'hr', name: 'Hours',
      toDisplay: v => v / 60, toCanonical: v => v * 60,
      precision: 2, min: 0.02, max: 24 },
  ],
  // Import-only, so one option each. They still go through this path so that
  // formatting has a single shape for every metric.
  steps: [
    { id: 'count', label: 'steps', name: 'Steps', toDisplay: same, toCanonical: same,
      precision: 0, min: 1, max: 200_000 },
  ],
  energy: [
    { id: 'kcal', label: 'kcal', name: 'Kilocalories', toDisplay: same, toCanonical: same,
      precision: 0, min: 1, max: 20_000 },
  ],
};

/** Metrics the user can actually choose a unit for. Drives the Settings rows. */
export const CONVERTIBLE_METRICS = (Object.keys(UNIT_OPTIONS) as MetricId[])
  .filter(id => UNIT_OPTIONS[id].length > 1);

export type UnitPrefs = Partial<Record<MetricId, UnitId>>;

/**
 * The unit a metric is shown in.
 *
 * An unknown stored id falls back to canonical rather than throwing: a
 * preference written by a future build must not make the app unopenable.
 */
export function unitFor(metricId: MetricId, prefs: UnitPrefs = {}): UnitOption {
  const options = UNIT_OPTIONS[metricId];
  return options.find(o => o.id === prefs[metricId]) ?? options[0];
}

export function isUnitId(metricId: MetricId, value: string): value is UnitId {
  return UNIT_OPTIONS[metricId].some(o => o.id === value);
}

/**
 * Round a value that is ALREADY in `unit`. Converts nothing.
 *
 * The counterpart to `formatIn`, and the distinction is not pedantic: a screen
 * that converts a whole series up front for its chart axis then formats each
 * label with `formatIn` converts everything twice. In kilograms that is
 * invisible, because the conversion is the identity; in pounds every number on
 * the screen is out by a factor of 2.2.
 */
export function formatDisplay(unit: UnitOption, display: number): string {
  return display.toFixed(unit.precision);
}

/** A stored value, converted and rounded for display. */
export function formatIn(unit: UnitOption, canonical: number): string {
  return formatDisplay(unit, unit.toDisplay(canonical));
}

/** `72.6 kg` — the value and its unit, in whatever the user chose. */
export function formatWithUnit(
  metricId: MetricId, canonical: number, prefs: UnitPrefs = {},
): string {
  const unit = unitFor(metricId, prefs);
  return `${formatIn(unit, canonical)} ${unit.label}`;
}

/**
 * The longest a value may be. Bounded so a stray paste cannot put 40 digits
 * into a numeric column — `Number` happily parses them and stores Infinity.
 */
export const MAX_VALUE_CHARS = 8;

export type Rejection =
  | { ok: false; reason: 'empty'; message: string }
  | { ok: false; reason: 'not-a-number'; message: string }
  | { ok: false; reason: 'out-of-range'; message: string };

export type Validated = { ok: true; canonical: number } | Rejection;

/**
 * Turn typed text into a value fit to store, or say why it is not.
 *
 * Returns the *canonical* number, so callers never have to remember which unit
 * the field was in — forgetting that is how 154 lb gets stored as 154 kg.
 */
export function validateValue(text: string, unit: UnitOption): Validated {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'empty', message: 'Enter a value' };
  }

  // Number('') is 0 and Number('1e5') is 100000; neither is something a person
  // typed into a decimal pad, so the shape is checked before the value.
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(trimmed)) {
    return {
      ok: false,
      reason: 'not-a-number',
      message: 'Use digits only, with at most one decimal point',
    };
  }

  const typed = Number(trimmed);
  if (!Number.isFinite(typed) || typed <= 0) {
    return { ok: false, reason: 'not-a-number', message: 'Enter a number above zero' };
  }

  if (typed < unit.min || typed > unit.max) {
    return {
      ok: false,
      reason: 'out-of-range',
      message: `Enter between ${trim(unit.min)} and ${trim(unit.max)} ${unit.label}`,
    };
  }

  return { ok: true, canonical: unit.toCanonical(typed) };
}

/**
 * Keystroke-level filtering for the value field.
 *
 * Separate from `validateValue` because they answer different questions: this
 * one decides what may appear in the box at all, and has to tolerate the
 * half-finished states typing goes through — `7.` is not a number yet but must
 * be typeable on the way to `7.5`.
 */
export function sanitizeValueInput(next: string, unit: UnitOption): string {
  // Some keyboards send a comma for the decimal separator.
  let text = next.replace(/,/g, '.').replace(/[^\d.]/g, '');

  const firstDot = text.indexOf('.');
  if (firstDot !== -1) {
    text = `${text.slice(0, firstDot + 1)}${text.slice(firstDot + 1).replace(/\./g, '')}`;
  }
  // A unit with no decimals gets no decimal point — typing "." into a water
  // field in millilitres can only produce a value that is thrown away later.
  if (unit.precision === 0) text = text.replace(/\./g, '');

  const [whole, fraction] = text.split('.');
  const capped = fraction === undefined
    ? whole
    : `${whole}.${fraction.slice(0, unit.precision)}`;

  return capped.slice(0, MAX_VALUE_CHARS);
}

/** `2.5` not `2.50`, `500` not `500.0` — for the range message. */
function trim(n: number): string {
  return String(Number(n.toFixed(2)));
}
