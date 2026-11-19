import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { displayAddress, isStartUrl, leftToRight } from '../../lib/format';
import type { Tab } from '../../state/types';
import { awayFromHome } from '../../state/pinned';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActions, useBrowser } from '../../state/window';
import {
  ContextMenu, Fade, GlassFill, IconButton, Panel, Pressable, Text, geometry, pinnedTileTint, radius, space, useEased, useHoverFade,
  useInteraction, useTheme, type ShadowName,
} from '../ui';
import { Favicon } from '../favicon/Favicon';

const glowElevation: Record<'full' | 'soft' | 'off', ShadowName> = { full: 'tabGlow', soft: 'tab', off: 'none' };

const cover = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

/** One row's height in the list, for turning a drag into a number of places. */
export const rowStep = geometry.tabRow + geometry.hairline;

/** A tab's title, or its address as Chromium formats it, never the raw URL (which can carry a user name). */
export function tabTitle(tab: Tab, fallback = 'New Tab') {
  return isStartUrl(tab.url) ? 'New Tab' : tab.title || leftToRight(tab.displayUrl ?? displayAddress(tab.url)) || fallback;
}

/**
 * A tab in the sidebar list. The active tab is lifted off the shell as a white
 * card; the others wash white on hover, in at once and out slowly, as in Dia.
 * Resting on a row brings up its hover card. Right-click opens its native
 * menu. Drag it up or down to reorder (`onReorder` gets the number of places;
 * a line shows where it lands), to the right onto the page to split it beside
 * the current tab, or out of the window to give it a window of its own.
 */
export const TabRow = React.memo(function TabRow({ tab, active, onReorder, onActive }: {
  tab: Tab; active: boolean; onReorder?(tabId: string, steps: number): void;
  /** The active row's view, so the sidebar can point to it when it is scrolled out of sight. */
  onActive?(view: View | null): void;
}) {
  const actions = useActions();
  const { colors, reduceMotion } = useTheme();
  const [hovered, setHovered] = useState(false);
  const [dy, setDy] = useState<number | null>(null);
  const sidebarWidth = useShellPrefs(p => p.sidebarWidth);
  const ref = useRef<View>(null);
  const latest = useRef({ onReorder, id: tab.id, sidebarWidth });
  latest.current = { onReorder, id: tab.id, sidebarWidth };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => Math.hypot(g.dx, g.dy) > space.xs,
    onPanResponderGrant: () => actions.closeHoverCard(),
    onPanResponderMove: (_, g) => {
      const out = actions.tabDragMove(latest.current.id, g.moveX, g.moveY, g.moveX > latest.current.sidebarWidth + geometry.tearOff);
      setDy(out ? 0 : g.dy);
    },
    onPanResponderRelease: (_, g) => {
      setDy(null);
      if (actions.tabDragEnd() === 'reorder') latest.current.onReorder?.(latest.current.id, Math.round(g.dy / rowStep));
    },
    onPanResponderTerminate: () => { setDy(null); actions.tabDragCancel(); },
    onPanResponderTerminationRequest: () => false,
  }), [actions]);
  const glow = useShellPrefs(p => p.selectedTabGlow);
  const wash = useHoverFade(!active && (hovered || dy !== null), reduceMotion);
  const closeShown = useEased(hovered || active, reduceMotion);
  const title = tabTitle(tab);
  const sound = tab.audible || tab.muted;
  const steps = dy === null ? 0 : Math.round(dy / rowStep);
  const hover = (on: boolean) => {
    setHovered(on);
    if (!on) { actions.leaveTab(); return; }
    ref.current?.measureInWindow((x, y, width, height) => actions.hoverTab(tab.id, { x, y, width, height }, 'right'));
  };
  return <ContextMenu onOpen={() => { actions.closeHoverCard(); void actions.tabMenu(tab.id); }}>
    <Animated.View ref={(view: View | null) => { ref.current = view; if (active) onActive?.(view); }} {...pan.panHandlers}
      onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: geometry.tabRow, borderRadius: radius.row,
        zIndex: dy !== null ? 1 : undefined, transform: [{ translateY: dy ?? 0 }] }}>
      <Animated.View pointerEvents="none" style={[cover, { borderRadius: radius.row, backgroundColor: colors.tabHover, opacity: wash }]} />
      {/* The active card sits behind the row rather than around it, so a tab becoming active or not keeps its views. */}
      {active && <Panel fill="tabActive" radius="row" elevation={glowElevation[glow]} border="tabActiveBorder" style={cover} />}
      {/* Where the dragged row lands: a line between the rows it goes between. */}
      {steps !== 0 && <View pointerEvents="none" style={{ position: 'absolute', left: space.sm, right: space.sm, height: geometry.focusRing,
        borderRadius: radius.pill, backgroundColor: colors.tabDropLine,
        top: steps * rowStep - (dy ?? 0) + (steps > 0 ? geometry.tabRow : -geometry.hairline) - geometry.hairline }} />}
      <Pressable accessibilityRole="button" accessibilityState={{ selected: active }}
        accessibilityLabel={`${title}${tab.loading ? ', loading' : ''}${tab.muted ? ', muted' : tab.audible ? ', playing audio' : ''}${
          tab.engine === 'webkit' ? ', in WebKit' : ''}${tab.discarded ? ', asleep' : ''}`}
        onPress={() => { actions.closeHoverCard(); void actions.activateTab(tab.id); }}
        style={{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.sm + space.hair,
          paddingLeft: space.sm + space.hair }}>
        <Favicon tab={tab} busy={tab.loading && !active} badges />
        {/* The title dissolves at its end instead of stopping at an ellipsis, as in Dia and Ardia. */}
        <Fade style={{ flex: 1 }}>
          <Text lines={1} ellipsizeMode="clip" style={{ width: geometry.titleRun }}
            tone={active ? 'tabTextActive' : tab.discarded ? 'textTertiary' : 'tabText'} weight={active ? 'medium' : undefined}>{title}</Text>
        </Fade>
      </Pressable>
      {sound && <IconButton label={tab.muted ? `Unmute ${title}` : `Mute ${title}`} tip={tab.muted ? 'Unmute tab' : 'Mute tab'}
        icon={tab.muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} size="small" tone="iconSecondary"
        onPress={() => void actions.muteTab(tab.id, !tab.muted)} />}
      <Animated.View pointerEvents={hovered || active ? 'auto' : 'none'}
        style={{ width: geometry.control, alignItems: 'center', opacity: closeShown }}>
        <IconButton label={`Close ${title}`} tip="Close tab" keys={['⌘', 'W']} icon="xmark" size="small"
          onPress={() => { actions.closeHoverCard(); void actions.closeTab(tab.id); }} />
      </Animated.View>
    </Animated.View>
  </ContextMenu>;
});

