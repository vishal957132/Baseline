import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { color, space } from './theme';
import { Text } from './Text';

interface Props {
  title: string;
  subtitle?: string;
  /** Chip, icon, value — whatever belongs on the right. */
  right?: React.ReactNode;
  onPress?: () => void;
  /** Failed uploads get a tinted background (design page 08). */
  danger?: boolean;
}

export function ListRow({ title, subtitle, right, onPress, danger }: Props) {
  const content = (
    <View style={[styles.row, danger && styles.danger]}>
      {/*
        One line each. Without this a narrow screen wraps the subtitle rather
        than truncating it, and rows in a list stop being the same height —
        which FlashList sizes from.
      */}
      <View style={styles.body}>
        <Text variant="label" color={danger ? 'danger' : 'text'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="caption" color={danger ? 'danger' : 'textMuted'} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  danger: { backgroundColor: color.dangerBg },
  body: { flex: 1, gap: 2 },
  pressed: { opacity: 0.6 },
});
