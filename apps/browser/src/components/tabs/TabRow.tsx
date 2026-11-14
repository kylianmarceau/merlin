import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActions } from '../../state/window';
import { ContextMenu, GlassFill, IconButton, Panel, Text, useInteraction, useTheme, geometry, radius, space, type ShadowName } from '../ui';

const glowElevation: Record<'full' | 'soft' | 'off', ShadowName> = { full: 'tabGlow', soft: 'tab', off: 'none' };
import { Favicon } from '../favicon/Favicon';

const cover = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

/** One row's height in the list, for turning a drag into a number of places. */
const rowStep = geometry.tabRow + geometry.hairline;

/**
 * A tab in the sidebar list. The active tab is lifted off the shell as a white
 * card; the others wash white on hover. Right-click opens its native menu.
 * Drag it up or down to reorder (`onReorder` gets the number of places), to
 * the right onto the page to split it beside the current tab, or out of the
 * window to give it a window of its own.
 */
export const TabRow = React.memo(function TabRow({ tab, active, onReorder }: {
  tab: Tab; active: boolean; onReorder?(tabId: string, steps: number): void;
}) {
  const actions = useActions();
  const { colors } = useTheme();
  const [hovered, setHovered] = useState(false);
  const [dy, setDy] = useState<number | null>(null);
  const latest = useRef({ onReorder, id: tab.id });
  latest.current = { onReorder, id: tab.id };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => Math.hypot(g.dx, g.dy) > space.xs,
    onPanResponderMove: (_, g) => {
      const out = actions.tabDragMove(latest.current.id, g.moveX, g.moveY, g.moveX > geometry.sidebar + geometry.tearOff);
      setDy(out ? 0 : g.dy);
    },
    onPanResponderRelease: (_, g) => {
      setDy(null);
      if (!actions.tabDragEnd()) latest.current.onReorder?.(latest.current.id, Math.round(g.dy / rowStep));
    },
    onPanResponderTerminate: () => { setDy(null); actions.tabDragCancel(); },
    onPanResponderTerminationRequest: () => false,
  }), [actions]);
  const glow = useShellPrefs(p => p.selectedTabGlow);
  const title = isStartUrl(tab.url) ? 'New Tab' : tab.title || tab.url || 'New Tab';
  const row = <ContextMenu onOpen={() => void actions.tabMenu(tab.id)}>
    <Animated.View {...pan.panHandlers} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: geometry.tabRow, borderRadius: radius.row,
        backgroundColor: colors[!active && (hovered || dy !== null) ? 'tabHover' : 'fillTransparent'],
        zIndex: dy !== null ? 1 : undefined, transform: [{ translateY: dy ?? 0 }] }}>
      {active && <Panel fill="tabActive" radius="row" elevation={glowElevation[glow]} border="tabActiveBorder" style={cover} />}
      <Pressable accessibilityRole="button" accessibilityState={{ selected: active }}
        accessibilityLabel={`${title}${tab.loading ? ', loading' : ''}${tab.audible ? ', playing audio' : ''}`}
        onPress={() => void actions.activateTab(tab.id)}
        style={{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.sm + space.hair,
          paddingLeft: space.sm + space.hair }}>
        <Favicon tab={tab} busy={tab.loading && !active} />
        <Text lines={1} flex={1} tone={active ? 'tabTextActive' : 'tabText'} weight={active ? 'medium' : undefined}>{title}</Text>
        {tab.audible && <Text variant="caption" tone="textTertiary">♪</Text>}
      </Pressable>
      <View style={{ width: geometry.control, alignItems: 'center', opacity: hovered || active ? 1 : 0 }}>
        <IconButton label={`Close ${title}`} icon="xmark" size="small" onPress={() => void actions.closeTab(tab.id)} />
      </View>
    </Animated.View>
  </ContextMenu>;
  // The active card sits behind the row rather than around it, so a tab
  // becoming active or not keeps its views.
  return row;
});

/** A pinned tab, shown as a favourite tile above the tab list. */
export const FavouriteTile = React.memo(function FavouriteTile({ tab, active, width }: { tab: Tab; active: boolean; width: number }) {
  const { colors, glass } = useTheme();
  const glow = useShellPrefs(p => p.selectedTabGlow);
  const actions = useActions();
  const { hovered, handlers } = useInteraction();
  const title = tab.title || tab.url || 'Pinned tab';
  const tile = <Pressable accessibilityRole="button" accessibilityLabel={`Pinned: ${title}`} accessibilityState={{ selected: active }}
    onPress={() => void actions.activateTab(tab.id)} {...handlers}
    style={{ width, height: geometry.favourite, borderRadius: radius.tile, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors[active || glass.on ? 'fillTransparent' : hovered ? 'fillShellControl' : 'tilePinned'] }}>
    {/* With Glass, pinned tiles are glass plates, lit on hover and brightest when chosen, as in Ardia. */}
    {glass.on && <GlassFill radius={radius.tile} state={active ? 'active' : hovered ? 'lit' : 'rest'} />}
    {active && !glass.on && <Panel fill="tilePinnedActive" radius="tile" elevation={glowElevation[glow]} border="tabActiveBorder" style={cover} />}
    <Favicon tab={tab} large busy={tab.loading && !active} />
    {tab.audible && <View style={{ position: 'absolute', bottom: space.hair, right: space.xs }}>
      <Text variant="micro">♪</Text>
    </View>}
  </Pressable>;
  // As in TabRow, the active card is behind the tile, not around it.
  return <ContextMenu onOpen={() => void actions.tabMenu(tab.id)}>{tile}</ContextMenu>;
});
