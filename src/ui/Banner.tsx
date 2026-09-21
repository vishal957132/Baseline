import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import type { IconName } from './icons';
import { color, radius, space } from './theme';
import { Text } from './Text';

type Tone = 'warn' | 'danger';

interface Props {
  tone: Tone;
  icon: IconName;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const TONES: Record<Tone, { bg: string; border: string; fg: keyof typeof color }> = {
  warn: { bg: color.warnBg, border: '#EFD9A8', fg: 'warnText' },
  danger: { bg: color.dangerBg, border: '#F0D5CE', fg: 'danger' },
};

/** Offline notice, sync status, provider failure. One optional action. */
export function Banner({ tone, icon, title, subtitle, actionLabel, onAction }: Props) {
  const { bg, border, fg } = TONES[tone];
  return (
    <View style={[styles.row, { backgroundColor: bg, borderColor: border }]}>
      <Icon name={icon} size={20} color={color[fg]} />
      <View style={styles.body}>
        <Text variant="label" color={fg}>{title}</Text>
        {subtitle && <Text variant="caption" color={fg}>{subtitle}</Text>}
      </View>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text variant="label" color={fg}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  body: { flex: 1, gap: 2 },
});
