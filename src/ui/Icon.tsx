import React from 'react';

import { ICONS, type IconName } from './icons';
import { color as palette } from './theme';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
}

/** An SVG icon, tinted. The SVGs use currentColor, so `color` just works. */
export function Icon({ name, size = 22, color = palette.text }: Props) {
  const Svg = ICONS[name];
  return <Svg width={size} height={size} color={color} />;
}
