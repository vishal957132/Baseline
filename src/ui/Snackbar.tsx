import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { color, radius, space } from './theme';
import { Text } from './Text';

interface Props {
  visible: boolean;
  message: string;
  /** "Upload paused for 5s" — why the undo window exists. */
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * The undo bar. The action matters more than the toast: pressing Undo cancels
 * a queued upload before it is sent, rather than sending a correction after.
 */
export function Snackbar({ visible, message, subtitle, actionLabel, onAction }: Props) {
  if (!visible) return null;
  return (
    <View style={styles.bar}>
      <View style={styles.body}>
        <Text variant="label" color="textInverse">{message}</Text>
        {subtitle && <Text variant="caption" color="soft">{subtitle}</Text>}
      </View>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text variant="label" color="soft">{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.snackbar,
    borderRadius: radius.lg,
    padding: space.lg,
    marginHorizontal: space.lg,
  },
  body: { flex: 1, gap: 2 },
});
