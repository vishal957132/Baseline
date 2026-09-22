import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSelector } from 'react-redux';

import { bucketByDay } from '../../data/measurementRepo';
import { useQuery } from '../../data/useQuery';
import { isImprovement, metric } from '../../domain/metrics';
import {
  deviceTzOffsetMs, formatDayShort, localDayIndex, rangeWindow,
} from '../../domain/time';
import type { DayBucket, MetricId } from '../../domain/types';
import { formatIn, unitFor, type UnitOption, type UnitPrefs } from '../../domain/units';
import type { RootStackParams } from '../../app/navigation';
import { selectQueuedCount, selectSync } from '../../app/store/syncSlice';
import { selectGoals } from '../../app/store/goalsSlice';
import { selectUnits } from '../../app/store/unitsSlice';
import {
  Banner, Button, Card, ProgressRing, Screen, ScreenHeader, Skeleton, Text, space,
} from '../../ui';
import { MetricCard } from '../components/MetricCard';

/** Only used when the user has cleared a goal; onboarding sets real ones. */
const FALLBACK_STEPS_GOAL = 10_000;

/** How many recent days with data the sparkline draws. */
const SPARK_DAYS = 7;

/**
 * Each card owns its own query, so one slow metric cannot blank the screen.
 *
 * The window is three months rather than a week. It used to be a week, and a
 * reading taken eight days ago made the card read "—" as though the entry had
 * been lost — the data was there, just outside the window the card happened to
 * ask about. Reading the wider window once costs 0.30 ms and means the card
 * can always show the most recent reading, stamped with the day it was taken.
 *
 * One query rather than trying 7 days, then 30, then 90: the widest answer
 * contains all the narrower ones.
 */
function useMetric(metricId: MetricId) {
  const tz = deviceTzOffsetMs();
  const { from, to } = rangeWindow('3mo', Date.now(), tz);
  return useQuery(() => bucketByDay(metricId, from, to, tz), [metricId, from, to]);
}

/** The most recent day that has a reading, with the day it belongs to. */
function latestOf(days: DayBucket[] | null): DayBucket | null {
  return days && days.length > 0 ? days[days.length - 1] : null;
}

export function DashboardScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const sync = useSelector(selectSync);
  const queued = useSelector(selectQueuedCount);
  const units = useSelector(selectUnits);
  // From the store, not MMKV: this screen lives in a tab that stays mounted,
  // so a goal saved in Settings would otherwise not reach it until a restart.
  const goals = useSelector(selectGoals);
  const stepsGoal = goals.steps ?? FALLBACK_STEPS_GOAL;

  // Stable per metric, so the memoised cards are not handed a new function on
  // every render — which would defeat the memo entirely.
  const open = useCallback(
    (metricId: MetricId) => () => nav.navigate('MetricDetail', { metricId }),
    [nav],
  );

  const steps = useMetric('steps');
  const weight = useMetric('weight');
  const sleep = useMetric('sleep');
  const water = useMetric('water');
  const energy = useMetric('energy');

  const today = new Date();
  const tz = deviceTzOffsetMs();
  const todayIndex = localDayIndex(Date.now(), tz);
  // The ring shows the most recent day with steps, not strictly today's — and
  // says which day that was when it is not today.
  const latestSteps = latestOf(steps.data);

  // One failing source degrades one card; the rest of the dashboard keeps
  // working on cached data (design page 15). The banner says which, and
  // retries only those — not the whole screen.
  const cards = [
    { id: 'steps' as const, q: steps },
    { id: 'weight' as const, q: weight },
    { id: 'sleep' as const, q: sleep },
    { id: 'water' as const, q: water },
    { id: 'energy' as const, q: energy },
  ];
  const failed = cards.filter(c => c.q.error);

  return (
    <Screen style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <ScreenHeader
          eyebrow={today.toLocaleString('en', { weekday: 'long' })}
          badge="DEMO DATA"
          title={`${today.getDate()} ${today.toLocaleString('en', { month: 'long' })}`}
        />

        {(!sync.online || queued > 0) && (
          <Banner
            tone="warn"
            icon="wifi-off"
            title={sync.online ? 'Catching up' : 'Offline'}
            subtitle={`${queued} change${queued === 1 ? '' : 's'} waiting to sync`}
            actionLabel="View"
            // The Sync tab, not the tab navigator: navigating to 'Tabs' from
            // inside it resolves to the tabs themselves and moves nowhere, so
            // the button looked broken.
            onAction={() => nav.navigate('Tabs', { screen: 'Sync' })}
          />
        )}

        {failed.length > 0 && (
          <Banner
            tone="danger"
            icon="alert-triangle"
            title={`${failed.map(f => metric(f.id).label).join(' and ')} did not answer`}
            subtitle={
              failed.length === cards.length
                ? 'Nothing could be refreshed. What you see is the last reading kept on this device.'
                : 'The other metrics are up to date. What you see here is still your own data, from the device.'
            }
            actionLabel="Try again"
            onAction={() => failed.forEach(f => f.q.reload())}
          />
        )}

        <Card style={styles.ring}>
          <ProgressRing value={latestSteps?.value ?? 0} max={stepsGoal} />
          <View style={styles.ringBody}>
            <Text variant="caption" color="textMuted">DAILY STEPS GOAL</Text>
            {steps.loading && !steps.data ? (
              <Skeleton height={30} width="60%" />
            ) : (
              <Text variant="metric">
                {`${latestSteps === null ? '—' : Math.round(latestSteps.value).toLocaleString()} of ${stepsGoal.toLocaleString()}`}
              </Text>
            )}
            <Text variant="caption" color="textMuted">
              {stamp(latestSteps, todayIndex, steps.readAt, steps.error)}
            </Text>
          </View>
        </Card>

        <View style={styles.grid}>
          <Summary metricId="weight" q={weight} units={units} today={todayIndex}
            onPress={open('weight')} />
          <Summary metricId="sleep" q={sleep} units={units} today={todayIndex}
            onPress={open('sleep')} />
        </View>
        <View style={styles.grid}>
          <Summary metricId="water" q={water} units={units} today={todayIndex}
            target={goals.water ?? null} onPress={open('water')} />
          <Summary metricId="energy" q={energy} units={units} today={todayIndex}
            onPress={open('energy')} />
        </View>

        <Button label="Log a measurement" icon="plus" onPress={() => nav.navigate('LogEntry', {})} />
      </ScrollView>
    </Screen>
  );
}

