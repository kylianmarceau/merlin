import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { displayAddress, isStartUrl, leftToRight, pageTitle } from '../../lib/format';
import type { Tab } from '../../state/types';
import { awayFromHome } from '../../state/pinned';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActions, useBrowser } from '../../state/window';
import {
  ContextMenu, Equaliser, Fade, GlassFill, IconButton, Panel, Pressable, Text, geometry, opacity, pinnedTileRing, spring, pinnedTileTint, radius, space, useEased, useHoverFade,
  useInteraction, useTheme, type ShadowName,
} from '../ui';
import { Favicon } from '../favicon/Favicon';

const glowElevation: Record<'full' | 'soft' | 'off', ShadowName> = { full: 'tabGlow', soft: 'tab', off: 'none' };

const cover = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

/** One row's height in the list, for turning a drag into a number of places. */
export const rowStep = geometry.tabRow + geometry.tabRowGap;

/** The name the user gave a tab, else its title, else its address as Chromium formats it, never the raw URL (which can carry a user name). */
export function tabTitle(tab: Tab, fallback = 'New Tab') {
  return tab.name || (isStartUrl(tab.url) ? 'New Tab' : pageTitle(tab.title)) || leftToRight(tab.displayUrl ?? displayAddress(tab.url)) || fallback;
}

/**
 * A tab in the sidebar list. The active tab is lifted off the shell as a white
 * card; the others wash white on hover, in at once and out slowly, as in Dia.
 * Resting on a row brings up its hover card. Right-click opens its native
 * menu. Drag it up or down to reorder, as in Ardia: it lifts into a card
 * that follows the pointer while the rows it passes slide aside (`shift`,
 * from the sidebar, which hears each new place through `onSteps`), and
 * springs into its place when let go (`onReorder` gets the number of
 * places). Drag it up over the favourites to pin it, to the right onto the
 * page to split it beside the current tab, or out of the window to give it
 * a window of its own.
 */
