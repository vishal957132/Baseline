import React, { useEffect, useRef } from 'react';
import { Animated, type DimensionValue } from 'react-native';

import { color, radius } from './theme';

interface Props {
  width?: DimensionValue;
  height?: number;
  round?: number;
}

/**
 * A grey block that pulses. Design page 15: skeletons match the real layout,
 * so nothing jumps when data lands — give these the size of the real thing.
 */
export function Skeleton({ width = '100%', height = 16, round = radius.sm }: Props) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: round,
        backgroundColor: color.track,
        opacity: pulse,
      }}
    />
  );
}
