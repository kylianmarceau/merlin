import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { KeyCap } from './KeyCap';
import { duration, presenceStyle, useLatest, usePresence } from './motion';
import { Panel } from './Panel';
import type { Frame } from './Popover';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, space } from './tokens';

/**
 * What a control's tooltip says, as in Dia: what it does, its shortcut as
 * keys ("⌘", "["), and an optional second line ("Hold to see history").
 */
export type TooltipSpec = { text: string; keys?: string[]; detail?: string };
type Api = { show(spec: TooltipSpec, frame: Frame): void; hide(): void };
const TooltipContext = createContext<Api | null>(null);

/**
 * Holds the window's one tooltip and draws it above everything. A tooltip
 * waits half a second under a still pointer; while one is showing, or just
 * after, the next appears at once as the pointer moves along the controls.
 */
export function TooltipLayer({ bounds, suppress = false, children }: React.PropsWithChildren<{
  bounds: { width: number; height: number };
  /** A tab's hover card is showing: no tooltip opens over or beside it (a row's close button under the pointer). */
  suppress?: boolean;
}>) {
  const [shown, setShown] = useState<(TooltipSpec & { frame: Frame }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmUntil = useRef(0);
  const api = useMemo<Api>(() => ({
    show(spec, frame) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const show = () => { timer.current = null; setShown({ ...spec, frame }); };
      if (Date.now() < warmUntil.current) show();
      else timer.current = setTimeout(show, duration.hoverCard);
    },
    hide() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setShown(current => {
        if (current) warmUntil.current = Date.now() + duration.hoverWarm;
        return null;
      });
    },
  }), []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { if (suppress) api.hide(); }, [suppress, api]);
  return <TooltipContext.Provider value={api}>
    {children}
    <Bubble tip={suppress ? null : shown} bounds={bounds} />
  </TooltipContext.Provider>;
}

function Bubble({ tip, bounds }: { tip: (TooltipSpec & { frame: Frame }) | null; bounds: { width: number; height: number } }) {
  const { reduceMotion } = useTheme();
  const kept = useLatest(tip);
  const presence = usePresence(!!tip, 'fade', reduceMotion);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => { setSize(null); }, [kept?.text, kept?.detail, kept?.keys?.join(' ')]);
  if (!kept || !presence.mounted) return null;
  const { frame } = kept;
  const gap = space.xs + space.hair;
  // Under the control, centred on it; above it when there's no room below.
  const below = frame.y + frame.height + gap;
  const height = size?.height ?? 0;
  const top = below + height > bounds.height - space.sm ? frame.y - gap - height : below;
  const width = size?.width ?? 0;
  const left = Math.max(space.sm, Math.min(bounds.width - width - space.sm, frame.x + frame.width / 2 - width / 2));
  return <Animated.View pointerEvents="none" onLayout={e => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (!size || size.width !== w || size.height !== h) setSize({ width: w, height: h });
  }}
    style={[{ position: 'absolute', top, left, maxWidth: geometry.tooltip, opacity: size ? 1 : 0 }, size ? presenceStyle(presence.progress, 'fade') : null]}>
    <Panel fill="surfacePopoverSolid" radius="sm" elevation="menu" style={{ paddingHorizontal: space.sm, paddingVertical: space.xs + space.hair }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text variant="label" weight="regular">{kept.text}</Text>
        {!!kept.keys?.length && <View style={{ flexDirection: 'row', gap: space.hair }}>
          {kept.keys.map((key, i) => <KeyCap key={`${i}:${key}`}>{key}</KeyCap>)}
        </View>}
      </View>
      {!!kept.detail && <Text variant="caption" tone="textSecondary">{kept.detail}</Text>}
    </Panel>
  </Animated.View>;
}

/**
 * Hover handlers that show `spec` beside the view `ref` points at. Without
 * a TooltipLayer above (a pop-up window) they do nothing. A press puts the
 * tooltip away until the pointer leaves, so it never sits over the popover
 * or menu the press opened.
 */
export function useTooltip(spec: TooltipSpec | null, ref: React.RefObject<View | null>) {
  const api = useContext(TooltipContext);
  const latest = useRef(spec);
  latest.current = spec;
  const pressed = useRef(false);
  return useMemo(() => ({
    enter() {
      if (!api || !latest.current || pressed.current) return;
      ref.current?.measureInWindow((x, y, width, height) => {
        if (latest.current && !pressed.current) api.show(latest.current, { x, y, width, height });
      });
    },
    press() { pressed.current = true; api?.hide(); },
    leave() { pressed.current = false; api?.hide(); },
  }), [api, ref]);
}
