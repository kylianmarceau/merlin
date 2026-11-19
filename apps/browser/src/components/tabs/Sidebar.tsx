import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SIDEBAR_WIDTH, useShellPrefs } from '../../state/shellPrefs';
import { previewShellPref, setShellPref } from '../../state/shellPrefsStorage';
import { tabUnits } from '../../state/splits';
import { reorderTarget } from '../../state/tabDrag';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import {
  DragRegion, Icon, IconButton, Pressable, Text, animateListChange, geometry, radius, space, useEased, useHoverFade, useInteraction,
  useTheme,
} from '../ui';
import { SidebarBookmarks } from '../bookmarks/SidebarBookmarks';
import { AddressField } from '../omnibox/AddressField';
import { NavigationButtons } from '../window/Toolbar';
import { useShortcut } from '../window/shortcuts';
import { FavouriteTile, TabRow } from './TabRow';
import { SidebarGroup, tabBlocks } from './TabGroups';
import { SidebarFooter } from './WindowButtons';

const columns = 4;
const tileGap = space.xs + space.hair;
const sidePadding = space.md + space.sm + space.hair;

/**
 * Tabs down the left of the window, on the tinted shell. The top row holds
 * the window controls and navigation and moves the window when dragged; then
 * the address, pinned tabs as favourite tiles, bookmarks, and the open tabs.
 * Its right edge drags to resize it. `floating` is the same sidebar peeking
 * in over the page while the tabs are hidden.
 */
export function Sidebar({ width, floating = false }: { width: number; floating?: boolean }) {
  const snapshot = useSnapshot();
  const actions = useActions();
  const { reduceMotion } = useTheme();
  const pending = useBrowser(s => s.panel === 'newTab');
  const pinned = snapshot.tabs.filter(t => t.pinned);
  const open = snapshot.tabs.filter(t => !t.pinned);
  const tile = Math.floor((width - sidePadding - tileGap * (columns - 1)) / columns);
  // A row dragged up or down moves among the open tabs; read when it drops, so rows keep their memo.
  const openIds = useRef<string[]>([]);
  // Rows in a collapsed group aren't on screen, so they don't count as places.
  const collapsed = new Set((snapshot.groups ?? []).filter(g => g.collapsed).map(g => g.id));
  openIds.current = open.filter(t => !t.group || !collapsed.has(t.group) || t.id === snapshot.activeTabId).map(t => t.id);
  const reorder = useCallback((id: string, steps: number) => {
    const target = reorderTarget(openIds.current, id, steps);
    if (target) void actions.moveTab(id, target.beforeId);
  }, [actions]);
  // A tab opening or closing, or a group folding: the rows around it slide, as in Dia.
  const shape = `${snapshot.tabs.length}|${snapshot.tabs.filter(t => t.pinned).length}|${[...collapsed].sort().join(' ')}`;
  const lastShape = useRef(shape);
  if (lastShape.current !== shape) {
    lastShape.current = shape;
    animateListChange(reduceMotion);
  }
  // Settings › Appearance › Address bar: in the toolbar, the page card carries navigation and the address.
  const addressHere = useShellPrefs(p => p.addressBar !== 'toolbar');
  const bookmarks = useShellPrefs(p => p.showBookmarks && p.sidebarBookmarks);
  const hide = useShortcut('Hide sidebar', ['⌘', 'S'], 'gs');
  const newTab = useShortcut('New tab', ['⌘', 'T'], 't');
  const list = useActiveRowPointer(snapshot.activeTabId);
  return <View style={{ width, paddingLeft: space.md, paddingRight: space.sm + space.hair, paddingBottom: space.sm + space.hair,
    gap: space.sm + space.hair }}>
    <View style={{ height: geometry.titlebar, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.hair }}>
      {!floating && <DragRegion style={{ position: 'absolute', top: 0, left: -space.md, right: -space.sm, bottom: 0 }} />}
      <IconButton label={floating ? 'Keep sidebar open' : 'Hide sidebar'} icon="sidebar.left"
        tip={floating ? 'Keep sidebar open' : hide.tip} keys={hide.keys} tipDetail={hide.detail}
        onPress={() => { actions.endPeek(); void actions.command('sidebar'); }} />
      {addressHere && <NavigationButtons />}
    </View>
    {addressHere && <AddressField variant="shell" listens={!floating} />}
    {snapshot.private && <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair, paddingHorizontal: space.sm + space.hair }}>
      <Icon name="eye.slash" tone="iconSecondary" size="small" />
      <Text variant="label" tone="textSecondary">Private window</Text>
    </View>}
    {!!pinned.length && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tileGap }}>
      {pinned.map(tab => <FavouriteTile key={tab.id} tab={tab} width={tile} active={tab.id === snapshot.activeTabId} />)}
    </View>}
    {bookmarks && <SidebarBookmarks />}
    <View style={{ flex: 1 }}>
      {/* As in Dia, a hairline divides the pinned tiles and bookmarks from the open tabs; with nothing above, it
          fades in only once the list has scrolled under it. */}
      <ScrollEdge shown={!!pinned.length || bookmarks || list.scrolled} />
      <View ref={list.frame} style={{ flex: 1 }} onLayout={list.check}>
        <ScrollView ref={list.scroll} style={{ flex: 1 }} onScroll={list.onScroll} scrollEventThrottle={32}
          onContentSizeChange={list.check}
          onScrollBeginDrag={actions.closeHoverCard}
          contentContainerStyle={{ gap: geometry.tabRowGap, paddingBottom: space.md, flexGrow: 1 }}>
          {tabBlocks(open, snapshot.groups).map(block => {
            const rows = tabUnits(block.tabs).map(unit => {
              const unitRows = unit.map(tab => <TabRow key={tab.id} tab={tab} active={tab.id === snapshot.activeTabId} onReorder={reorder}
                onActive={list.onActive} />);
              return unit.length > 1 ? <SidebarSplit key={`split:${unit[0].split}`}>{unitRows}</SidebarSplit> : unitRows[0];
            });
            return block.group
              ? <SidebarGroup key={`group:${block.group.id}`} group={block.group} count={block.tabs.length}
                active={block.tabs.some(t => t.id === snapshot.activeTabId)}>{rows}</SidebarGroup>
              : rows;
          })}
          {/* New Tab follows the last tab, as in Dia. */}
          <NewTabRow pending={pending} onPress={actions.openNewTab} keys={newTab.keys} />
          {/* Double-clicking the empty space under the tabs opens a new one, as in Arc. */}
          <View style={{ flex: 1, minHeight: space.xl }} onDoubleClick={() => actions.openNewTab()} />
        </ScrollView>
        {list.away && <ActiveTabPill direction={list.away} onPress={list.reveal} />}
      </View>
    </View>
    <SidebarFooter />
    {!floating && <ResizeEdge width={width} />}
  </View>;
}