/**
 * A pinned tab, shown as a favourite tile above the tab list. The chosen
 * tile takes its site's colour, as in Dia; resting on one shows its card.
 */
export const FavouriteTile = React.memo(function FavouriteTile({ tab, active, width }: { tab: Tab; active: boolean; width: number }) {
  const { colors, glass, dark } = useTheme();
  const glow = useShellPrefs(p => p.selectedTabGlow);
  const actions = useActions();
  const away = awayFromHome(tab, useBrowser(s => s.pinnedHomes[tab.id]));
  const { hovered, handlers } = useInteraction();
  const ref = useRef<View>(null);
  const title = tabTitle(tab, 'Pinned tab');
  const tint = active ? pinnedTileTint(tab.color, dark) : null;
  const hover = (on: boolean) => {
    if (on) { handlers.onHoverIn(); ref.current?.measureInWindow((x, y, w, h) => actions.hoverTab(tab.id, { x, y, width: w, height: h }, 'below')); }
    else { handlers.onHoverOut(); actions.leaveTab(); }
  };
  const tile = <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={`Pinned: ${title}${tab.muted ? ', muted' : tab.audible ? ', playing audio' : ''}`}
    accessibilityState={{ selected: active }}
    // Pressing a tile that has wandered off its pinned page twice takes it back, as in Arc.
    onPress={() => { actions.closeHoverCard(); if (active && away) void actions.returnToPinnedPage(tab.id); else void actions.activateTab(tab.id); }}
    onHoverIn={() => hover(true)} onHoverOut={() => hover(false)} onFocus={handlers.onFocus} onBlur={handlers.onBlur}
    style={{ width, height: geometry.favourite, borderRadius: radius.tile, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors[active || glass.on ? 'fillTransparent' : hovered ? 'fillShellControl' : 'tilePinned'] }}>
    {/* With Glass, pinned tiles are glass plates, lit on hover and brightest when chosen, as in Ardia. */}
    {glass.on && <GlassFill radius={radius.tile} state={active ? 'active' : hovered ? 'lit' : 'rest'} />}
    {active && !glass.on && <Panel fill="tilePinnedActive" radius="tile" elevation={glowElevation[glow]} border="tabActiveBorder" style={cover} />}
    {tint && <View pointerEvents="none" style={[cover, { borderRadius: radius.tile, backgroundColor: tint }]} />}
    <Favicon tab={tab} large busy={tab.loading && !active} badges />
    {(tab.audible || tab.muted) && <View style={{ position: 'absolute', top: space.hair, right: space.hair }}>
      <IconButton label={tab.muted ? `Unmute ${title}` : `Mute ${title}`} tip={tab.muted ? 'Unmute tab' : 'Mute tab'}
        icon={tab.muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} size="small" tone="iconSecondary"
        onPress={() => void actions.muteTab(tab.id, !tab.muted)} />
    </View>}
    {/* A tile that has left its pinned page says so with a dot under the icon. */}
    {away && <View pointerEvents="none" style={{ position: 'absolute', bottom: space.xs, width: space.xs, height: space.xs,
      borderRadius: radius.pill, backgroundColor: colors.iconSecondary }} />}
  </Pressable>;
  // As in TabRow, the active card is behind the tile, not around it.
  return <ContextMenu onOpen={() => { actions.closeHoverCard(); void actions.tabMenu(tab.id); }}>{tile}</ContextMenu>;
});