/** Turns one query into one card, including its loading and failed states. */
function Summary({
  metricId, q, units, today, target, onPress,
}: {
  metricId: MetricId;
  q: ReturnType<typeof useMetric>;
  units: UnitPrefs;
  /** Local day index of today, for deciding whether to stamp a date. */
  today: number;
  target?: number | null;
  onPress: () => void;
}) {
  const unit = unitFor(metricId, units);

  if (q.loading && !q.data) {
    return (
      <Card style={styles.cardSlot}>
        <Skeleton height={14} width="45%" />
        <Skeleton height={28} width="70%" />
        <Skeleton height={34} />
      </Card>
    );
  }

  const days = q.data ?? [];
  const latest = latestOf(days);
  // The last few days that actually have a reading, rather than the last few
  // calendar days — a sparse metric still draws a line instead of nothing.
  const series = days.slice(-SPARK_DAYS);
  const change = series.length > 1
    ? series[series.length - 1].value - series[0].value
    : 0;

  return (
    <MetricCard
      metricId={metricId}
      unit={unit}
      value={latest?.value ?? null}
      source={metricId === 'steps' || metricId === 'energy' ? 'apple_health' : 'manual'}
      series={series}
      target={target}
      note={q.error ? 'Source did not answer' : note(unit, latest, today, change)}
      noteTone={q.error ? 'danger' : isImprovement(metricId, change) ? 'success' : 'textMuted'}
      onPress={onPress}
    />
  );
}

/**
 * The line under the value.
 *
 * A reading from today gets the trend; an older one gets the day it was taken.
 * Saying "no change this week" under a figure measured a fortnight ago is the
 * kind of quietly wrong statement that costs trust in every other number on
 * the screen.
 */
function note(
  unit: UnitOption, latest: DayBucket | null, today: number, change: number,
): string {
  if (latest === null) return '';
  if (latest.day !== today) return `as of ${formatDayShort(latest.day)}`;
  if (change === 0) return 'no change recently';
  const arrow = change < 0 ? '↓' : '↑';
  // The delta is a difference between two stored values, so it converts the
  // same way a reading does — every unit here is a linear scale through zero.
  return `${arrow} ${formatIn(unit, Math.abs(change))} ${unit.label} recently`;
}

/**
 * The stamp under the steps ring.
 *
 * Two different facts, and the distinction matters: when the reading is from
 * today, the useful thing is when the screen last read it; when it is older,
 * the useful thing is which day it belongs to.
 */
function stamp(
  latest: DayBucket | null, today: number, readAt: number | null, error: string | null,
): string {
  if (error) return 'could not refresh — showing cached';
  if (readAt === null) return 'reading…';
  if (latest === null) return 'no steps recorded yet';
  if (latest.day !== today) return `as of ${formatDayShort(latest.day)}`;
  const at = new Date(readAt);
  return `as of ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F5F0' },
  body: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.xxl },
  ring: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  ringBody: { flex: 1, gap: space.xs },
  grid: { flexDirection: 'row', gap: space.md },
  cardSlot: { flex: 1, gap: space.sm, padding: space.md },
});
