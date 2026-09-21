import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { color } from './theme';
import { Text } from './Text';

interface Props {
  value: number;
  max: number;
  size?: number;
  thickness?: number;
}

/** The dashboard's 74% donut. A stroked circle, dashed to show progress. */
export function ProgressRing({ value, max, size = 76, thickness = 9 }: Props) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} style={styles.svg}>
        {/* Rotated so the arc starts at 12 o'clock instead of 3. */}
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color.track} strokeWidth={thickness} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color.ink}
          strokeWidth={thickness}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text variant="label">{`${Math.round(pct * 100)}%`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  svg: { position: 'absolute' },
});
