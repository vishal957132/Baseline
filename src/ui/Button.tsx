import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from './Icon';
import type { IconName } from './icons';
import { color, radius, space } from './theme';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'danger';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconName;
  disabled?: boolean;
}

const FILL: Record<Variant, string> = {
  primary: color.ink,
  secondary: color.card,
  danger: color.danger,
};

export function Button({ label, onPress, variant = 'primary', icon, disabled }: Props) {
  // Secondary is the only light-background variant, so it keeps dark text.
  const fg = variant === 'secondary' ? 'ink' : 'textInverse';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: FILL[variant] },
        variant === 'secondary' && styles.outlined,
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      {icon && <Icon name={icon} size={18} color={color[fg]} />}
      <Text variant="label" color={fg}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
  },
  outlined: { borderWidth: 1, borderColor: color.border },
  dimmed: { opacity: 0.55 },
});
