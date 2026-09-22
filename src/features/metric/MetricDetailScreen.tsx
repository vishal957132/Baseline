import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSelector } from 'react-redux';

import type { RootStackParams } from '../../app/navigation';
import { selectGoals } from '../../app/store/goalsSlice';
import { selectUnits } from '../../app/store/unitsSlice';
import {
  bucketByDay, listRange, pendingLineageIds,
} from '../../data/measurementRepo';
import { useQuery } from '../../data/useQuery';
import { summarise } from '../../domain/chart';
import {
  goalMet, goalProgress, goalRemaining, metric,
} from '../../domain/metrics';
import {
  deviceTzOffsetMs, localDayIndex, RANGE_DAYS, RANGE_LABELS, rangeWindow,
  type RangeId,
} from '../../domain/time';
import { formatDisplay, unitFor } from '../../domain/units';
import {
  Button, Card, Chip, EmptyState, Icon, ProgressBar, Screen, ScreenHeader, Skeleton, Text, color, radius, space,
} from '../../ui';
import { confirmDeleteMeasurement } from '../components/confirmDelete';
import { MeasurementRow } from '../components/MeasurementRow';
import { rowStatus } from '../components/rowStatus';
import { MetricChart } from '../components/MetricChart';

export function MetricDetailScreen() {
  const { metricId } = useRoute<RouteProp<RootStackParams, 'MetricDetail'>>().params;
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const units = useSelector(selectUnits);
  const [range, setRange] = useState<RangeId>('7d');

  const d = metric(metricId);
  const unit = unitFor(metricId, units);
  const tz = deviceTzOffsetMs();
  const { from, to } = rangeWindow(range, Date.now(), tz);
  // Goals are local settings, written by the onboarding screen.
  const storedGoal = useSelector(selectGoals)[metricId] ?? null;

  const chart = useQuery(() => bucketByDay(metricId, from, to, tz), [metricId, from, to]);

  /*
   * Which range to open on.
   *
   * It always opened on 7 days, so a reading taken a fortnight ago met "No
   * weight yet" on the very screen built to show it — the reading existed, the
   * default window simply did not reach it. This reads the widest window once
   * and starts on the narrowest range that actually contains something.
   *
   * Only ever applied once, so it cannot fight a range the user picks.
   */
  const widest = rangeWindow('3mo', Date.now(), tz);
  const span = useQuery(
    () => bucketByDay(metricId, widest.from, widest.to, tz),
    [metricId, widest.from, widest.to],
  );
  // Any reading within the widest range, which is what separates "nothing
  // recorded yet" from "nothing in the window you happen to be looking at".
  const hasAnyReading = (span.data?.length ?? 0) > 0;
  const chosen = useRef(false);
  useEffect(() => {
    if (chosen.current || !span.data) return;
    chosen.current = true;
    const fits = narrowestWithData(span.data.map(b => b.day), tz);
    if (fits !== null) setRange(fits);
  }, [span.data, tz]);
  const recent = useQuery(() => listRange(metricId, from, to), [metricId, from, to]);
  const pending = useQuery(() => pendingLineageIds(), []);

  /*
   * Converted once, here, rather than at each label: the chart draws its own
   * y-axis, and axis numbers in kilograms under a heading in pounds is the
   * kind of thing nobody notices until it is shipped. Every conversion is a
   * linear scale through zero, so the shape of the line is unchanged.
   */
  // Everything below this line is in display units. Nothing on this screen may
  // call `formatIn`, which would convert a second time.
  const convert = (v: number) => unit.toDisplay(v);
  const stored = chart.data ?? [];
  const series = unit.toDisplay(1) === 1
    ? stored
    : stored.map(p => ({ ...p, value: convert(p.value) }));

  /*
   * AVERAGE / LOWEST / HIGHEST describe different things per metric, and
   * running both off the day buckets got weight visibly wrong: two readings on
   * one day collapse to a single bucket, so all three statistics reported the
   * same number — 20 kg and 80 kg logged on the same afternoon read as
   * "average 20, lowest 20, highest 20".
   *
   * A cumulative metric's unit really is the day: the highest water day is
   * 2.6 L, not the largest single glass. A point-in-time metric's unit is the
   * reading: the lowest weight this month is a number that was actually on the
   * scale, whatever else was recorded that day.
   */
  const readings = recent.data ?? [];
  const statsPoints = d.aggregate === 'sum'
    ? series
    // listRange returns newest first; `change` is first-to-last, so this has
    // to be chronological or the trend arrow points the wrong way.
    : [...readings]
        .reverse()
        .map((m, i) => ({ day: i, value: convert(m.value) }));
  const stats = summarise(statsPoints);

  /*
   * The headings have to name the unit of measurement, not just the metric.
   *
   * A cumulative metric summarises days: the highest water is the best day,
   * not the largest single glass, so "HIGHEST DAY" is both what is computed
   * and what is useful. A point-in-time metric summarises readings: the lowest
   * weight is a number that was actually on the scale.
   */
  const labels = d.aggregate === 'sum'
    ? { average: 'AVG / DAY', lowest: 'LOWEST DAY', highest: 'HIGHEST DAY' }
    : { average: 'AVERAGE', lowest: 'LOWEST', highest: 'HIGHEST' };

  const basisCount = statsPoints.length;
  const statsBasis = d.aggregate === 'sum'
    ? `From ${basisCount} day${basisCount === 1 ? '' : 's'} with a reading${
        basisCount === 1 ? ' — a single day is its own highest and lowest' : ''}`
    : `From ${basisCount} reading${basisCount === 1 ? '' : 's'} in this range`;
  const latest = series[series.length - 1]?.value ?? null;
  const goal = storedGoal === null ? null : unit.toDisplay(storedGoal);

  return (
    <Screen style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <ScreenHeader
          title={d.label}
          onBack={nav.goBack}
          right={d.editable ? (
            <Pressable onPress={() => nav.navigate('LogEntry', { metricId })} style={styles.add}>
              <Icon name="plus" size={20} color={color.textInverse} />
            </Pressable>
          ) : <Chip label="Imported" tone="provider" />}
        />

        {chart.loading && !chart.data ? (
          <Card><Skeleton height={140} /></Card>
        ) : !hasAnyReading ? (
          <EmptyState
            icon="chart-empty"
            title={`No ${d.label.toLowerCase()} yet`}
            body="Add one measurement and the chart starts. Two gives you a trend."
            actionLabel={d.editable ? 'Add your first entry' : undefined}
            onAction={d.editable ? () => nav.navigate('LogEntry', { metricId }) : undefined}
          />
        ) : (
          <>
            <View style={styles.headline}>
              <Text variant="display">
                {latest === null ? '—' : formatDisplay(unit, latest)}
              </Text>
              <Text variant="body" color="textMuted">{unit.label}</Text>
              {stats && series.length > 1 && (
                <Text variant="label" color={stats.change < 0 ? 'success' : 'ink'}>
                  {`${stats.change < 0 ? '↓' : '↑'} ${formatDisplay(unit, Math.abs(stats.change))} over ${RANGE_DAYS[range]} days`}
                </Text>
              )}
            </View>

            {/*
              The chips render whenever the metric has any reading at all, not
              only when the selected range has one.
              They used to sit inside the "we have data" branch, so choosing a
              range that turned out to be empty replaced the whole screen with
              the empty state — chips included. You could switch from 30 days
              to 7 and then had no way back: the control that would undo the
              choice had been removed by the choice.
            */}
            <View style={styles.ranges}>
              {(Object.keys(RANGE_DAYS) as RangeId[]).map(r => (
                <Pressable
                  key={r}
                  onPress={() => setRange(r)}
                  style={[styles.range, r === range && styles.rangeOn]}
                >
                  <Text variant="label" color={r === range ? 'textInverse' : 'text'}>
                    {RANGE_LABELS[r]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {series.length === 0 ? (
              <Card>
                <View style={styles.thin}>
                  <Text variant="label" align="center">
                    {`No ${d.label.toLowerCase()} in the last ${RANGE_DAYS[range]} days`}
                  </Text>
                  <Text variant="caption" color="textMuted" align="center">
                    Your readings are older than this. Try a longer range.
                  </Text>
                </View>
              </Card>
            ) : (
              <>
            <Card>
              {series.length === 1 ? (
                <View style={styles.thin}>
                  {/*
                    Counted in days, not readings: the chart plots one point per
                    day, so two readings this afternoon still draw a single
                    point. Saying "one reading so far" under a list showing two
                    of them is the kind of small lie that costs trust in the
                    numbers beside it.
                  */}
                  <Text variant="label" align="center">One day with a reading</Text>
                  <Text variant="caption" color="textMuted" align="center">
                    A reading on a second day gives you a direction.
                  </Text>
                </View>
              ) : (
                <MetricChart
                  series={series}
                  height={168}
                  variant={d.aggregate === 'sum' && metricId !== 'water' ? 'bars' : 'line'}
                  goal={goal}
                  xAxis
                  yAxis
                />
              )}
            </Card>

            {stats && (
              <>
                <View style={styles.stats}>
                  <Stat label={labels.average} value={formatDisplay(unit, stats.average)} unit={unit.label} />
                  <Stat label={labels.lowest} value={formatDisplay(unit, stats.lowest)} unit={unit.label} />
                  <Stat label={labels.highest} value={formatDisplay(unit, stats.highest)} unit={unit.label} />
                </View>
                {/*
                  What the three numbers were computed from.
                  Without it, a cumulative metric with one day of data shows
                  the same figure three times and looks broken — when in fact
                  "highest day" and "lowest day" of a single day are the same
                  day. Saying how many went in makes that legible instead of
                  suspicious.
                */}
                <Text variant="caption" color="textMuted">
                  {statsBasis}
                </Text>
              </>
            )}

            {goal !== null && latest !== null && (
              <Card style={styles.goal}>
                <View style={styles.goalHead}>
                  <Text variant="label">{`Goal · ${formatDisplay(unit, goal)} ${unit.label}`}</Text>
                  <Text
                    variant="caption"
                    color={goalMet(metricId, latest, goal) ? 'success' : 'textMuted'}
                  >
                    {goalMet(metricId, latest, goal)
                      ? 'Goal met'
                      : `${formatDisplay(unit, goalRemaining(metricId, latest, goal))} ${unit.label} to go`}
                  </Text>
                </View>
                {/* Direction-aware: a falling metric cannot use value / goal. */}
                <ProgressBar value={goalProgress(metricId, latest, goal)} max={1} />
                <Text variant="caption" color="textMuted">
                  {`${series.length} of ${RANGE_DAYS[range]} days have a reading.`}
                </Text>
              </Card>
            )}

            <Text variant="caption" color="textMuted">RECENT ENTRIES</Text>
            <Card style={styles.list}>
              {(recent.data ?? []).slice(0, 3).map(m => (
                <MeasurementRow
                  key={m.id}
                  measurement={m}
                  unit={unit}
                  status={rowStatus(m, pending.data ?? new Set())}
                  onEdit={d.editable
                    ? r => nav.navigate('LogEntry', { metricId, measurementId: r.id })
                    : undefined}
                  onDelete={d.editable ? r => confirmDeleteMeasurement(r, units) : undefined}
                />
              ))}
            </Card>

              </>
            )}

            {!d.editable && (
              <Text variant="caption" color="textMuted">
                {`${d.label} is read-only — it comes from your connected source.`}
              </Text>
            )}

            {d.editable && series.length === 1 && (
              <Button label="Add another measurement" onPress={() => nav.navigate('LogEntry', { metricId })} />
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * The narrowest range holding at least one of these days, or null when none do.
 *
 * Days are compared as local day indices — the same unit the buckets are keyed
 * by — so this never re-does the timezone arithmetic that produced them.
 */
function narrowestWithData(days: number[], tzOffsetMs: number): RangeId | null {
  if (days.length === 0) return null;
  const newest = Math.max(...days);
  for (const range of Object.keys(RANGE_DAYS) as RangeId[]) {
    const { from } = rangeWindow(range, Date.now(), tzOffsetMs);
    if (newest >= localDayIndex(from, tzOffsetMs)) return range;
  }
  return null;
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <Card style={styles.stat}>
      <Text variant="caption" color="textMuted">{label}</Text>
      <Text variant="label">{`${value} ${unit}`}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  body: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.xxl },
  add: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.ink, borderRadius: radius.md,
  },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  ranges: { flexDirection: 'row', gap: space.sm },
  range: {
    flex: 1, alignItems: 'center', paddingVertical: space.md,
    backgroundColor: color.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: color.border,
  },
  rangeOn: { backgroundColor: color.ink, borderColor: color.ink },
  thin: { gap: space.xs, paddingVertical: space.xl },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, gap: space.xs, padding: space.md },
  goal: { gap: space.sm },
  goalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  list: { padding: 0, overflow: 'hidden' },
});
