// Every timing, curve and spring the shell animates with. This is the only
// file allowed to use Easing or a numeric duration (see conventions.test.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutAnimation } from 'react-native';

export const duration = {
  instant: 0,
  fast: 100,
  base: 150,
  slow: 220,
  /** How long a hover must rest before a tooltip-like hint appears. */
  hoverIntent: 350,
  /** Rows wash in on hover almost at once and fade out more slowly, as in Dia. */
  hoverIn: 50,
  hoverOut: 200,
  /**
   * A tooltip or a tab's hover card waits this long under a still pointer;
   * once one is showing, the next appears at once while the pointer moves
   * on within `hoverWarm`, as in Dia.
   */
  hoverCard: 500,
  hoverWarm: 300,
  /** A press this long on Back or Forward shows the history. */
  holdMenu: 450,
  /** How long a command result or error appears in the status line. */
  statusMessage: 5000,
  /** How long a settings row a search led to glows before it fades. */
  highlight: 1600,
  /** The joined tab sliding to the newly active tab. */
  slide: 340,
  /** How long a dropped tab keeps its new place while the browser confirms it. */
  dropSettle: 1500,
  /** A dragged row resting on another this long groups them when let go, as in Ardia. */
  contact: 450,
  /** A pop-up field takes the focus back if the page took it as the pop-up opened. */
  refocus: 50,
  /** Debounce for search fields that ask the browser. */
  search: 180,
  /**
   * How long the last query's suggestions may wait for the next query's
   * before they grey out. Chromium usually answers well within it, so
   * typing doesn't flash the list on every keystroke.
   */
  staleRows: 250,
  /** Native prompts ignore answers for their first half second. */
  promptArm: 550,
  /** The loading bar: its first quick reach, the slow creep after it, the finish and the fade once loaded. */
  loadStart: 320,
  loadCreep: 9000,
  loadFinish: 200,
  loadFade: 260,
  /** A background tab's icon breathing while its page loads. */
  breathe: 700,
  /** A new download's icon: rising off the page, then flying to the downloads button; the button's nudge as it lands. */
  flyRise: 260,
  flyTravel: 620,
  flyLand: 360,
  /** The downloads button's ring stays full this long after the last file arrives. */
  ringHold: 900,
  /** A dragged tab's drop zones sliding in from the page's edges, and growing once they have. */
  dropZone: 110,
  /** Refused input shaking (three swings dying away), or flashing red with reduced motion. */
  shake: 350,
  /** The address's suggestions unfolding out of the field, as Dia's command bar grows out of it. */
  grow: 130,
  /** The new tab page's area light breathing in and out (each way). */
  areaLight: 3200,
  /** A playing tab's equaliser: each bar's rise (and fall), unequal so they never move together. */
  equaliser: [380, 520, 440],
} as const;

/** How far refused input swings each way at first, in pt. */
export const shakeReach = 6;

/** Past a limit a dragged edge gives less and less, never more than about this far (pt). */
export const rubberReach = 120;
/** How close a dragged sidebar edge comes to its default width before it snaps there, in pt. */
export const snapDistance = 4;

/**
 * A dragged edge past its limits, as a scroll view's rubber band (Apple's
 * 0.55 constant): inside `min`..`max` it follows the pointer; past them it
 * moves less and less the further it is pulled.
 */
export function rubberBand(value: number, min: number, max: number, reach = rubberReach) {
  const pull = (distance: number) => (1 - 1 / ((distance * 0.55) / reach + 1)) * reach;
  if (value < min) return min - pull(min - value);
  if (value > max) return max + pull(value - max);
  return value;
}

/**
 * A swipe back or forward's arrow (SwipeArrow): it comes in with the swipe,
 * up to `reach` and rubber-banded past it; let go where it navigates, it
 * pops and fades; short of that, it springs back out.
 */
