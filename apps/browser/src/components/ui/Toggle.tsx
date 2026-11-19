import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { Pressable } from './Pressable';
import { spring } from './motion';
import { useTheme } from './theme';
import { geometry, opacity, radius, space } from './tokens';

/** An on/off switch; its label is read as part of the control. */
export function Toggle({ label, value, onChange, disabled = false }: {
  label: string; value: boolean; onChange(value: boolean): void; disabled?: boolean;
}) {
  const { colors, reduceMotion } = useTheme();
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { position.setValue(value ? 1 : 0); return; }
    const run = Animated.spring(position, { toValue: value ? 1 : 0, ...spring.snappy, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [value, reduceMotion, position]);
  const travel = geometry.toggleWidth - geometry.toggleThumb - space.hair * 2;
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }}
    disabled={disabled} onPress={() => onChange(!value)}
    style={{ width: geometry.toggleWidth, height: geometry.toggleHeight, borderRadius: radius.pill, padding: space.hair,
      justifyContent: 'center', backgroundColor: colors[value ? 'accent' : 'fillTrack'], opacity: disabled ? opacity.disabled : 1 }}>
    <Animated.View style={{ width: geometry.toggleThumb, height: geometry.toggleThumb, borderRadius: radius.pill,
      backgroundColor: colors.fillThumb,
      transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) }] }} />
  </Pressable>;
}
