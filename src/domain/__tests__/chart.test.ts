import { downsample, pickTicks, project, summarise, type Point } from '../chart';

const series = (values: number[]): Point[] =>
  values.map((value, day) => ({ day, value }));

describe('downsample', () => {
  it('leaves a short series alone', () => {
    const short = series([1, 2, 3]);
    expect(downsample(short, 60)).toBe(short);
  });

  /** Three years of daily readings for a few hundred pixels. */
  it('reduces 1,095 points to at most 60', () => {
    const long = series(Array.from({ length: 1095 }, (_, i) => i));
    expect(downsample(long, 60).length).toBeLessThanOrEqual(60);
  });

  it('averages within a bucket rather than dropping points', () => {
    // Four points, two buckets: (10+20)/2 and (30+40)/2.
    expect(downsample(series([10, 20, 30, 40]), 2).map(p => p.value)).toEqual([15, 35]);
  });

  it('keeps the first day of each bucket as its label', () => {
    expect(downsample(series([1, 2, 3, 4]), 2).map(p => p.day)).toEqual([0, 2]);
  });
});

describe('project', () => {
  const opts = { width: 100, height: 50, padding: 0 };

  it('returns empty geometry for an empty series', () => {
    const geo = project([], opts);
    expect(geo.points).toEqual([]);
    expect(geo.linePath).toBe('');
    expect(geo.bars).toEqual([]);
  });

  it('spreads points evenly across the width', () => {
    const geo = project(series([1, 2, 3]), { ...opts, padX: 0 });
    expect(geo.points.map(p => p.x)).toEqual([0, 50, 100]);
  });

  /**
   * The clipping fix. With the first and last points exactly on the edges,
   * half the line stroke and the whole end-point marker fall outside the SVG
   * and get cut off, which reads as a chart that is missing its ends.
   */
  it('insets both ends so strokes and markers are not clipped', () => {
    const geo = project(series([1, 2, 3]), { ...opts, padX: 6 });
    expect(geo.points[0].x).toBe(6);
    expect(geo.points[2].x).toBe(94);
  });

  it('insets by default, without being asked', () => {
    const geo = project(series([1, 2]), opts);
    expect(geo.points[0].x).toBeGreaterThan(0);
    expect(geo.points[1].x).toBeLessThan(opts.width);
  });

  it('closes the area at the inset edges, not the canvas edges', () => {
    const geo = project(series([1, 2]), { ...opts, padX: 6 });
    expect(geo.areaPath).toContain('L94 50');
    expect(geo.areaPath).toContain('L6 50');
  });

  it('keeps the first and last bars fully inside the canvas', () => {
    const geo = project(series([1, 2, 3]), { ...opts, padX: 6 });
    const first = geo.bars[0];
    const last = geo.bars[geo.bars.length - 1];
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(last.x + last.width).toBeLessThanOrEqual(opts.width);
  });

  it('centres a single point instead of pinning it to the left edge', () => {
    expect(project(series([72.6]), opts).points[0].x).toBe(50);
  });

  it('puts the highest value at the top — y grows downward in SVG', () => {
    const geo = project(series([10, 20]), opts);
    expect(geo.points[1].y).toBeLessThan(geo.points[0].y);
  });

  it('survives a flat series without dividing by zero', () => {
    const geo = project(series([72.6, 72.6, 72.6]), opts);
    expect(geo.points.every(p => Number.isFinite(p.y))).toBe(true);
  });

  it('closes the area path back to the baseline', () => {
    const geo = project(series([1, 2]), opts);
    expect(geo.linePath.startsWith('M')).toBe(true);
    expect(geo.areaPath.endsWith('Z')).toBe(true);
  });

  it('keeps the goal inside the chart by including it in the domain', () => {
    // The goal is far below every reading; its line must still be on-canvas.
    const geo = project(series([72, 73]), { ...opts, goal: 70 });
    expect(geo.goalY).not.toBeNull();
    expect(geo.goalY!).toBeGreaterThanOrEqual(0);
    expect(geo.goalY!).toBeLessThanOrEqual(50);
  });

  it('has no goal line when no goal is set', () => {
    expect(project(series([1, 2]), opts).goalY).toBeNull();
  });

  /** Design page 06: "Bars that clear it are filled solid." */
  it('marks the bars that clear the goal', () => {
    const geo = project(series([8000, 12000, 9000]), { ...opts, goal: 10000 });
    expect(geo.bars.map(b => b.hitsGoal)).toEqual([false, true, false]);
  });

  it('gives every bar a positive height so nothing vanishes', () => {
    const geo = project(series([0, 5, 10]), opts);
    expect(geo.bars.every(b => b.height >= 1)).toBe(true);
  });

  it('shares one vertical scale between the line and the bars', () => {
    const geo = project(series([1, 5, 3]), opts);
    // Bars sit in slots rather than on the line's vertices, but both variants
    // read the same y — one scale, computed once.
    geo.bars.forEach((bar, i) => {
      expect(bar.y).toBe(geo.points[i].y);
    });
  });

  it('keeps bars in order, left to right', () => {
    const geo = project(series([1, 5, 3]), opts);
    expect(geo.bars[0].x).toBeLessThan(geo.bars[1].x);
    expect(geo.bars[1].x).toBeLessThan(geo.bars[2].x);
  });
});