/**
 * Where the active tab's row is in the list, so a pill can point to it when
 * it has scrolled out of sight, and whether the list has scrolled at all.
 */
function useActiveRowPointer(activeId: string | null) {
  const scroll = useRef<ScrollView>(null);
  const frame = useRef<View>(null);
  const row = useRef<View | null>(null);
  const offset = useRef(0);
  const [scrolled, setScrolled] = useState(false);
  const [away, setAway] = useState<'up' | 'down' | null>(null);
  const check = useCallback(() => {
    const list = frame.current, active = row.current;
    if (!list || !active) { setAway(null); return; }
    list.measureInWindow((_lx, ly, _lw, lh) => active.measureInWindow((_x, y, _w, h) => {
      setAway(y + h < ly + space.xs ? 'up' : y > ly + lh - space.xs ? 'down' : null);
    }));
  }, []);
  useEffect(check, [activeId, check]);
  return {
    // Measured again whenever the list or its rows move (bookmarks loading
    // above it, the sidebar sliding in), not only when the active tab changes.
    scroll, frame, scrolled, away, check,
    onActive: useCallback((view: View | null) => { row.current = view; check(); }, [check]),
    onScroll: useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = e.nativeEvent.contentOffset.y;
      setScrolled(offset.current > 0);
      check();
    }, [check]),
    reveal: useCallback(() => {
      const list = frame.current, active = row.current;
      if (!list || !active) return;
      list.measureInWindow((_lx, ly, _lw, lh) => active.measureInWindow((_x, y, _w, h) => {
        const target = offset.current + (y - ly) - (lh - h) / 2;
        scroll.current?.scrollTo({ y: Math.max(0, target), animated: true });
      }));
    }, []),
  };
}

