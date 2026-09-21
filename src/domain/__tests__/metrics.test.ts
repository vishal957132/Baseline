import {
  ALL_METRICS,
  EDITABLE_METRICS,
  formatValue,
  isImprovement,
  isMetricId,
  METRICS,
  metric,
} from '../metrics';

describe('the registry', () => {
  it('gives every metric a unit and an aggregation', () => {
    for (const d of Object.values(METRICS)) {
      expect(d.unit).toBeTruthy();
      expect(['sum', 'avg']).toContain(d.aggregate);
      expect(['up', 'down']).toContain(d.direction);
    }
  });

  it('throws on an unknown id rather than returning undefined', () => {
    expect(() => metric('heartrate' as never)).toThrow(/Unknown metric/);
  });

  it('guards unknown strings', () => {
    expect(isMetricId('weight')).toBe(true);
    expect(isMetricId('heartrate')).toBe(false);
  });
});

describe('editability', () => {
  /**
   * Design page 06: "Steps are read-only — they come from your connected
   * source. Only metrics you can measure yourself are editable here." Both
   * LogEntry's picker and MetricDetail's + button read this flag, so pinning it
   * keeps the two screens from drifting apart.
   */
  it('matches the design: weight, water and sleep are typeable', () => {
    expect([...EDITABLE_METRICS].sort()).toEqual(['sleep', 'water', 'weight']);
  });

  it('matches the design: steps and energy are import-only', () => {
    const imported = ALL_METRICS.filter(id => !METRICS[id].editable);
    expect([...imported].sort()).toEqual(['energy', 'steps']);
  });
});

describe('aggregation', () => {
  it('sums the additive metrics', () => {
    for (const id of ['water', 'steps', 'sleep', 'energy'] as const) {
      expect(METRICS[id].aggregate).toBe('sum');
    }
  });

  it('averages weight, which does not accumulate over a day', () => {
    expect(METRICS.weight.aggregate).toBe('avg');
  });
});

describe('isImprovement', () => {
  // Weight going down is good news; energy going up is good news. The arrow
  // and its colour come from here, not from the sign of the delta.
  it('reads direction from the descriptor', () => {
    expect(isImprovement('weight', -0.5)).toBe(true);
    expect(isImprovement('weight', 0.5)).toBe(false);
    expect(isImprovement('energy', 180)).toBe(true);
    expect(isImprovement('energy', -180)).toBe(false);
  });

  it('treats no change as no improvement', () => {
    expect(isImprovement('weight', 0)).toBe(false);
  });
});

describe('formatValue', () => {
  it('uses each metric’s precision', () => {
    expect(formatValue('weight', 72.64)).toBe('72.6');
    expect(formatValue('weight', 72.66)).toBe('72.7');
    expect(formatValue('weight', 72.6)).toBe('72.6');
    expect(formatValue('steps', 7412.4)).toBe('7412');
    expect(formatValue('water', 250)).toBe('250');
  });

  /**
   * Midpoints follow IEEE-754 representation, not half-up: 72.55 is stored as
   * slightly less than 72.55, so it formats down. Documented rather than fixed
   * — a 0.05 kg display difference on an exact midpoint is not worth carrying
   * a decimal library for, but it should not surprise anyone later.
   */
  it('rounds midpoints by float representation, not half-up', () => {
    expect(formatValue('weight', 72.55)).toBe('72.5');
    expect(formatValue('weight', 72.45)).toBe('72.5');
  });
});
