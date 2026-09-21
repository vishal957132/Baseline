import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatValue } from '../../domain/metrics';
import type { MetricId } from '../../domain/types';
import { Chip, color, radius, space, Text } from '../../ui';

interface Props {
  metricId: MetricId;
  value: number;
  /** "your correction", "the scale reading", "from your iPad". */
  title: string;
  /** "Manual · 10:03 · this phone". */
  detail: string;
  selected: boolean;
  /** The one the resolver pre-picked. */
  suggested?: boolean;
  onPress: () => void;
}

/** One candidate on the conflict screen. A radio row, not a button. */
export function ConflictOption({
  metricId, value, title, detail, selected, suggested, onPress,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.row, selected && styles.selected]}
    >
      <View style={[styles.radio, selected && styles.radioOn]} />
      <View style={styles.body}>
        <Text variant="label">
          {`${formatValue(metricId, value)} ${metricId === 'weight' ? 'kg' : ''} — ${title}`}
        </Text>
        <Text variant="caption" color="textMuted">{detail}</Text>
      </View>
      {suggested && <Chip label="Suggested" tone="provider" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.lg, borderRadius: radius.lg,
    backgroundColor: color.card, borderWidth: 1, borderColor: color.border,
  },
  selected: { borderColor: color.ink, borderWidth: 2 },
  radio: {
    width: 22, height: 22, borderRadius: radius.pill,
    borderWidth: 2, borderColor: color.border,
  },
  radioOn: { borderColor: color.ink, borderWidth: 7 },
  body: { flex: 1, gap: 2 },
});
