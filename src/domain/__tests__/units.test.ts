/**
 * Unit conversion and input bounds.
 *
 * Everything here fails silently rather than loudly if it is wrong: storing
 * 160 as kilograms because the field was in pounds produces a believable
 * number in the wrong scale, and a bound written in the wrong unit rejects a
 * reading the user was entitled to enter. Both need pinning.
 */

import {
  CONVERTIBLE_METRICS, formatIn, formatWithUnit, LB_PER_KG, MAX_VALUE_CHARS,
  sanitizeValueInput, UNIT_OPTIONS, unitFor, validateValue,
} from '../units';

describe('unitFor', () => {
  it('falls back to the canonical unit when nothing is chosen', () => {
    expect(unitFor('weight', {}).id).toBe('kg');
    expect(unitFor('water', {}).id).toBe('ml');
    expect(unitFor('sleep', {}).id).toBe('min');
  });

  /** A preference written by a later build must not make the app unopenable. */
  it('falls back rather than throwing on an unrecognised stored unit', () => {
    expect(unitFor('weight', { weight: 'stone' as never }).id).toBe('kg');
  });

  it('honours a stored choice', () => {
    expect(unitFor('weight', { weight: 'lb' }).id).toBe('lb');
    expect(unitFor('water', { water: 'l' }).id).toBe('l');
  });

  it('only offers a choice where there is more than one unit', () => {
    expect(CONVERTIBLE_METRICS).toEqual(['weight', 'water', 'sleep']);
  });

  /** The first option is canonical, which is what makes the fallback safe. */
  it('lists the canonical unit first for every metric', () => {
    expect(UNIT_OPTIONS.weight[0].id).toBe('kg');
    expect(UNIT_OPTIONS.water[0].id).toBe('ml');
    expect(UNIT_OPTIONS.sleep[0].id).toBe('min');
    for (const options of Object.values(UNIT_OPTIONS)) {
      expect(options[0].toDisplay(42)).toBe(42);
      expect(options[0].toCanonical(42)).toBe(42);
    }
  });
});

describe('conversion', () => {
  it('round-trips every unit without drift', () => {
    for (const options of Object.values(UNIT_OPTIONS)) {
      for (const unit of options) {
        expect(unit.toCanonical(unit.toDisplay(72.6))).toBeCloseTo(72.6, 9);
      }
    }
  });

  it('uses the defined pound, not an approximation', () => {
    // 1 lb is exactly 0.45359237 kg; 2.2 would be out by 4 kg at 100 kg.
    expect(LB_PER_KG).toBeCloseTo(2.2046226218, 9);
    expect(unitFor('weight', { weight: 'lb' }).toDisplay(72.6)).toBeCloseTo(160.0556, 4);
    expect(unitFor('weight', { weight: 'lb' }).toCanonical(160)).toBeCloseTo(72.5748, 4);
  });

  it('converts water and sleep the way a person would read them', () => {
    expect(formatWithUnit('water', 2500, { water: 'l' })).toBe('2.50 L');
    expect(formatWithUnit('water', 2500, {})).toBe('2500 ml');
    expect(formatWithUnit('sleep', 410, { sleep: 'hr' })).toBe('6.83 hr');
    expect(formatWithUnit('sleep', 410, {})).toBe('410 min');
  });

  it('shows each unit at its own precision', () => {
    // Millilitres to two decimals would be fake precision; litres to none
    // would round 2.5 L to 3 L.
    expect(formatIn(unitFor('water', {}), 1800)).toBe('1800');
    expect(formatIn(unitFor('water', { water: 'l' }), 1800)).toBe('1.80');
  });
});

describe('validateValue', () => {
  const kg = unitFor('weight', {});
  const lb = unitFor('weight', { weight: 'lb' });

  it('returns the canonical value, not what was typed', () => {
    const result = validateValue('160', lb);
    expect(result.ok).toBe(true);
    // The whole point: 160 lb must reach the database as ~72.6 kg.
    if (result.ok) expect(result.canonical).toBeCloseTo(72.5748, 3);
  });

  it('accepts a plain reading', () => {
    const result = validateValue('72.6', kg);
    expect(result).toEqual({ ok: true, canonical: 72.6 });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'not-a-number'],
    ['7.5.5', 'not-a-number'],
    ['1e5', 'not-a-number'],
    ['-5', 'not-a-number'],
    ['0', 'not-a-number'],
  ])('rejects %p', (input, reason) => {
    const result = validateValue(input, kg);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  /**
   * The bound is per-unit. 30 kg is a plausible weight and 30 lb is not, so a
   * single shared limit would have to be wrong for one of them.
   */
  it('applies the bound of the unit being typed in', () => {
    expect(validateValue('30', kg).ok).toBe(true);
    expect(validateValue('30', lb).ok).toBe(false);
    expect(validateValue('600', kg).ok).toBe(false);
    expect(validateValue('600', lb).ok).toBe(true);
  });

  it('names the range in the unit on screen', () => {
    const result = validateValue('5000', kg);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('Enter between 20 and 500 kg');
  });

  it('bounds water and sleep to a real day', () => {
    expect(validateValue('1441', unitFor('sleep', {})).ok).toBe(false);
    expect(validateValue('1440', unitFor('sleep', {})).ok).toBe(true);
    expect(validateValue('25', unitFor('sleep', { sleep: 'hr' })).ok).toBe(false);
    expect(validateValue('20000', unitFor('water', {})).ok).toBe(false);
  });
});

describe('sanitizeValueInput', () => {
  const kg = unitFor('weight', {});
  const ml = unitFor('water', {});

  it('drops anything that is not a digit or a point', () => {
    expect(sanitizeValueInput('7a2.b6', kg)).toBe('72.6');
  });

  it('accepts a comma as a decimal separator', () => {
    // Several Android keyboards send one on a locale that uses it.
    expect(sanitizeValueInput('72,6', kg)).toBe('72.6');
  });

  it('keeps only the first decimal point', () => {
    // The stray point goes, then kilograms' one decimal place trims the rest —
    // `72.6.4` is a slip, and `72.6` is the reading that was meant.
    expect(sanitizeValueInput('72.6.4', kg)).toBe('72.6');
    expect(sanitizeValueInput('2.6.7', unitFor('water', { water: 'l' }))).toBe('2.67');
  });

  it('allows a trailing point while it is still being typed', () => {
    // `7.` is not a number yet, but it is on the way to `7.5`.
    expect(sanitizeValueInput('72.', kg)).toBe('72.');
  });

  it('refuses decimals on a unit that has none', () => {
    expect(sanitizeValueInput('250.5', ml)).toBe('2505');
  });

  it('caps the decimals at the precision of the unit', () => {
    expect(sanitizeValueInput('72.6789', kg)).toBe('72.6');
    expect(sanitizeValueInput('2.6789', unitFor('water', { water: 'l' }))).toBe('2.67');
  });

  it('caps the length, so a paste cannot overflow the column', () => {
    const pasted = sanitizeValueInput('123456789012345678901234567890', kg);
    expect(pasted.length).toBeLessThanOrEqual(MAX_VALUE_CHARS);
  });
});
