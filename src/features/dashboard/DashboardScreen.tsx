import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSelector } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';

import { bucketByDay } from '../../data/measurementRepo';
import { getGoals } from '../../data/prefs';
import { useQuery } from '../../data/useQuery';
import { isImprovement, metric } from '../../domain/metrics';
import { deviceTzOffsetMs, rangeWindow } from '../../domain/time';
import type { MetricId } from '../../domain/types';
import { formatIn, unitFor, type UnitOption, type UnitPrefs } from '../../domain/units';
import type { RootStackParams } from '../../app/navigation';
import { selectQueuedCount, selectSync } from '../../app/store/syncSlice';
import { selectUnits } from '../../app/store/unitsSlice';
import { Banner, Button, Card, ProgressRing, ScreenHeader, Skeleton, space, Text } from '../../ui';
import { MetricCard } from '../components/MetricCard';

/** Only used when the user has cleared a goal; onboarding sets real ones. */
const FALLBACK_STEPS_GOAL = 10_000;

/** Each card owns its own query, so one slow metric cannot blank the screen. */
function useMetric(metricId: MetricId) {
  const tz = deviceTzOffsetMs();
  const { from, to } = rangeWindow('7d', Date.now(), tz);
  return useQuery(() => bucketByDay(metricId, from, to, tz), [metricId, from, to]);
}

export function DashboardScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const sync = useSelector(selectSync);
  const queued = useSelector(selectQueuedCount);
  const units = useSelector(selectUnits);
  // Read once per render rather than held in state: the goals screen writes
  // them, and coming back here remounts this screen.
  const goals = getGoals();
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
  const stepsToday = steps.data?.[steps.data.length - 1]?.value ?? null;

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
    <SafeAreaView style={styles.screen} edges={['top']}>
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
          <ProgressRing value={stepsToday ?? 0} max={stepsGoal} />
          <View style={styles.ringBody}>
            <Text variant="caption" color="textMuted">DAILY STEPS GOAL</Text>
            {steps.loading && !steps.data ? (
              <Skeleton height={30} width="60%" />
            ) : (
              <Text variant="metric">
                {`${stepsToday === null ? '—' : Math.round(stepsToday).toLocaleString()} of ${stepsGoal.toLocaleString()}`}
              </Text>
            )}
            <Text variant="caption" color="textMuted">{stamp(steps.readAt, steps.error)}</Text>
          </View>
        </Card>

        <View style={styles.grid}>
          <Summary metricId="weight" q={weight} units={units} onPress={open('weight')} />
          <Summary metricId="sleep" q={sleep} units={units} onPress={open('sleep')} />
        </View>
        <View style={styles.grid}>
          <Summary metricId="water" q={water} units={units} target={goals.water ?? null}
            onPress={open('water')} />
          <Summary metricId="energy" q={energy} units={units} onPress={open('energy')} />
        </View>

        <Button label="Log a measurement" icon="plus" onPress={() => nav.navigate('LogEntry', {})} />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Turns one query into one card, including its loading and failed states. */
function Summary({
  metricId, q, units, target, onPress,
}: {
  metricId: MetricId;
  q: ReturnType<typeof useMetric>;
  units: UnitPrefs;
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

  const series = q.data ?? [];
  const latest = series[series.length - 1]?.value ?? null;
  const stats = series.length > 1
    ? series[series.length - 1].value - series[0].value
    : 0;

  return (
    <MetricCard
      metricId={metricId}
      unit={unit}
      value={latest}
      source={metricId === 'steps' || metricId === 'energy' ? 'apple_health' : 'manual'}
      series={series}
      target={target}
      note={q.error ? 'Source did not answer' : trend(metricId, unit, stats, q.readAt)}
      noteTone={q.error ? 'danger' : isImprovement(metricId, stats) ? 'success' : 'textMuted'}
      onPress={onPress}
    />
  );
}

function trend(
  metricId: MetricId, unit: UnitOption, change: number, readAt: number | null,
): string {
  if (readAt === null) return '';
  if (change === 0) return 'no change this week';
  const arrow = change < 0 ? '↓' : '↑';
  // The delta is a difference between two stored values, so it converts the
  // same way a reading does — every unit here is a linear scale through zero.
  return `${arrow} ${formatIn(unit, Math.abs(change))} ${unit.label} this week`;
}

/** Design page 11: cached values keep the time they were read. */
function stamp(readAt: number | null, error: string | null): string {
  if (error) return 'could not refresh — showing cached';
  if (readAt === null) return 'reading…';
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
