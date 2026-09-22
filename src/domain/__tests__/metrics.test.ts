import {
  ALL_METRICS,
  EDITABLE_METRICS,
  formatValue,
  goalMet,
  goalProgress,
  goalRemaining,
  isImprovement,
  isMetricId,
  METRICS,
  metric,
} from '../metrics';

describe('the registry', () => {
  it('gives every metric a unit and an aggregation', () => {
    for (const d of Object.values(METRICS)) {
      expect(d.unit).toBeTruthy();
      expect(['sum', 'avg', 'latest']).toContain(d.aggregate);
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

  /**
   * Weight is point-in-time, not cumulative and not a mean. Two weigh-ins in a
   * day are two readings, and the day's number is the later one — averaging
   * reports a figure that was never on the scale.
   */
  it('takes the latest reading for weight rather than averaging', () => {
    expect(METRICS.weight.aggregate).toBe('latest');
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

/**
 * Named by the brief as a thing worth testing, and it was wrong: progress was
 * `min(value, goal) / goal`, which reports a 70 kg goal as complete while the
 * reading is 72.6 — the bar was full the whole way down.
 */
describe('goal progress', () => {
  describe('a metric that should rise', () => {
    it('is the plain ratio', () => {
      expect(goalProgress('steps', 7412, 10_000)).toBeCloseTo(0.7412, 4);
    });

    it('is complete once the goal is reached', () => {
      expect(goalProgress('steps', 10_000, 10_000)).toBe(1);
      expect(goalMet('steps', 10_000, 10_000)).toBe(true);
    });

    it('does not exceed complete when the goal is beaten', () => {
      expect(goalProgress('steps', 25_000, 10_000)).toBe(1);
      expect(goalRemaining('steps', 25_000, 10_000)).toBe(0);
    });

    it('counts what is still to do', () => {
      expect(goalRemaining('steps', 7412, 10_000)).toBe(2588);
    });
  });

  describe('a metric that should fall', () => {
    it('is not complete while the reading is above the goal', () => {
      expect(goalProgress('weight', 72.6, 70)).toBeLessThan(1);
    });

    it('rises as the reading falls', () => {
      const far = goalProgress('weight', 80, 70);
      const near = goalProgress('weight', 72.6, 70);
      expect(near).toBeGreaterThan(far);
    });

    it('is complete at the goal, and stays complete below it', () => {
      expect(goalProgress('weight', 70, 70)).toBe(1);
      expect(goalProgress('weight', 68, 70)).toBe(1);
      expect(goalMet('weight', 68, 70)).toBe(true);
    });

    it('counts down, not up', () => {
      expect(goalRemaining('weight', 72.6, 70)).toBeCloseTo(2.6, 5);
      expect(goalRemaining('weight', 68, 70)).toBe(0);
    });
  });

  it('never divides by a goal of zero', () => {
    expect(goalProgress('steps', 500, 0)).toBe(0);
    expect(goalProgress('weight', 70, 0)).toBe(0);
  });

  it('stays within 0 and 1 for every metric', () => {
    for (const id of ALL_METRICS) {
      for (const [value, goal] of [[0, 100], [50, 100], [1e6, 100], [-5, 100]]) {
        const p = goalProgress(id, value, goal);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
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
