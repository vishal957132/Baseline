import React from 'react';
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';

import { color as palette, font } from './theme';

type Variant = keyof typeof font;

interface Props {
  children: React.ReactNode;
  variant?: Variant;
  color?: keyof typeof palette;
  align?: 'left' | 'center' | 'right';
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}

/** All text goes through here, so sizes and colours come from the theme. */
export function Text({
  children,
  variant = 'body',
  color = 'text',
  align,
  numberOfLines,
  style,
}: Props) {
  return (
    <RNText
      numberOfLines={numberOfLines}
      style={[font[variant], { color: palette[color], textAlign: align }, style]}
    >
      {children}
    </RNText>
  );
}