export function useSwipeArrow(swipe: { progress: number; ready: boolean; ended: boolean } | null, reach: number, reduce: boolean) {
  const x = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!swipe) return;
    if (!swipe.ended) {
      x.setValue(rubberBand(Math.max(0, swipe.progress) * reach, 0, reach, reach / 2)); scale.setValue(1); shown.setValue(1);
      return;
    }
    const fade = animate(shown, 0, swipe.ready ? duration.base : duration.fast, curve.exit, reduce);
    const run = swipe.ready
      ? Animated.parallel([animate(scale, popFrom, duration.base, curve.exit, reduce), fade])
      : Animated.parallel([reduce ? animate(x, 0, duration.instant, curve.exit, true)
        : Animated.spring(x, { toValue: 0, ...spring.snappy, useNativeDriver: true }), fade]);
    run.start();
    return () => run.stop();
  }, [swipe, reach, reduce, x, scale, shown]);
  return { x, scale, shown };
}

/**
 * Springs a number back from where a drag left it (a rubber-banded edge) to
 * `to`, carrying the drag's speed (pt per ms, as gestures report it), calling
 * `on` each frame and `done` at rest. Immediate with reduced motion.
 */
export function springBack(from: number, to: number, velocity: number, reduce: boolean, on: (value: number) => void, done: () => void) {
  if (reduce || from === to) { on(to); done(); return () => {}; }
  const value = new Animated.Value(from);
  const id = value.addListener(({ value: now }) => on(now));
  const run = Animated.spring(value, { toValue: to, ...spring.sidebar, velocity: velocity * 1000, useNativeDriver: false,
    restDisplacementThreshold: 0.5, restSpeedThreshold: 0.5 });
  run.start(() => { value.removeListener(id); on(to); done(); });
  return () => run.stop();
}

export const curve = {
  /** Things arriving: quick start, soft landing. */
  enter: Easing.bezier(0.16, 1, 0.3, 1),
  /** Things leaving: gentle start, quick finish. */
  exit: Easing.bezier(0.4, 0, 1, 1),
  /** Things moving within the layout. */
  move: Easing.bezier(0.25, 0.1, 0.25, 1),
  /** The joined tab: a fast start that settles softly onto the tab. */
  slide: Easing.bezier(0.2, 0.9, 0.25, 1),
  linear: Easing.linear,
  /** Dia's exponential ease-out: almost all of the way at once, then settling. */
  expoOut: Easing.out(Easing.exp),
} as const;

/** A spring from its response (seconds per swing) and damping ratio, as Core Animation and SwiftUI describe them. */
function responseSpring(response: number, ratio: number) {
  const omega = (2 * Math.PI) / response;
  return { stiffness: omega * omega, damping: 2 * ratio * omega, mass: 1 };
}

export const spring = {
  snappy: { stiffness: 520, damping: 40, mass: 1 },
  gentle: { stiffness: 260, damping: 28, mass: 1 },
  /** The sidebar hiding, showing and peeking: Dia's response 0.215 s, damping 0.79. */
  sidebar: { stiffness: 854, damping: 46, mass: 1 },
  /** A tab's hover card growing in (response 0.25 s, ratio 0.75) and shrinking away (0.2 s, 0.6), from Dia's binary. */
  hoverCardIn: responseSpring(0.25, 0.75),
  hoverCardOut: responseSpring(0.2, 0.6),
  /** A control dipping under a press and coming back: quick, and never past its rest (response 0.2 s, ratio 0.9). */
  press: responseSpring(0.2, 0.9),
  /** A window surface scales up from 92% (response 0.3 s, ratio 0.82). */
  appear: responseSpring(0.3, 0.82),
  /**
   * The joined tab sliding to the newly active tab: about as long as the old
   * 340 ms curve, settling without a bounce; a slide that is redirected
   * midway carries on from its speed rather than starting over.
   */
  slide: responseSpring(0.34, 0.9),
  /** A glyph popping as it takes effect (a page saved, a tab pinned): lively, settling in about 0.4 s. */
  pop: responseSpring(0.32, 0.45),
  /** The new tab page's search card settling as the page opens, as Dia's command bar does (response 0.7 s, from 99%). */
  settle: responseSpring(0.7, 0.85),
} as const;

