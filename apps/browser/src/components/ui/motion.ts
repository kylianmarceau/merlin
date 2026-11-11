// Every timing, curve and spring the shell animates with. This is the only
// file allowed to use Easing or a numeric duration (see conventions.test.ts).
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

export const duration = {
  instant: 0,
  fast: 100,
  base: 150,
  slow: 220,
  /** How long a hover must rest before a tooltip-like hint appears. */
  hoverIntent: 350,
  /** How long a notice stays before it leaves on its own. */
  toast: 5000,
  /** Debounce for search fields that ask the browser. */
  search: 180,
  /** Native prompts ignore answers for their first half second. */
  promptArm: 550,
} as const;

export const curve = {
  /** Things arriving: quick start, soft landing. */
  enter: Easing.bezier(0.16, 1, 0.3, 1),
  /** Things leaving: gentle start, quick finish. */
  exit: Easing.bezier(0.4, 0, 1, 1),
  /** Things moving within the layout. */
  move: Easing.bezier(0.25, 0.1, 0.25, 1),
  linear: Easing.linear,
} as const;

export const spring = {
  snappy: { stiffness: 520, damping: 40, mass: 1 },
  gentle: { stiffness: 260, damping: 28, mass: 1 },
} as const;

/** How each overlay moves between hidden (0) and shown (1). */
export const presence = {
  popover: { enter: duration.base, exit: duration.fast, scaleFrom: 0.96, shiftFrom: -4 },
  menu: { enter: duration.fast, exit: duration.fast, scaleFrom: 0.98, shiftFrom: -2 },
  dialog: { enter: duration.slow, exit: duration.base, scaleFrom: 0.97, shiftFrom: 8 },
  sheet: { enter: duration.slow, exit: duration.base, scaleFrom: 0.985, shiftFrom: 12 },
  toast: { enter: duration.slow, exit: duration.base, scaleFrom: 1, shiftFrom: 12 },
  fade: { enter: duration.base, exit: duration.fast, scaleFrom: 1, shiftFrom: 0 },
} as const;
export type PresenceKind = keyof typeof presence;

/** Animates `value` to `to`; immediate when motion is reduced. */
export function animate(value: Animated.Value, to: number, ms: number, easing: (t: number) => number, reduce: boolean) {
  return Animated.timing(value, { toValue: to, duration: reduce ? duration.instant : ms, easing, useNativeDriver: true });
}

/**
 * Keeps something mounted while it animates out. `progress` runs 0 → 1 on
 * open and back on close; `mounted` turns false once the exit has finished.
 */
export function usePresence(open: boolean, kind: PresenceKind, reduce: boolean) {
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    const spec = presence[kind];
    if (open) {
      setMounted(true);
      const run = animate(progress, 1, spec.enter, curve.enter, reduce);
      run.start();
      return () => run.stop();
    }
    const run = animate(progress, 0, spec.exit, curve.exit, reduce);
    run.start(({ finished }) => { if (finished) setMounted(false); });
    return () => run.stop();
  }, [open, kind, reduce, progress]);
  return { mounted, progress };
}

/** Opacity, scale and shift for a presence; pass to an Animated.View style. */
export function presenceStyle(progress: Animated.Value, kind: PresenceKind) {
  const spec = presence[kind];
  return {
    opacity: progress,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [spec.shiftFrom, 0] }) },
      { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [spec.scaleFrom, 1] }) },
    ],
  };
}

/** Holds the last non-null value, so content stays visible while it animates out. */
export function useLatest<T>(value: T | null | undefined): T | null {
  const last = useRef<T | null>(value ?? null);
  if (value !== null && value !== undefined) last.current = value;
  return last.current;
}

/** A 0 → 1 value that eases with hover or selection, for row highlights. */
export function useEased(on: boolean, reduce: boolean) {
  const value = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    const run = Animated.timing(value, { toValue: on ? 1 : 0, duration: reduce ? duration.instant : duration.fast,
      easing: curve.move, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [on, reduce, value]);
  return value;
}

/** Calls `fn` after `ms`, restarting whenever `deps` change. */
export function useTimeout(fn: () => void, ms: number, deps: unknown[]) {
  useEffect(() => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
