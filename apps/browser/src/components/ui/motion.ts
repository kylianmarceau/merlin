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
  /** How long a notice stays before it leaves on its own. */
  toast: 5000,
  /** How long a settings row a search led to glows before it fades. */
  highlight: 1600,
  /** How long a HUD's confirmation ("Link copied") stays; an error stays as long as a notice. */
  hud: 1800,
  /** The joined tab sliding to the newly active tab. */
  slide: 340,
  /** How long a dropped tab keeps its new place while the browser confirms it. */
  dropSettle: 1500,
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
} as const;

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
  /** Something appearing in the middle of the window (a HUD, the command menu, a sheet): from 92%, barely past its size (response 0.3 s, ratio 0.82). */
  appear: responseSpring(0.3, 0.82),
} as const;

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
 * Something appearing in the middle of the window (a HUD, the command menu,
 * the new-tab pop-up, a sheet): it fades in over 0.1 s while its scale
 * springs from 92%, and leaves with a quick fade, shrinking a little.
 * `mounted` turns false once it has gone. Reduced motion only fades.
 */
export function useAppear(open: boolean, reduce: boolean) {
  const opacity = useRef(new Animated.Value(open ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(open || reduce ? 1 : appearFrom)).current;
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    const fade = Animated.timing(opacity, { toValue: open ? 1 : 0, duration: open ? duration.fast : duration.base,
      easing: open ? curve.enter : curve.exit, useNativeDriver: true });
    const size = reduce
      ? Animated.timing(scale, { toValue: 1, duration: duration.instant, useNativeDriver: true })
      : open
        ? Animated.spring(scale, { toValue: 1, ...spring.appear, useNativeDriver: true, restDisplacementThreshold: 0.001, restSpeedThreshold: 0.001 })
        : Animated.timing(scale, { toValue: (1 + appearFrom) / 2, duration: duration.base, easing: curve.exit, useNativeDriver: true });
    fade.start(({ finished }) => { if (finished && !open) setMounted(false); });
    size.start();
    return () => { fade.stop(); size.stop(); };
  }, [open, reduce, opacity, scale]);
  return { mounted: mounted || open, opacity, scale };
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

/** How each overlay moves between hidden (0) and shown (1). */
export const presence = {
  popover: { enter: duration.base, exit: duration.fast, scaleFrom: 0.94, shiftFrom: -4 },
  menu: { enter: duration.fast, exit: duration.fast, scaleFrom: 0.98, shiftFrom: -2 },
  dialog: { enter: duration.slow, exit: duration.base, scaleFrom: 0.97, shiftFrom: 8 },
  sheet: { enter: duration.slow, exit: duration.base, scaleFrom: 0.985, shiftFrom: 12 },
  toast: { enter: duration.slow, exit: duration.base, scaleFrom: 1, shiftFrom: 12 },
  fade: { enter: duration.base, exit: duration.fast, scaleFrom: 1, shiftFrom: 0 },
  dropZone: { enter: duration.dropZone, exit: duration.dropZone, scaleFrom: 1, shiftFrom: 0 },
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
export function presenceStyle(progress: Animated.Value, kind: PresenceKind, origin?: [number, number | string, number], upward = false) {
  const spec = presence[kind];
  const shift = upward ? -spec.shiftFrom : spec.shiftFrom;
  return {
    opacity: progress,
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

/** The peeking tabs sliding in from an edge: 0 hidden, 1 in place, on Dia's sidebar spring. */
export function usePeekSpring(open: boolean, reduce: boolean) {
  const value = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    if (reduce) { value.setValue(open ? 1 : 0); if (!open) setMounted(false); return; }
    const run = open
      ? Animated.spring(value, { toValue: 1, ...spring.sidebar, useNativeDriver: true, restDisplacementThreshold: 0.002, restSpeedThreshold: 0.002 })
      : Animated.timing(value, { toValue: 0, duration: duration.base, easing: curve.exit, useNativeDriver: true });
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
 * Slides to `to` (a left edge and a width) over `duration.slide`. The first
 * position, and every move while `follow` is set (a drag), is immediate.
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
    const spec = { duration: duration.slide, easing: curve.slide, useNativeDriver: false };
    const run = Animated.parallel([Animated.timing(x, { ...spec, toValue: to.x }), Animated.timing(width, { ...spec, toValue: to.width })]);
    run.start();
    return () => run.stop();
  }, [to?.x, to?.width, follow, reduce, x, width]);  // eslint-disable-line react-hooks/exhaustive-deps
  return { x, width };
}

/**
 * Springs to `to` (a rectangle), as a drop zone moves between its sizes and
 * leans towards the pointer. The first position is immediate.
 */
export function useSpringRect(to: { x: number; y: number; width: number; height: number }, reduce: boolean) {
  const values = useRef({ x: new Animated.Value(to.x), y: new Animated.Value(to.y), width: new Animated.Value(to.width),
    height: new Animated.Value(to.height) }).current;
  useEffect(() => {
    const keys = ['x', 'y', 'width', 'height'] as const;
    if (reduce) { keys.forEach(k => values[k].setValue(to[k])); return; }
    const run = Animated.parallel(keys.map(k => Animated.spring(values[k], { toValue: to[k], ...spring.snappy, useNativeDriver: false })));
    run.start();
    return () => run.stop();
  }, [to.x, to.y, to.width, to.height, reduce, values]);  // eslint-disable-line react-hooks/exhaustive-deps
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