/** How large a popping glyph starts before it springs back to its size. */
export const popFrom = 1.35;

/** How far a pressed control dips: an icon button's glyph, a pill or field, a round button or tile. */
export const pressScale = { icon: 0.96, control: 0.985, tile: 0.94 } as const;

/**
 * A scale that dips while `pressed` and springs back, on the press spring
 * (no overshoot). Steady at 1 with reduced motion. Pass to a transform.
 */
export function usePressScale(pressed: boolean, depth: number, reduce: boolean) {
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduce) { value.setValue(1); return; }
    const run = Animated.spring(value, { toValue: pressed ? depth : 1, ...spring.press, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [pressed, depth, reduce, value]);
  return value;
}

/** Dia's hover card: it fades over 0.1 s on this curve while its scale springs between 0.92 and 1. */
const hoverCardMotion = { fade: 100, scaleFrom: 0.92, curve: Easing.bezier(0.25, 0.46, 0.45, 0.94) } as const;

/**
 * A tab's hover card appearing and leaving as in Dia: opacity over 0.1 s,
 * scale springing from 0.92 (grow it from the corner nearest the tab with
 * transformOrigin). `mounted` turns false once it has gone. Reduced motion
 * only fades.
 */
export function useHoverCardMotion(open: boolean, reduce: boolean) {
  const opacity = useRef(new Animated.Value(open ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(open || reduce ? 1 : hoverCardMotion.scaleFrom)).current;
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    const fade = Animated.timing(opacity, { toValue: open ? 1 : 0, duration: hoverCardMotion.fade, easing: hoverCardMotion.curve,
      useNativeDriver: true });
    const size = reduce
      ? Animated.timing(scale, { toValue: 1, duration: duration.instant, useNativeDriver: true })
      : Animated.spring(scale, { toValue: open ? 1 : hoverCardMotion.scaleFrom, ...(open ? spring.hoverCardIn : spring.hoverCardOut),
        useNativeDriver: true, restDisplacementThreshold: 0.001, restSpeedThreshold: 0.001 });
    // It leaves once it has faded; the spring needn't finish under a card no one sees.
    fade.start(({ finished }) => { if (finished && !open) setMounted(false); });
    size.start();
    return () => { fade.stop(); size.stop(); };
  }, [open, reduce, opacity, scale]);
  return { mounted: mounted || open, opacity, scale };
}

/** Things appearing mid-window grow from this, never from nothing. */
export const appearFrom = 0.92;

/**
 * Something mid-screen arriving (a centred pop-up): it fades in over 100 ms
 * while its scale springs from 92%, never from nothing. For things mounted
 * only while shown; reduced motion only fades.
 */