describe('gridlines', () => {
  const opts = { width: 100, height: 50, padding: 0 };

  it('reports the value each rule sits at, for the y axis to label', () => {
    const geo = project(series([70, 80]), opts);
    expect(geo.gridlines).toHaveLength(3);
    // Top rule is nearest the high end of the domain.
    expect(geo.gridlines[0].value).toBeGreaterThan(geo.gridlines[2].value);
  });

  it('reports the domain, widened to include the goal', () => {
    const geo = project(series([72, 73]), { ...opts, goal: 70 });
    expect(geo.domain.lo).toBe(70);
    expect(geo.domain.hi).toBe(73);
  });

  it('is empty for an empty series', () => {
    const geo = project([], opts);
    expect(geo.gridlines).toEqual([]);
    expect(geo.domain).toEqual({ lo: 0, hi: 0 });
  });
});

describe('pickTicks', () => {
  it('labels every point when there are few enough', () => {
    expect(pickTicks(3, 4)).toEqual([0, 1, 2]);
  });

  /** 90 dates in a phone width is a smear, so a handful stand for the rest. */
  it('thins a dense series down to the asked-for count', () => {
    expect(pickTicks(90, 4)).toHaveLength(4);
  });

  it('always includes the first and last point', () => {
    const ticks = pickTicks(90, 4);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(89);
  });

  it('spreads them evenly', () => {
    expect(pickTicks(7, 4)).toEqual([0, 2, 4, 6]);
  });

  it('returns nothing for nothing', () => {
    expect(pickTicks(0)).toEqual([]);
  });

  it('never repeats an index', () => {
    const ticks = pickTicks(5, 4);
    expect(new Set(ticks).size).toBe(ticks.length);
  });
});

describe('summarise', () => {
  it('is null with no data', () => {
    expect(summarise([])).toBeNull();
  });

  it('matches the stat cards on the metric screen', () => {
    const stats = summarise(series([73.1, 72.9, 72.5, 72.6]))!;
    expect(stats.highest).toBe(73.1);
    expect(stats.lowest).toBe(72.5);
    expect(stats.average).toBeCloseTo(72.775, 3);
  });

  it('reports change first-to-last, negative when the value fell', () => {
    expect(summarise(series([73.1, 72.6]))!.change).toBeCloseTo(-0.5, 5);
  });
});

/**
 * The statistics describe different things per metric, and which series they
 * are handed is the whole decision.
 *
 * Running them off the day buckets got weight visibly wrong on screen: 20 kg
 * and 80 kg logged the same afternoon collapse to one bucket, so average,
 * lowest and highest all reported the same number. These pin the arithmetic;
 * the choice of input lives in MetricDetailScreen.
 */
describe('summarise over readings rather than day buckets', () => {
  const readings = [20, 80].map((value, day) => ({ day, value }));

  it('separates average, lowest and highest when given both readings', () => {
    const stats = summarise(readings);
    expect(stats).not.toBeNull();
    expect(stats?.average).toBe(50);
    expect(stats?.lowest).toBe(20);
    expect(stats?.highest).toBe(80);
  });

  /** One point collapses all three — which is exactly what was on screen. */
  it('collapses to a single number when handed one collapsed bucket', () => {
    const stats = summarise([{ day: 0, value: 20 }]);
    expect(stats?.average).toBe(20);
    expect(stats?.lowest).toBe(20);
    expect(stats?.highest).toBe(20);
  });

  /** `change` is first-to-last, so the input has to be chronological. */
  it('reads the trend from the order it is given', () => {
    expect(summarise(readings)?.change).toBe(60);
    expect(summarise([...readings].reverse())?.change).toBe(-60);
  });
});