export const TabRow = React.memo(function TabRow({ tab, active, onReorder, onSteps, onActive, shift = 0, instant = false }: {
  tab: Tab; active: boolean; onReorder?(tabId: string, steps: number): void;
  /** The places the dragged row would move if let go now; null once the drag ends without a move. */
  onSteps?(tabId: string, steps: number | null): void;
  /** The active row's view, so the sidebar can point to it when it is scrolled out of sight. */
  onActive?(view: View | null): void;
  /** How far this row is pushed aside (or, once dropped, carried) by a drag, in pt; `instant` once the list has caught up. */
  shift?: number; instant?: boolean;
}) {
  const actions = useActions();
  const { colors, reduceMotion } = useTheme();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [dy, setDy] = useState<number | null>(null);
  const [pinning, setPinning] = useState(false);
  const sidebarWidth = useShellPrefs(p => p.sidebarWidth);
  const ref = useRef<View>(null);
  const latest = useRef({ onReorder, onSteps, id: tab.id, sidebarWidth });
  latest.current = { onReorder, onSteps, id: tab.id, sidebarWidth };
  // The row's place while others are dragged past it, or after it was dropped, on the snappy spring.
  const offset = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (instant || reduceMotion) { offset.setValue(shift); return; }
    const run = Animated.spring(offset, { toValue: shift, ...spring.snappy, useNativeDriver: false });
    run.start();
    return () => run.stop();
  }, [shift, instant, reduceMotion, offset]);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => Math.hypot(g.dx, g.dy) > space.xs,
    onPanResponderGrant: () => actions.closeHoverCard(),
    onPanResponderMove: (_, g) => {
      const out = actions.tabDragMove(latest.current.id, g.moveX, g.moveY, g.moveX > latest.current.sidebarWidth + geometry.tearOff);
      // Up over the favourites, the row would be pinned there instead of moving in the list.
      const pinning = !out && actions.pinDragOver(latest.current.id, g.moveX, g.moveY);
      setPinning(pinning);
      setDy(out ? 0 : g.dy);
      latest.current.onSteps?.(latest.current.id, out || pinning ? 0 : Math.round(g.dy / rowStep));
    },
    onPanResponderRelease: (_, g) => {
      // The lifted row springs on from where it was let go.
      offset.setValue(g.dy);
      setDy(null);
      setPinning(false);
      if (actions.pinDragEnd()) { latest.current.onSteps?.(latest.current.id, null); return; }
      if (actions.tabDragEnd() === 'reorder') latest.current.onReorder?.(latest.current.id, Math.round(g.dy / rowStep));
      else latest.current.onSteps?.(latest.current.id, null);
    },
    onPanResponderTerminate: () => { offset.setValue(0); setDy(null); setPinning(false); actions.tabDragCancel(); latest.current.onSteps?.(latest.current.id, null); },
    onPanResponderTerminationRequest: () => false,
  }), [actions]);
  const glow = useShellPrefs(p => p.selectedTabGlow);
  const wash = useHoverFade(!active && (hovered || dy !== null), reduceMotion);
  const closeShown = useEased(hovered || active, reduceMotion);
  const title = tabTitle(tab);
  const sound = tab.audible || tab.muted;
  const hover = (on: boolean) => {
    setHovered(on);
    if (!on) { actions.leaveTab(); return; }
    ref.current?.measureInWindow((x, y, width, height) => actions.hoverTab(tab.id, { x, y, width, height }, 'right'));
  };
  return <ContextMenu onOpen={() => { actions.closeHoverCard(); void actions.tabMenu(tab.id); }}>
    <Animated.View ref={(view: View | null) => { ref.current = view; if (active) onActive?.(view); }} {...pan.panHandlers}
      onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: geometry.tabRow, borderRadius: radius.row,
        zIndex: dy !== null || shift !== 0 ? 1 : undefined, transform: [{ translateY: dy ?? offset }],
        // Over the favourites the row fades: its tile stands in for it there.
        opacity: pinning ? opacity.dim : 1 }}>
      <Animated.View pointerEvents="none" style={[cover, { borderRadius: radius.row, backgroundColor: colors.tabHover, opacity: wash }]} />
      {/* Dia's pressed fill, deeper than the wash; the selected row has none. */}
      {pressed && !active && <View pointerEvents="none" style={[cover, { borderRadius: radius.row, backgroundColor: colors.tabPressed }]} />}
      {/* The active card sits behind the row rather than around it, so a tab becoming active or not keeps its views. */}
      {active && <Panel fill="tabActive" radius="row" elevation={glowElevation[glow]} border="tabActiveBorder" style={cover} />}
      {/* Lifted while dragged: a card with a shadow over the rows, as in Ardia; like the rows, it holds its size. */}
      {dy !== null && !active && !pinning && <Panel fill="tabActive" radius="row" elevation="menu" border="tabActiveBorder" style={cover} />}
      <Pressable accessibilityRole="button" accessibilityState={{ selected: active }}
        accessibilityLabel={`${title}${tab.loading ? ', loading' : ''}${tab.muted ? ', muted' : tab.audible ? ', playing audio' : ''}${
          tab.engine === 'webkit' ? ', in WebKit' : ''}${tab.discarded ? ', asleep' : ''}`}
        // A tab is chosen as the button goes down, as in Dia, so switching feels immediate.
        onPressIn={() => { setPressed(true); actions.closeHoverCard(); void actions.activateTab(tab.id); }}
        onPressOut={() => setPressed(false)}
        style={{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.sm + space.hair,
          paddingLeft: space.sm + space.hair }}>
        <Favicon tab={tab} busy={tab.loading && !active} badges />
        {/* The title dissolves at its end instead of stopping at an ellipsis, as in Dia and Ardia. */}
        <Fade style={{ flex: 1 }}>
          <Text lines={1} ellipsizeMode="clip" style={{ width: geometry.titleRun }}
            tone={active ? 'tabTextActive' : tab.discarded ? 'textTertiary' : 'tabText'} weight={active ? 'medium' : undefined}>{title}</Text>
        </Fade>
      </Pressable>
      {sound && <SoundButton tab={tab} title={title} />}
      <Animated.View pointerEvents={hovered || active ? 'auto' : 'none'}
        style={{ width: geometry.control, alignItems: 'center', opacity: closeShown }}>
        <IconButton label={`Close ${title}`} tip="Close tab" keys={['⌘', 'W']} icon="xmark" size="small"
          onPress={() => { actions.closeHoverCard(); void actions.closeTab(tab.id); }} />
      </Animated.View>
    </Animated.View>
  </ContextMenu>;
});

/**
 * A tab's sound, pressed to mute or unmute it: while it plays, animated
 * equaliser bars rather than a still speaker; muted, a crossed speaker.
 */
