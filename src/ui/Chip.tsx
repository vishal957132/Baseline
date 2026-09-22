import React from 'react';
import { StyleSheet, View } from 'react-native';

import { color, radius } from './theme';
import { Text } from './Text';

/** neutral = Manual · provider = Health · warn = Pending · danger = Failed */
type Tone = 'neutral' | 'provider' | 'warn' | 'danger';

const TONES: Record<Tone, { bg: string; fg: keyof typeof color }> = {
  neutral: { bg: color.chipNeutral, fg: 'textMuted' },
  provider: { bg: color.chipProvider, fg: 'success' },
  warn: { bg: color.warnBg, fg: 'warnText' },
  danger: { bg: color.dangerBg, fg: 'danger' },
};

export function Chip({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { bg, fg } = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text variant="caption" color={fg} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    // Never squeezed by a long neighbour: a chip is a status, and half a
    // status word is worse than a truncated value beside it.
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
});
