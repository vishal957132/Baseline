import React from 'react';
import { StyleSheet, View } from 'react-native';

import { color, radius } from './theme';

interface Props {
  value: number;
  max: number;
  height?: number;
  fill?: string;
}

/** The water card's fill and the goal card's bar. */
export function ProgressBar({ value, max, height = 10, fill = color.ink }: Props) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <View style={[styles.track, { height }]}>
      <View
        style={{
          width: `${pct * 100}%`,
          height,
          backgroundColor: fill,
          borderRadius: radius.pill,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: color.track,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
});
