import React, { useMemo, useState } from 'react';
import {
  ScrollView, StyleSheet, View, type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { pickTicks, project, type Point } from '../../domain/chart';
import { formatDayShort } from '../../domain/time';
import { color, font, space, Text } from '../../ui';

/** Room under the plot for the date row. */
const X_AXIS_HEIGHT = 18;
/** Width of the fixed y-axis gutter. */
const Y_AXIS_WIDTH = 34;

interface Props {
  series: Point[];
  /** Total height, axes included. */
  height: number;
  /**
   * Fixed width. Omit it and the chart measures its own container and fills
   * the space available — an SVG needs a pixel width, so it cannot simply be
   * told `100%` the way a View can.
   */
  width?: number;
  variant?: 'line' | 'bars';
  goal?: number | null;
  /** Sparkline mode: no axes, no gridlines, no goal line, no end marker. */
  bare?: boolean;
  /** Dates under the plot. */
  xAxis?: boolean;
  /**
   * Values down the left. Off by default: the design labels no y axis, because
   * the AVERAGE / LOWEST / HIGHEST cards under the chart carry the numbers.
   */
  yAxis?: boolean;
  /** How many dates to label. Every point would be a smear. */
  xTicks?: number;
  /**
   * Least horizontal room a point may have before the chart starts scrolling
   * instead of squeezing. Three months is ~90 points, which in a phone-width
   * card leaves each bar under 2px — present, but not readable.
   */
  minPointSpacing?: number;
}

/**
 * One chart, two shapes. Both read from the same `project()` in domain/chart —
 * the maths is shared and unit-tested, and this file only draws.
 *
 * The date labels live inside the SVG so they scroll with the canvas and stay
 * under their own points. The y axis sits outside it, in a fixed gutter, so it
 * does not slide away when the plot is scrolled.
 */
export function MetricChart({
  series, height, width, variant = 'line', goal = null, bare,
  xAxis, yAxis, xTicks = 4, minPointSpacing = 14,
}: Props) {
  // Only consulted when no explicit width was given.
  const [measured, setMeasured] = useState(0);
  const onLayout = (event: LayoutChangeEvent) =>
    setMeasured(event.nativeEvent.layout.width);

  const measure = width === undefined ? onLayout : undefined;
  const showY = Boolean(yAxis) && !bare;
  const showX = Boolean(xAxis) && !bare;

  const outer = width ?? measured;
  // The gutter is taken out before the plot is sized, so the two never overlap.
  const plotWidth = showY ? outer - Y_AXIS_WIDTH : outer;
  const plotHeight = showX ? height - X_AXIS_HEIGHT : height;

  // Draw at whichever is wider: the plot area, or the room the points need.
  // A sparkline never scrolls — it is a glance, not something to explore.
  const drawWidth = bare ? plotWidth : Math.max(plotWidth, series.length * minPointSpacing);
  const scrolls = drawWidth > plotWidth;

  // Downsampling a thousand points and building two path strings is the one
  // genuinely costly thing this component does, and the dashboard re-renders
  // whenever any of its five queries resolves. Recompute only when the shape
  // of the chart actually changes.
  //
  // Computed before the early return below, because a hook may not be skipped.
  // `project` answers an empty series with empty geometry, so this is safe
  // even on the first frame when nothing has been measured yet.
  const geo = useMemo(
    () => project(series, {
      width: Math.max(1, drawWidth),
      height: Math.max(1, plotHeight),
      goal: bare ? null : goal,
    }),
    [series, drawWidth, plotHeight, goal, bare],
  );

  // Width zero is the first frame, before layout has run. Drawing then would
  // collapse every point onto x=0, so hold the space and wait.
  if (series.length === 0 || plotWidth <= 0) {
    return (
      <View testID="metric-chart" style={[styles.fill, { height }]}
        onLayout={measure} />
    );
  }

  const last = geo.points[geo.points.length - 1];
  const ticks = showX ? pickTicks(geo.points.length, xTicks) : [];

  const canvas = (
    <Svg width={drawWidth} height={height}>
      {!bare && geo.gridlines.map(line => (
        <Line key={line.y} x1={0} x2={drawWidth} y1={line.y} y2={line.y}
          stroke={color.border} strokeWidth={1} />
      ))}

      {variant === 'bars'
        ? geo.bars.map(bar => (
            <Rect key={bar.day} x={bar.x} y={bar.y} width={bar.width}
              height={bar.height} rx={3}
              fill={bar.hitsGoal ? color.ink : color.soft} />
          ))
        : (
          <>
            {!bare && <Path d={geo.areaPath} fill={color.areaFill} />}
            <Path d={geo.linePath} stroke={color.ink} strokeWidth={2} fill="none"
              strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}

      {/* The dashed line is the goal (design page 06). */}
      {geo.goalY !== null && (
        <Line x1={0} x2={drawWidth} y1={geo.goalY} y2={geo.goalY}
          stroke={color.soft} strokeWidth={1.5} strokeDasharray="4 4" />
      )}

      {!bare && variant === 'line' && (
        <Circle cx={last.x} cy={last.y} r={4} fill={color.card}
          stroke={color.ink} strokeWidth={2} />
      )}

      {ticks.map(i => {
        const point = geo.points[i];
        // The first and last labels are anchored inward so they are not
        // half-cut by the edge of the canvas.
        const anchor = i === 0 ? 'start' : i === geo.points.length - 1 ? 'end' : 'middle';
        return (
          <SvgText
            key={`x-${point.day}`}
            x={point.x}
            y={height - 5}
            fontSize={font.caption.fontSize}
            fill={color.textMuted}
            textAnchor={anchor}
          >
            {formatDayShort(point.day)}
          </SvgText>
        );
      })}
    </Svg>
  );

  return (
    <View testID="metric-chart" style={[styles.fill, styles.row]} onLayout={measure}>
      {showY && (
        <View style={[styles.yAxis, { height: plotHeight }]}>
          {geo.gridlines.map(line => (
            <Text key={line.y} variant="caption" color="textMuted" align="right">
              {axisLabel(line.value, geo.domain.hi - geo.domain.lo)}
            </Text>
          ))}
        </View>
      )}

      {scrolls ? (
        <ScrollView
          horizontal
          testID="metric-chart-scroll"
          showsHorizontalScrollIndicator
          // The newest reading is the interesting end, so open there.
          ref={ref => ref?.scrollToEnd({ animated: false })}
        >
          {canvas}
        </ScrollView>
      ) : (
        canvas
      )}
    </View>
  );
}

/**
 * Axis labels want to be short, but not so short they repeat.
 *
 * Precision follows the span, not the value: three rules over a 0.3 kg range
 * all read "72.8" at one decimal, which looks broken. Steps in the thousands
 * get a k instead, because "8140" in a 34px gutter does not fit.
 */
function axisLabel(value: number, span: number): string {
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`;
  if (span < 1) return value.toFixed(2);
  if (span < 20) return value.toFixed(1);
  return String(Math.round(value));
}

const styles = StyleSheet.create({
  /** Fills the parent's width, so what gets measured is the space available. */
  fill: { width: '100%' },
  row: { flexDirection: 'row' },
  /**
   * Outside the scroll area, so the values stay put while the plot moves.
   * Spread to line up with the gridlines they label.
   */
  yAxis: {
    width: Y_AXIS_WIDTH,
    paddingRight: space.sm,
    justifyContent: 'space-around',
  },
});
