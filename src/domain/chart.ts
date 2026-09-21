/**
 * Chart geometry. Pure — no React, no SVG, no measuring.
 *
 * One projection shared by the line and bar variants, and by the dashboard
 * sparklines. Hand-rolled rather than a charting library: this is the part
 * worth testing, and a pure function is directly testable where a rendered
 * chart is not.
 */

export interface Point {
  day: number;
  value: number;
}

export interface Plotted extends Point {
  x: number;
  y: number;
}

export interface Bar extends Plotted {
  width: number;
  height: number;
  /** Bars that clear the goal are filled solid (design page 06). */
  hitsGoal: boolean;
}

/** A horizontal rule, and the value it sits at. */
export interface Gridline {
  y: number;
  value: number;
}

export interface Geometry {
  points: Plotted[];
  /** `M…L…` for the line variant. */
  linePath: string;
  /** The same line closed to the baseline, for the tinted fill. */
  areaPath: string;
  bars: Bar[];
  /** Where to draw the dashed goal line, or null when there is no goal. */
  goalY: number | null;
  /** The value range actually plotted, after the goal is folded in. */
  domain: { lo: number; hi: number };
  /** Rules to draw, and the y-axis labels that go with them. */
  gridlines: Gridline[];
}

export interface ProjectOptions {
  width: number;
  height: number;
  goal?: number | null;
  /** Vertical inset. */
  padding?: number;
  /**
   * Horizontal inset. Without it the first and last points sit exactly on the
   * edges, so half the line stroke and the whole end-point marker fall outside
   * the SVG and are clipped. Defaults to room for a 4px marker plus its stroke.
   */
  padX?: number;
}

/**
 * Average every bucket down to at most `max` points.
 *
 * Three years of daily readings is over a thousand points for a few hundred
 * pixels. Rendering them all costs memory and draws nothing the eye can see,
 * so the series is reduced before it is projected.
 */
export function downsample(series: Point[], max = 60): Point[] {
  if (series.length <= max) return series;

  const bucketSize = Math.ceil(series.length / max);
  const out: Point[] = [];
  for (let i = 0; i < series.length; i += bucketSize) {
    const bucket = series.slice(i, i + bucketSize);
    out.push({
      day: bucket[0].day,
      value: bucket.reduce((sum, p) => sum + p.value, 0) / bucket.length,
    });
  }
  return out;
}

/** Scale and project a series into view space. Y grows downward, as in SVG. */
export function project(series: Point[], opts: ProjectOptions): Geometry {
  const { width, height, goal = null, padding = 4, padX = 6 } = opts;
  const points = downsample(series);

  if (points.length === 0) {
    return {
      points: [], linePath: '', areaPath: '', bars: [], goalY: null,
      domain: { lo: 0, hi: 0 }, gridlines: [],
    };
  }

  const values = points.map(p => p.value);
  // The goal joins the domain so its line is always inside the chart.
  const lo = Math.min(...values, goal ?? Infinity);
  const hi = Math.max(...values, goal ?? -Infinity);
  // A flat series would divide by zero, so give it an arbitrary band.
  const range = hi - lo || Math.abs(hi) || 1;

  const top = padding;
  const usable = Math.max(1, height - padding * 2);
  const toY = (value: number) => top + (1 - (value - lo) / range) * usable;

  // Inset both ends so strokes and markers stay inside the canvas.
  const left = padX;
  const span = Math.max(1, width - padX * 2);
  // A single point sits in the middle rather than hugging the left edge.
  const step = points.length > 1 ? span / (points.length - 1) : 0;
  const plotted: Plotted[] = points.map((p, i) => ({
    ...p,
    x: points.length > 1 ? left + i * step : width / 2,
    y: toY(p.value),
  }));

  const linePath = plotted
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`)
    .join(' ');

  // Close to the baseline at the inset edges, not the canvas edges.
  const areaPath = linePath
    ? `${linePath} L${round(width - padX)} ${round(height)} ` +
      `L${round(padX)} ${round(height)} Z`
    : '';

  /**
   * Bars get their own x: one equal slot per point, centred in its slot.
   *
   * Centring them on the line's points instead would push the first and last
   * bars half their own width past the inset, so both ends would be clipped —
   * a bar chart needs slots, not shared vertices.
   */
  const slot = span / points.length;
  const barWidth = slot * 0.62;
  const bars: Bar[] = plotted.map((p, i) => ({
    ...p,
    x: left + slot * (i + 0.5) - barWidth / 2,
    width: barWidth,
    height: Math.max(1, height - padding - p.y),
    hitsGoal: goal != null && p.value >= goal,
  }));

  // The same three fractions the chart has always drawn, now carrying the
  // value each one represents so the y axis can label them.
  const gridlines: Gridline[] = [0.25, 0.5, 0.75].map(f => ({
    y: top + f * usable,
    value: hi - f * range,
  }));

  return {
    points: plotted,
    linePath,
    areaPath,
    bars,
    goalY: goal == null ? null : toY(goal),
    domain: { lo, hi },
    gridlines,
  };
}

/**
 * Evenly spread indices for axis labels, always including the first and last.
 *
 * Every point cannot be labelled — 90 dates in a phone width is a smear — so a
 * handful are picked and the rest are implied by the spacing.
 */
export function pickTicks(total: number, max = 4): number[] {
  if (total <= 0) return [];
  if (total <= max) return Array.from({ length: total }, (_, i) => i);
  const step = (total - 1) / (max - 1);
  const picked = Array.from({ length: max }, (_, i) => Math.round(i * step));
  return [...new Set(picked)];
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** AVERAGE / LOWEST / HIGHEST on the metric screen. */
export function summarise(series: Point[]) {
  if (series.length === 0) return null;
  const values = series.map(p => p.value);
  return {
    average: values.reduce((a, b) => a + b, 0) / values.length,
    lowest: Math.min(...values),
    highest: Math.max(...values),
    /** First to last. Negative means the value fell over the window. */
    change: values[values.length - 1] - values[0],
  };
}
