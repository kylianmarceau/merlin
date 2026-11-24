// Gradient geometry adapted from Ardia's fieldLoadDrive.ts and toolbar tokens.
// Copyright 2026 Mantra Patel. Licensed under Apache-2.0 (see NOTICE).
import React, { useMemo, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Gradient } from '../../platform/shell';
import { useLoadingBar } from './motion';
import { useTheme } from './theme';
import { addressLoadingTint, radius } from './tokens';

const line = 1.5;
const glow = [
  [0, 0.08], [0.07, 0.13], [0.45, 0.17], [0.65, 0.2],
  [0.78, 0.28], [0.87, 0.4], [0.94, 0.6], [1, 0.7],
] as const;
const tailFalloff = [1, 0.55, 0.38, 0.33, 0.3, 0];
const capFalloff = [1, 0.78, 0.59, 0.43, 0.3, 0.19, 0.11, 0.05, 0.01, 0];
const tailCeiling = 0.2;
type Stop = readonly [number, number];

function glowPlates(width: number, height: number) {
  const tail = Math.min(120, width * 0.4);
  const cap = tail * (72 / 120);
  const lineTop = 1 - Math.min(1, line / height);
  const withLine = (stops: readonly Stop[]): Stop[] => [
    ...stops.map(([at, alpha]) => [at * lineTop, alpha] as const), [lineTop, 1], [1, 1],
  ];
  const tailGlow = glow.map(([at, alpha]) => [at, Math.min(alpha, tailCeiling)] as const);
  const capGlow = glow.map(([at, alpha]) => [at, Math.max(0, alpha - tailCeiling)] as const);
  const plate = (extra: number, fill: readonly Stop[], falloff: number[], leading = 1) => ({
    width: width + extra,
    colors: fill.map(([, alpha]) => addressLoadingTint(alpha)),
    profile: {
      stops: fill.map(([at]) => at),
      fade: [leading, ...falloff],
      fadeStops: [0, ...falloff.map((_, i) => (width + extra * i / (falloff.length - 1)) / (width + extra))],
    },
  });
  return {
    tail: plate(tail, tailGlow, tailFalloff),
    cap: plate(cap, withLine(capGlow), capFalloff),
    comet: plate(cap, withLine(glow), capFalloff, 0),
    reach: Math.min(0.9, 1 - tail / width),
  };
}

/** A wash in the address field with a bright underline and a tapered front. */
export function LoadingBar({ loading }: { loading: boolean }) {
  const { reduceMotion } = useTheme();
  const { fill, opacity, comet } = useLoadingBar(loading, reduceMotion);
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const layers = useMemo(() => {
    if (width <= 0 || height <= 0) return null;
    const plates = glowPlates(width, height);
    const translateX = fill.interpolate({
      inputRange: [0, 1, 2],
      outputRange: [-width, -width * (1 - plates.reach), 0],
    });
    const draw = ({ width: plateWidth, colors, profile }: typeof plates.tail) =>
      <Gradient gradientKind="vertical" gradientColors={colors} gradientProfile={profile}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: plateWidth }} />;
    return <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0,
      width: plates.tail.width, opacity, transform: [{ translateX }] }}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: comet.interpolate({
        inputRange: [0, 1], outputRange: [1, 0],
      }) }]}>
        {draw(plates.tail)}
        {draw(plates.cap)}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: comet }]}>
        {draw(plates.comet)}
      </Animated.View>
    </Animated.View>;
  }, [width, height, fill, opacity, comet]);
  return <View pointerEvents="none" accessible={false}
    onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}
    style={[StyleSheet.absoluteFill, { borderRadius: radius.field, overflow: 'hidden' }]}>
    {layers}
  </View>;
}