export function SoundButton({ tab, title }: { tab: Tab; title: string }) {
  const actions = useActions();
  return <IconButton label={tab.muted ? `Unmute ${title}` : `Mute ${title}`} tip={tab.muted ? 'Unmute tab' : 'Mute tab'}
    icon={tab.muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} size="small" tone="iconSecondary"
    art={tab.muted ? undefined : <Equaliser playing={tab.audible} />}
    onPress={() => void actions.muteTab(tab.id, !tab.muted)} />;
}

/**
 * A pinned tab, shown as a favourite tile above the tab list. As in Dia, a
 * tile lights almost to white under the pointer, deeper while pressed, and
 * the chosen one takes its site's colour with a ring of it; resting on one
 * shows its card below it.
 */
export const FavouriteTile = React.memo(function FavouriteTile({ tab, active, width }: { tab: Tab; active: boolean; width: number | '100%' }) {
  const { colors, glass, dark } = useTheme();
  const glow = useShellPrefs(p => p.selectedTabGlow);
  const actions = useActions();
  const away = awayFromHome(tab, useBrowser(s => s.pinnedHomes[tab.id]));
  const { hovered, handlers } = useInteraction();
  const ref = useRef<View>(null);
  const title = tabTitle(tab, 'Pinned tab');
  const tint = active ? pinnedTileTint(tab.color, dark) : null;
  const ring = active ? pinnedTileRing(tab.color, dark) : null;
  const hover = (on: boolean) => {
    if (on) { handlers.onHoverIn(); ref.current?.measureInWindow((x, y, w, h) => actions.hoverTab(tab.id, { x, y, width: w, height: h }, 'below')); }
    else { handlers.onHoverOut(); actions.leaveTab(); }
  };
  const tile = <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={`Pinned: ${title}${tab.muted ? ', muted' : tab.audible ? ', playing audio' : ''}`}
    accessibilityState={{ selected: active }}
    // Pressing a tile that has wandered off its pinned page twice takes it back, as in Arc.
    onPress={() => { actions.closeHoverCard(); if (active && away) void actions.returnToPinnedPage(tab.id); else void actions.activateTab(tab.id); }}
    onHoverIn={() => hover(true)} onHoverOut={() => hover(false)} onFocus={handlers.onFocus} onBlur={handlers.onBlur}
    // A press puts the card away at once, as in Dia.
    onPressIn={actions.closeHoverCard}
    style={({ pressed }) => ({ width, height: geometry.favourite, borderRadius: radius.tile, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors[active || glass.on ? 'fillTransparent' : pressed ? 'tilePinnedPressed' : hovered ? 'tilePinnedHover' : 'tilePinned'] })}>
    {({ pressed }) => <>
      {/* With Glass, pinned tiles are glass plates, lit on hover and brightest when chosen, as in Ardia. */}
      {glass.on && <GlassFill radius={radius.tile} state={active ? 'active' : pressed ? 'pressed' : hovered ? 'lit' : 'rest'} />}
      {/* Glass's own lit plate is faint; the tile still lights almost to white, as Dia's does. */}
      {glass.on && !active && (hovered || pressed) && <View pointerEvents="none" style={[cover, { borderRadius: radius.tile,
        backgroundColor: colors[pressed ? 'tilePinnedPressed' : 'tilePinnedHover'] }]} />}
      {active && !glass.on && <Panel fill="tilePinnedActive" radius="tile" elevation={glowElevation[glow]} border="tabActiveBorder" style={cover} />}
      {tint && <View pointerEvents="none" style={[cover, { borderRadius: radius.tile, backgroundColor: tint }]} />}
      {/* The chosen tile's ring, in its site's colour, as Dia draws it. */}
      {ring && <View pointerEvents="none" style={[cover, { borderRadius: radius.tile, borderWidth: geometry.tileRing, borderColor: ring }]} />}
      <Favicon tab={tab} large busy={tab.loading && !active} badges />
      {(tab.audible || tab.muted) && <View style={{ position: 'absolute', top: space.hair, right: space.hair }}>
        <SoundButton tab={tab} title={title} />
      </View>}
      {/* A tile that has left its pinned page says so with a dot under the icon. */}
      {away && <View pointerEvents="none" style={{ position: 'absolute', bottom: space.xs, width: space.xs, height: space.xs,
        borderRadius: radius.pill, backgroundColor: colors.iconSecondary }} />}
    </>}
  </Pressable>;
  // As in TabRow, the active card is behind the tile, not around it.
  return <ContextMenu onOpen={() => { actions.closeHoverCard(); void actions.tabMenu(tab.id); }}>{tile}</ContextMenu>;
});