export function useEntrance(reduce: boolean) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(reduce ? 1 : appearFrom)).current;
  useEffect(() => {
    const fade = Animated.timing(opacity, { toValue: 1, duration: duration.fast, easing: curve.enter, useNativeDriver: true });
    const size = Animated.spring(scale, { toValue: 1, ...spring.appear, useNativeDriver: true, restDisplacementThreshold: 0.001,
      restSpeedThreshold: 0.001 });
    fade.start();
    if (!reduce) size.start();
    return () => { fade.stop(); size.stop(); };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  return { opacity, scale };
}

/**
 * A scale that pops when `on` turns true (a bookmark saved, a tab pinned):
 * it jumps to 135% and springs back to its size, a little past it. Steady
 * at 1 with reduced motion, when it is already on as it first shows, and
 * when `subject` changes (another tab, already saved, isn't news).
 */
export function usePop(on: boolean, reduce: boolean, subject?: string) {
  const scale = useRef(new Animated.Value(1)).current;
  const was = useRef({ on, subject });
  useEffect(() => {
    const turnedOn = on && !was.current.on && subject === was.current.subject;
    was.current = { on, subject };
    if (!turnedOn || reduce) return;
    scale.setValue(popFrom);
    const run = Animated.spring(scale, { toValue: 1, ...spring.pop, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [on, reduce, subject, scale]);
  return scale;
}

/**
 * A scale for something that has just arrived because of what the user did
 * (a tab pinned into the favourites): from 92% to its size on the lively
 * `pop` spring, once, as it mounts. Steady at 1 when `fresh` is false (it
 * was there already) or with reduced motion.
 */
export function useArrival(fresh: boolean, reduce: boolean) {
  const scale = useRef(new Animated.Value(fresh && !reduce ? appearFrom : 1)).current;
  useEffect(() => {
    if (!fresh || reduce) return;
    const run = Animated.spring(scale, { toValue: 1, ...spring.pop, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  return scale;
}

/**
 * Bar heights (0–1) for a playing tab's equaliser: three bars rising and
 * falling out of step while `on`. They rest at differing heights when off
 * or with reduced motion.
 */
export function useEqualiser(on: boolean, reduce: boolean) {
  const bars = useRef(duration.equaliser.map((_, i) => new Animated.Value(equaliserRest[i]))).current;
  useEffect(() => {
    if (!on || reduce) { bars.forEach((bar, i) => bar.setValue(equaliserRest[i])); return; }
    const runs = bars.map((bar, i) => Animated.loop(Animated.sequence([
      Animated.timing(bar, { toValue: 1, duration: duration.equaliser[i], easing: curve.move, useNativeDriver: true }),
      Animated.timing(bar, { toValue: equaliserLow, duration: duration.equaliser[i], easing: curve.move, useNativeDriver: true }),
    ])));
    runs.forEach(run => run.start());
    return () => runs.forEach(run => run.stop());
  }, [on, reduce, bars]);
  return bars;
}
/** The equaliser's bars at rest, and how low a moving bar falls. */
const equaliserRest = [0.55, 0.9, 0.7];
const equaliserLow = 0.3;

/**
 * A height that unfolds from 0 to `target` over 130 ms on Dia's exponential
 * ease-out the first time there is something to show, then follows
 * `target` at once (rows changing as the user types). Immediate with
 * reduced motion.
 */
export function useUnfold(target: number, reduce: boolean) {
  const height = useRef(new Animated.Value(0)).current;
  const opened = useRef(false);
  useEffect(() => {
    if (!target) { opened.current = false; height.setValue(0); return; }
    if (opened.current || reduce) { opened.current = true; height.setValue(target); return; }
    opened.current = true;
    const run = Animated.timing(height, { toValue: target, duration: duration.grow, easing: curve.expoOut, useNativeDriver: false });
    run.start();
    return () => run.stop();
  }, [target, reduce, height]);
  return height;
}

/**
 * Input that was refused (no matches, an unknown command, a name already
 * taken) shakes as a refused macOS password does: three swings of ±6 pt
 * dying away over 0.35 s. With reduced motion it flashes red instead
 * (`flash`, 0 → 1 → 0). Runs each time `count` changes after the first.
 */
export function useShake(count: number, reduce: boolean) {
  const x = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const first = useRef(count);
  useEffect(() => {
    if (count === first.current) return;
    first.current = count;
    if (reduce) {
      const run = Animated.sequence([
        Animated.timing(flash, { toValue: 1, duration: duration.fast, easing: curve.enter, useNativeDriver: true }),
        Animated.timing(flash, { toValue: 0, duration: duration.shake - duration.fast, easing: curve.exit, useNativeDriver: true }),
      ]);
      run.start();
      return () => run.stop();
    }
    const swings = [1, -1, 2 / 3, -2 / 3, 1 / 3, -1 / 3, 0];
    const run = Animated.sequence(swings.map(share => Animated.timing(x, { toValue: share * shakeReach,
      duration: duration.shake / swings.length, easing: curve.move, useNativeDriver: true })));
    run.start();
    return () => { run.stop(); x.setValue(0); };
  }, [count, reduce, x, flash]);
  return { x, flash };
}

/**
 * The next layout change animates as a list's rows do in Dia: a new row
 * fades in while the rows below slide down over 0.14 s; a closed row fades
 * out in 0.1 s while the rest close up. Call it just before the change.
 */
export function animateListChange(reduce: boolean) {
  if (reduce) return;
  LayoutAnimation.configureNext({
    duration: 140,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity, duration: 100 },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity, duration: 100 },
  });
}

/**
 * How each overlay moves between hidden (0) and shown (1). Things in the
 * middle of the window (dialogs, sheets, notices) arrive from 92% on the
 * `appear` spring (`springIn`); popovers grow out of their arrow from 94%.
 */
export const presence = {
  popover: { enter: duration.base, exit: duration.fast, scaleFrom: 0.94, shiftFrom: -4, springIn: false },
  menu: { enter: duration.fast, exit: duration.fast, scaleFrom: 0.98, shiftFrom: -2, springIn: false },
  dialog: { enter: duration.slow, exit: duration.base, scaleFrom: appearFrom, shiftFrom: 4, springIn: true },
  sheet: { enter: duration.slow, exit: duration.base, scaleFrom: appearFrom, shiftFrom: 6, springIn: true },
  mediaPlayer: { enter: duration.slow, exit: duration.base, scaleFrom: appearFrom, shiftFrom: 8, springIn: true },
  fade: { enter: duration.base, exit: duration.fast, scaleFrom: 1, shiftFrom: 0, springIn: false },
  dropZone: { enter: duration.dropZone, exit: duration.dropZone, scaleFrom: 1, shiftFrom: 0, springIn: false },
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
      const run = spec.springIn && !reduce
        ? Animated.spring(progress, { toValue: 1, ...spring.appear, useNativeDriver: true, restDisplacementThreshold: 0.001,
          restSpeedThreshold: 0.001 })
        : animate(progress, 1, spec.enter, curve.enter, reduce);
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
export function presenceStyle(progress: Animated.Value, kind: PresenceKind, origin?: [number, number | string, number], upward = false) {
  const spec = presence[kind];
  const shift = upward ? -spec.shiftFrom : spec.shiftFrom;
  return {
    // A spring passes 1 a little on its way in; the scale may, the opacity can't.
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    // Grows out of its arrow, so it reads as coming from the control.
    ...(origin ? { transformOrigin: origin } : null),
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [shift, 0] }) },
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

/**
 * A hover wash as an opacity: in over `duration.hoverIn`, out over
 * `duration.hoverOut`, so a pointer sweeping down a list leaves a short trail.
 */
export function useHoverFade(on: boolean, reduce: boolean) {
  const value = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    const run = Animated.timing(value, { toValue: on ? 1 : 0, duration: reduce ? duration.instant : on ? duration.hoverIn : duration.hoverOut,
      easing: on ? curve.enter : curve.exit, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [on, reduce, value]);
  return value;
}


/**
 * The sidebar's width, springing between 0 and `width` as the tabs hide and
 * show (Dia's spring). `shown` turns false once it has closed, so the
 * sidebar can unmount.
 */
export function useSidebarSpring(open: boolean, width: number, reduce: boolean) {
  const value = useRef(new Animated.Value(open ? width : 0)).current;
  const [shown, setShown] = useState(open);
  const last = useRef(open);
  useEffect(() => {
    if (open === last.current) { value.setValue(open ? width : 0); return; }
    last.current = open;
    if (open) setShown(true);
    if (reduce) { value.setValue(open ? width : 0); if (!open) setShown(false); return; }
    const run = Animated.spring(value, { toValue: open ? width : 0, ...spring.sidebar, useNativeDriver: false,
      restDisplacementThreshold: 0.5, restSpeedThreshold: 0.5 });
    run.start(({ finished }) => { if (finished && !open) setShown(false); });
    return () => run.stop();
  }, [open, width, reduce, value]);
  return { width: value, shown: shown || open };
}

/** The peeking tabs sliding in from an edge and back out: 0 hidden, 1 in place, on Dia's sidebar spring both ways. */
export function usePeekSpring(open: boolean, reduce: boolean) {
  const value = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    if (reduce) { value.setValue(open ? 1 : 0); if (!open) setMounted(false); return; }
    // In and out on the same spring, so leaving keeps the feel of arriving.
    const run = Animated.spring(value, { toValue: open ? 1 : 0, ...spring.sidebar, useNativeDriver: true,
      restDisplacementThreshold: 0.002, restSpeedThreshold: 0.002, overshootClamping: !open });
    run.start(({ finished }) => { if (finished && !open) setMounted(false); });
    return () => run.stop();
  }, [open, reduce, value]);
  return { progress: value, mounted: mounted || open };
}

/** Calls `fn` after `ms`, restarting whenever `deps` change. */
export function useTimeout(fn: () => void, ms: number, deps: unknown[]) {
  useEffect(() => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** True once `flag` has stayed true for `ms`; false as soon as it turns false. */
export function useHeld(flag: boolean, ms: number) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!flag) { setHeld(false); return; }
    const timer = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(timer);
  }, [flag, ms]);
  return flag && held;
}

/**
 * The toolbar, joined tab and shell colour as an Animated value. It changes
 * at once: a cross-fade ran every time a page loaded and read as the page
 * itself fading in.
 */
export function useColorFade(color: string, _reduce: boolean) {
  const value = useRef(new Animated.Value(0)).current;
  return useMemo(() => value.interpolate({ inputRange: [0, 1], outputRange: [color, color] }), [color, value]);
}

/**
 * Slides to `to` (a left edge and a width) on the `slide` spring. A new
 * target while it moves takes over its speed instead of stopping it (React
 * Native's spring carries a running spring's velocity), so quick switches
 * flow into each other. The first position, and every move while `follow`
 * is set (a drag), is immediate.
 */
export function useSlide(to: { x: number; width: number } | null, reduce: boolean, follow = false) {
  const x = useRef(new Animated.Value(to?.x ?? 0)).current;
  const width = useRef(new Animated.Value(to?.width ?? 0)).current;
  const placed = useRef(!!to);
  useEffect(() => {
    if (!to) return;
    if (!placed.current || follow || reduce) {
      placed.current = true;
      x.setValue(to.x);
      width.setValue(to.width);
      return;
    }
    const spec = { ...spring.slide, useNativeDriver: false, restDisplacementThreshold: 0.2, restSpeedThreshold: 0.2 };
    // Not stopped on the next change: the next spring takes over this one's velocity.
    Animated.spring(x, { ...spec, toValue: to.x }).start();
    Animated.spring(width, { ...spec, toValue: to.width }).start();
  }, [to?.x, to?.width, follow, reduce, x, width]);  // eslint-disable-line react-hooks/exhaustive-deps
  return { x, width };
}

/**
 * Springs to `to` (a rectangle), as a drop zone moves between its sizes and
 * leans towards the pointer, or a favourite tile makes room and settles into
 * its slot. The first position is immediate, and so is every one while
 * `follow` (a tile under the pointer).
 */
export function useSpringRect(to: { x: number; y: number; width: number; height: number }, reduce: boolean, follow = false) {
  const values = useRef({ x: new Animated.Value(to.x), y: new Animated.Value(to.y), width: new Animated.Value(to.width),
    height: new Animated.Value(to.height) }).current;
  useEffect(() => {
    const keys = ['x', 'y', 'width', 'height'] as const;
    if (reduce || follow) { keys.forEach(k => values[k].setValue(to[k])); return; }
    const run = Animated.parallel(keys.map(k => Animated.spring(values[k], { toValue: to[k], ...spring.snappy, useNativeDriver: false })));
    run.start();
    return () => run.stop();
  }, [to.x, to.y, to.width, to.height, reduce, follow, values]);  // eslint-disable-line react-hooks/exhaustive-deps
  return values;
}

/** How far the loading bar gets before the page finishes: quickly to a quarter, then creeping, never to the end. */
const loadReach = { start: 0.28, creep: 0.9 } as const;

/**
 * A page-loading bar's fill (0 → 1) and opacity. While `loading` it runs
 * quickly to a quarter, then creeps towards the end without reaching it, as
 * Arc's and Safari's do; when the page finishes it completes and fades.
 */
export function useLoadingBar(loading: boolean, reduce: boolean) {
  const fill = useRef(new Animated.Value(loading ? 0.1 : 0)).current;
  const opacity = useRef(new Animated.Value(loading ? 1 : 0)).current;
  const was = useRef(loading);
  useEffect(() => {
    const started = loading && !was.current;
    const finished = !loading && was.current;
    was.current = loading;
    if (loading) {
      if (started) fill.setValue(0);
      opacity.setValue(1);
      const run = Animated.sequence([
        Animated.timing(fill, { toValue: loadReach.start, duration: reduce ? duration.instant : duration.loadStart, easing: curve.enter, useNativeDriver: false }),
        Animated.timing(fill, { toValue: loadReach.creep, duration: duration.loadCreep, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      ]);
      run.start();
      return () => run.stop();
    }
    if (!finished) return;
    const run = Animated.sequence([
      Animated.timing(fill, { toValue: 1, duration: reduce ? duration.instant : duration.loadFinish, easing: curve.move, useNativeDriver: false }),
      Animated.timing(opacity, { toValue: 0, duration: reduce ? duration.instant : duration.loadFade, easing: curve.exit, useNativeDriver: false }),
    ]);
    run.start(({ finished: done }) => { if (done) fill.setValue(0); });
    return () => run.stop();
  }, [loading, reduce, fill, opacity]);
  return { fill, opacity };
}

/** An opacity that breathes gently while `on`, for something quietly busy; steady at 1 otherwise. */
export function useBreathe(on: boolean, reduce: boolean) {
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on || reduce) { value.setValue(1); return; }
    const half = { duration: duration.breathe, easing: Easing.inOut(Easing.sin), useNativeDriver: true };
    const run = Animated.loop(Animated.sequence([
      Animated.timing(value, { ...half, toValue: 0.4 }),
      Animated.timing(value, { ...half, toValue: 1 }),
    ]));
    run.start();
    return () => { run.stop(); value.setValue(1); };
  }, [on, reduce, value]);
  return value;
}

/**
 * The new tab page's area light: it brightens and dims slowly while the page
 * shows (0.55 ↔ 1), as Dia's breathing light does. Steady with reduced motion.
 */
export function useAreaLight(reduce: boolean) {
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduce) { value.setValue(1); return; }
    const half = { duration: duration.areaLight, easing: Easing.inOut(Easing.sin), useNativeDriver: true };
    const run = Animated.loop(Animated.sequence([
      Animated.timing(value, { ...half, toValue: areaLightLow }),
      Animated.timing(value, { ...half, toValue: 1 }),
    ]));
    run.start();
    return () => run.stop();
  }, [reduce, value]);
  return value;
}
const areaLightLow = 0.55;

