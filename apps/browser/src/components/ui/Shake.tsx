import React from 'react';
import { Animated, type ViewStyle } from 'react-native';
import { useShake } from './motion';
import { useTheme } from './theme';
import { flashOpacity } from './tokens';

/**
 * Wraps input that can be refused: each time `count` changes it shakes, or
 * with reduced motion flashes red behind its content (`radius` rounds the
 * flash to the shape it sits in).
 */
export function Shake({ count, radius = 0, style, children }: React.PropsWithChildren<{ count: number; radius?: number; style?: ViewStyle }>) {
  const { colors, reduceMotion } = useTheme();
  const { x, flash } = useShake(count, reduceMotion);
  return <Animated.View style={[style, { transform: [{ translateX: x }] }]}>
    {children}
    {/* Over the content, faint enough to read through. */}
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius,
      backgroundColor: colors.danger, opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, flashOpacity] }) }} />
  </Animated.View>;
}

/**
 * Counts refusals for `Shake`: grows each time `reason` turns to a new
 * non-empty value (an error message, "no matches"), and again on `again()`
 * (the same refused input submitted once more).
 */
export function useRefusal(reason: string | null | undefined) {
  const [count, setCount] = React.useState(0);
  const last = React.useRef(reason || '');
  React.useEffect(() => {
    const now = reason || '';
    if (now && now !== last.current) setCount(c => c + 1);
    last.current = now;
  }, [reason]);
  return { count, again: () => setCount(c => c + 1) };
}
