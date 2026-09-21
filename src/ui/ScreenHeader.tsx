import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chip } from './Chip';
import { Icon } from './Icon';
import { color, radius, space } from './theme';
import { Text } from './Text';

interface Props {
  title: string;
  /** Small caps line above the title — "MONDAY" on the dashboard. */
  eyebrow?: string;
  /** Shown next to the eyebrow, e.g. "DEMO DATA". */
  badge?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}

export function ScreenHeader({ title, eyebrow, badge, onBack, right }: Props) {
  return (
    <View style={styles.wrap}>
      {(eyebrow || badge) && (
        <View style={styles.eyebrowRow}>
          {eyebrow && <Text variant="caption" color="textMuted">{eyebrow.toUpperCase()}</Text>}
          {badge && <Chip label={badge} tone="warn" />}
        </View>
      )}
      <View style={styles.titleRow}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={8} style={styles.back}>
            <Icon name="chevron-left" size={22} />
          </Pressable>
        )}
        <Text variant="display" style={styles.title}>{title}</Text>
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { flex: 1 },
  back: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.card,
    borderRadius: radius.md,
  },
});