/** The new tab page's search card as the page opens: from 99% on a slow, soft spring, fading in. Still with reduced motion. */
export function useSettle(reduce: boolean) {
  const scale = useRef(new Animated.Value(reduce ? 1 : settleFrom)).current;
  const opacity = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    const fade = Animated.timing(opacity, { toValue: 1, duration: duration.base, easing: curve.enter, useNativeDriver: true });
    const size = Animated.spring(scale, { toValue: 1, ...spring.settle, useNativeDriver: true });
    fade.start(); size.start();
    return () => { fade.stop(); size.stop(); };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  return { scale, opacity };
}
const settleFrom = 0.99;

/** A new download's flight: how high it lifts off the page, and how large it is as it lifts and as it lands. */
const flight = { lift: 28, startScale: 0.5, landScale: 0.32 } as const;
export type FlightValues = { x: Animated.Value; y: Animated.Value; scale: Animated.Value; opacity: Animated.Value };
type Point = { x: number; y: number };

/** Values for one flight, placed at `from` and hidden. */
export function useFlightValues(from: Point): FlightValues {
  return useRef({
    x: new Animated.Value(from.x), y: new Animated.Value(from.y),
    scale: new Animated.Value(flight.startScale), opacity: new Animated.Value(0),
  }).current;
}

