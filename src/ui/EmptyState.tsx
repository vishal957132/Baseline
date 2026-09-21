import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from './Button';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { space } from './theme';
import { Text } from './Text';

interface Props {
  icon: IconName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  /** The text link under the button — "Import from Apple Health". */
  linkLabel?: string;
  onLink?: () => void;
}

/** Design page 15: an empty metric offers both paths, never a dead end. */
export function EmptyState({
  icon, title, body, actionLabel, onAction, linkLabel, onLink,
}: Props) {
  return (
    <View style={styles.wrap}>
      <Icon name={icon} size={36} color="#B9B6AD" />
      <Text variant="title" align="center">{title}</Text>
      <Text variant="body" color="textMuted" align="center">{body}</Text>
      {actionLabel && onAction && (
        <Button label={actionLabel} onPress={onAction} />
      )}
      {linkLabel && onLink && (
        <Pressable onPress={onLink} hitSlop={8}>
          <Text variant="label" color="ink">{linkLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
  },
});
