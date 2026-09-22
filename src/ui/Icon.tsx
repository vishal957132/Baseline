import React from 'react';

import { ICONS, type IconName } from './icons';
import { color as palette } from './theme';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
}

/**
 * An SVG icon, tinted. The SVGs use currentColor, so `color` just works.
 *
 * Memoised because icons render inside recycled list cells, where the parent
 * re-renders far more often than the icon's three props change.
 */
function IconImpl({ name, size = 22, color = palette.text }: Props) {
  const Svg = ICONS[name];
  return <Svg width={size} height={size} color={color} />;
}

export const Icon = React.memo(IconImpl);