/** A hairline that fades in under a heading once the list below it has scrolled. */
function ScrollEdge({ shown }: { shown: boolean }) {
  const { colors, reduceMotion } = useTheme();
  const value = useEased(shown, reduceMotion);
  return <Animated.View pointerEvents="none" style={{ height: geometry.hairline, marginHorizontal: space.xs, marginBottom: space.xs,
    opacity: value, backgroundColor: colors.sidebarRule }} />;
}

/** A small pill at the list's top or bottom edge pointing to the active tab when it is scrolled out of sight. */
function ActiveTabPill({ direction, onPress }: { direction: 'up' | 'down'; onPress(): void }) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center',
    ...(direction === 'up' ? { top: space.xs } : { bottom: space.xs }) }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Show the current tab" onPress={onPress} {...handlers}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, height: geometry.round + space.xs, paddingHorizontal: space.sm,
        borderRadius: radius.pill, backgroundColor: colors[hovered ? 'tabActive' : 'tilePinnedActive'],
        borderWidth: geometry.hairline, borderColor: colors.tabActiveBorder }}>
      <Icon name={direction === 'up' ? 'chevron.up' : 'chevron.down'} tone="iconSecondary" size="chevron" weight="semibold" />
      <Text variant="caption" tone="textSecondary">Current tab</Text>
    </Pressable>
  </View>;
}

/** The sidebar's right edge: drag it to make the sidebar wider or narrower; double-click to reset. */
function ResizeEdge({ width }: { width: number }) {
  const start = useRef(width);
  const latest = useRef(width);
  latest.current = width;
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start.current = latest.current; },
    onPanResponderMove: (_, g) => previewShellPref('sidebarWidth', clampWidth(start.current + g.dx)),
    onPanResponderRelease: (_, g) => void setShellPref('sidebarWidth', clampWidth(start.current + g.dx)),
    onPanResponderTerminate: () => void setShellPref('sidebarWidth', latest.current),
  }), []);
  return <View {...pan.panHandlers} accessibilityLabel="Resize sidebar" onDoubleClick={() => void setShellPref('sidebarWidth', SIDEBAR_WIDTH.default)}
    style={{ position: 'absolute', top: geometry.titlebar, bottom: 0, right: -geometry.resizeHandle / 2, width: geometry.resizeHandle,
      cursor: 'col-resize' }} />;
}
const clampWidth = (w: number) => Math.round(Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, w)));

/** A split view's tabs, together on one soft pill, as across the top. */
function SidebarSplit({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <View accessibilityLabel="Split view" style={{ gap: geometry.hairline, borderRadius: radius.row, backgroundColor: colors.splitChip }}>
    {children}
  </View>;
}

/** New Tab; while the new-tab pop-up is open it stands for the tab about to open. */
function NewTabRow({ onPress, pending, keys }: { onPress(): void; pending: boolean; keys: string[] }) {
  const { colors, reduceMotion } = useTheme();
  const { hovered, handlers } = useInteraction();
  const [pressed, setPressed] = useState(false);
  const wash = useHoverFade(hovered || pending, reduceMotion);
  return <Pressable accessibilityRole="button" accessibilityLabel="New tab" onPress={onPress} {...handlers}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + space.hair, minHeight: geometry.tabRow,
      paddingLeft: space.sm + space.hair, paddingRight: space.sm, borderRadius: radius.row,
      borderWidth: geometry.hairline, borderColor: colors[pending ? 'focusRing' : 'fillTransparent'] }}>
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.row,
      backgroundColor: colors.tabHover, opacity: wash }} />
    {pressed && <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.row,
      backgroundColor: colors.tabPressed }} />}
    <Icon name="plus" tone={pending ? 'accentSoftText' : 'iconSecondary'} size="small" />
    <Text tone={pending ? 'accentSoftText' : 'textSecondary'} flex={1}>{pending ? 'New tab…' : 'New Tab'}</Text>
    {hovered && <Text variant="caption" tone="textTertiary">{keys.join('')}</Text>}
  </Pressable>;
}
