import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { Point } from '../../domain/chart';
import { metric } from '../../domain/metrics';
import type { MetricId, SourceId } from '../../domain/types';
import { formatIn, type UnitOption } from '../../domain/units';
import { Card, ProgressBar, space, Text } from '../../ui';
import { MetricChart } from './MetricChart';
import { SourceChip } from './SourceChip';

interface Props {
  metricId: MetricId;
  /**
   * The unit to show it in. Passed rather than read from the store so the card
   * stays presentational, and so `React.memo` still has something to compare.
   */
  unit: UnitOption;
  /** Canonical, as stored. Converted here, once, on the way to the screen. */
  value: number | null;
  source: SourceId;
  /** Sparkline data. Water uses a progress bar instead. */
  series?: Point[];
  /** Water and steps show "1.8 of 2.5 L". */
  target?: number | null;
  /** The line under the value — "↓ 0.5 kg this week", or a staleness note. */
  note?: string;
  noteTone?: 'textMuted' | 'success' | 'danger';
  onPress?: () => void;
}

/**
 * A dashboard tile. Loading and empty are the caller's job, not this one's.
 *
 * Memoised: the dashboard holds five independent queries in one component, so
 * any one of them resolving re-renders the lot. Each card only depends on its
 * own props, so four of the five can skip the work.
 */
function MetricCardImpl({
  metricId, unit, value, source, series, target, note, noteTone = 'textMuted', onPress,
}: Props) {
  const d = metric(metricId);

  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.head}>
        <Text variant="label">{d.label}</Text>
        <SourceChip source={source} />
      </View>

      <View style={styles.value}>
        <Text variant="metric">{value === null ? '—' : formatIn(unit, value)}</Text>
        <Text variant="body" color="textMuted">
          {target != null ? `of ${formatIn(unit, target)} ${unit.label}` : unit.label}
        </Text>
      </View>

      {target != null && value !== null ? (
        <ProgressBar value={value} max={target} height={8} />
      ) : series && series.length > 1 ? (
        <MetricChart
          series={series}
          height={38}
          variant={metricId === 'sleep' ? 'bars' : 'line'}
          bare
        />
      ) : null}

      {note && <Text variant="caption" color={noteTone}>{note}</Text>}
    </Card>
  );
}

export const MetricCard = React.memo(MetricCardImpl);

const styles = StyleSheet.create({
  card: { flex: 1, gap: space.sm, padding: space.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  value: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
});