/**
 * A downloaded file's icon leaving the page for the downloads button, as in
 * Safari: it lifts off where it starts, then arcs to the button (across
 * first, then up), shrinking as it goes, and vanishes into it. `from` and
 * `to` are the icon's centre. With reduced motion it only fades in place.
 */
export function flyTo(v: FlightValues, from: Point, to: Point, reduce: boolean) {
  v.x.setValue(from.x); v.y.setValue(from.y); v.scale.setValue(flight.startScale); v.opacity.setValue(0);
  const native = { useNativeDriver: true };
  if (reduce) {
    return Animated.sequence([
      Animated.timing(v.opacity, { ...native, toValue: 1, duration: duration.base, easing: curve.enter }),
      Animated.timing(v.opacity, { ...native, toValue: 0, duration: duration.slow, easing: curve.exit }),
    ]);
  }
  const travel = { ...native, duration: duration.flyTravel };
  return Animated.sequence([
    Animated.parallel([
      Animated.timing(v.opacity, { ...native, toValue: 1, duration: duration.flyRise, easing: curve.enter }),
      Animated.timing(v.scale, { ...native, toValue: 1, duration: duration.flyRise, easing: Easing.out(Easing.back(2)) }),
      Animated.timing(v.y, { ...native, toValue: from.y - flight.lift, duration: duration.flyRise, easing: curve.enter }),
    ]),
    Animated.parallel([
      Animated.timing(v.x, { ...travel, toValue: to.x, easing: Easing.out(Easing.cubic) }),
      Animated.timing(v.y, { ...travel, toValue: to.y, easing: Easing.in(Easing.cubic) }),
      Animated.timing(v.scale, { ...travel, toValue: flight.landScale, easing: Easing.in(Easing.quad) }),
      Animated.sequence([
        Animated.delay(duration.flyTravel - duration.fast),
        Animated.timing(v.opacity, { ...native, toValue: 0, duration: duration.fast, easing: curve.exit }),
      ]),
    ]),
  ]);
}

/** A control's scale, nudged up and back each time `count` grows: a file landing in the downloads button. */
export function useNudge(count: number, reduce: boolean) {
  const value = useRef(new Animated.Value(1)).current;
  const last = useRef(count);
  useEffect(() => {
    if (count <= last.current) { last.current = count; return; }
    last.current = count;
    if (reduce) return;
    const half = duration.flyLand / 2;
    const run = Animated.sequence([
      Animated.timing(value, { toValue: 1.22, duration: half, easing: curve.enter, useNativeDriver: true }),
      Animated.spring(value, { toValue: 1, ...spring.gentle, useNativeDriver: true }),
    ]);
    run.start();
    return () => { run.stop(); value.setValue(1); };
  }, [count, reduce, value]);
  return value;
}
