import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RootStackParams } from '../../app/navigation';
import { bucketByDay, listRange } from '../../data/measurementRepo';
import { getGoals } from '../../data/prefs';
import { useQuery } from '../../data/useQuery';
import { summarise } from '../../domain/chart';
import { formatValue, metric } from '../../domain/metrics';
import {
  availableRanges, deviceTzOffsetMs, RANGE_DAYS, RANGE_LABELS, rangeWindow, type RangeId,
} from '../../domain/time';
import {
  Button, Card, Chip, color, EmptyState, Icon, ProgressBar, radius, ScreenHeader,
  Skeleton, space, Text,
} from '../../ui';
import { MeasurementRow } from '../components/MeasurementRow';
import { MetricChart } from '../components/MetricChart';

export function MetricDetailScreen() {
  const { metricId } = useRoute<RouteProp<RootStackParams, 'MetricDetail'>>().params;
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const [range, setRange] = useState<RangeId>('7d');

  const d = metric(metricId);
  const tz = deviceTzOffsetMs();
  const { from, to } = rangeWindow(range, Date.now(), tz);
  // Goals are local settings, written by the onboarding screen.
  const goal = getGoals()[metricId] ?? null;

  const chart = useQuery(() => bucketByDay(metricId, from, to, tz), [metricId, from, to]);
  const recent = useQuery(() => listRange(metricId, from, to), [metricId, from, to]);

  const series = chart.data ?? [];
  const stats = summarise(series);
  // "Ranges unlock as the window fills" — a one-point chart is a lie.
  const unlocked = availableRanges(series.length);
  const latest = series[series.length - 1]?.value ?? null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
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
        ) : series.length === 0 ? (
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
              <Text variant="display">{formatValue(metricId, latest ?? 0)}</Text>
              <Text variant="body" color="textMuted">{d.unit}</Text>
              {stats && series.length > 1 && (
                <Text variant="label" color={stats.change < 0 ? 'success' : 'ink'}>
                  {`${stats.change < 0 ? '↓' : '↑'} ${formatValue(metricId, Math.abs(stats.change))} over ${RANGE_DAYS[range]} days`}
                </Text>
              )}
            </View>

            <View style={styles.ranges}>
              {(Object.keys(RANGE_DAYS) as RangeId[]).map(r => {
                const enabled = unlocked.includes(r);
                return (
                  <Pressable
                    key={r}
                    disabled={!enabled}
                    onPress={() => setRange(r)}
                    style={[styles.range, r === range && styles.rangeOn, !enabled && styles.rangeOff]}
                  >
                    <Text variant="label" color={r === range ? 'textInverse' : enabled ? 'text' : 'textMuted'}>
                      {RANGE_LABELS[r]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Card>
              {series.length === 1 ? (
                <View style={styles.thin}>
                  <Text variant="label" align="center">One reading so far</Text>
                  <Text variant="caption" color="textMuted" align="center">
                    A second measurement gives you a direction.
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
              <View style={styles.stats}>
                <Stat label="AVERAGE" value={formatValue(metricId, stats.average)} unit={d.unit} />
                <Stat label="LOWEST" value={formatValue(metricId, stats.lowest)} unit={d.unit} />
                <Stat label="HIGHEST" value={formatValue(metricId, stats.highest)} unit={d.unit} />
              </View>
            )}

            {goal !== null && latest !== null && (
              <Card style={styles.goal}>
                <View style={styles.goalHead}>
                  <Text variant="label">{`Goal · ${formatValue(metricId, goal)} ${d.unit}`}</Text>
                  <Text variant="caption" color="textMuted">
                    {`${formatValue(metricId, Math.abs(latest - goal))} ${d.unit} to go`}
                  </Text>
                </View>
                <ProgressBar value={Math.min(latest, goal)} max={goal} />
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
                  status={m.serverSeq === null ? 'pending' : 'synced'}
                  onEdit={d.editable ? () => nav.navigate('LogEntry', { metricId, measurementId: m.id }) : undefined}
                />
              ))}
            </Card>

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
    </SafeAreaView>
  );
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
  rangeOff: { opacity: 0.45 },
  thin: { gap: space.xs, paddingVertical: space.xl },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, gap: space.xs, padding: space.md },
  goal: { gap: space.sm },
  goalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  list: { padding: 0, overflow: 'hidden' },
});
