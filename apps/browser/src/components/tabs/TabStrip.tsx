import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import type { Tab } from '../../state/types';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import {
  ContextMenu, DragRegion, Fade, Icon, IconButton, PaletteScope, Text, duration, geometry, radius, space, useColorFade,
  groupColorRoles, opacity, useHoverFade, useInteraction, useLatest, usePresence, useSlide, useTheme, useTimeout, Panel, Pressable, type Palette,
} from '../ui';
import { StripGroupChip, chipWidth } from './TabGroups';
import { Favicon } from '../favicon/Favicon';
import { tabTitle as rowTitle } from './TabRow';
import { useSiteChrome } from './siteChrome';
import { DownloadsButton, LibraryButtons } from './WindowButtons';
import { dropBefore, dropPlace, itemSlot, layoutStrip, reflow, type Slot, type StripItem, type StripMetrics } from './stripLayout';

// Tabs sit on the bottom of the strip, so the active one can join the toolbar.
const tabTop = geometry.strip - geometry.joinedTab;
const gap = geometry.hairline;
const metrics: StripMetrics = {
  tab: geometry.stripTab, tabMin: geometry.stripTabMin, icon: geometry.stripTabIcon, gap, pinnedGap: space.sm,
  overflow: geometry.overflowButton, trailing: geometry.control + space.xs, chipWidth,
};

/**
 * An item being dragged. `tabId` is the tab under the pointer (one side of
 * a split view); `out` is set once it has left the tabs for the page, and
 * `released` once it has been let go and waits for the browser's new order.
 */
type Drag = { key: string; tabId: string; dx: number; out: boolean; released: boolean };
type DragHandlers = { onDrag(dx: number, x: number, y: number): void; onDrop(dx: number, cancelled: boolean): void };

/**
 * Tabs across the top of the window, on the tinted shell beside the traffic
 * lights. The active tab grows out of the toolbar like the tab of a folder,
 * in the colour of the site; it slides to whichever tab becomes active.
 * Pinned tabs are icons in a soft group; the others share the width, drop
 * their titles when crowded, and past that collect behind a "+N" menu. A
 * split view's two tabs are one piece, as in Ardia.
 * Drag a tab (or a split) to reorder it; pull a tab down onto the page to
 * show it in a split view, or out of the window to give it a window of its
 * own. Empty space moves the window.
 */
export function TabStrip({ floating = false }: {
  /** Peeking in over the page while the tabs are hidden: no toolbar to join, so the active tab is a white pill. */
  floating?: boolean;
} = {}) {
  const snapshot = useSnapshot();
  const actions = useActions();
  const { colors } = useTheme();
  const chrome = useSiteChrome();
  const [room, setRoom] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const activeId = snapshot.activeTabId;
  // Downloads shows only while there are some, as in Dia; the Library keeps them all.
  const popoverOpen = useBrowser(s => s.popover === 'downloads');
  const groups = snapshot.groups ?? [];
  const full = useMemo(() => layoutStrip(snapshot.tabs, groups, activeId, room, metrics),
    [snapshot.tabs, snapshot.groups, activeId, room]);  // eslint-disable-line react-hooks/exhaustive-deps
  // A tab pulled out of the tabs leaves its place and the others close up;
  // a split's side stays in its split, faded, until it lands.
  const dragged = drag ? [...full.pinned, ...full.open].find(i => i.key === drag.key) ?? null : null;
  const liftedKey = drag?.out && dragged?.tabs.length === 1 ? drag.key : null;
  const layout = useMemo(() => (liftedKey ? layoutStrip(snapshot.tabs, groups, activeId, room, metrics, liftedKey) : full),
    [full, liftedKey]);  // eslint-disable-line react-hooks/exhaustive-deps
  const shown = [...layout.pinned, ...layout.open];
  const lifted = liftedKey ? dragged : null;

  // A dropped tab keeps its new place until Chromium reports the new order (or split).
  const order = snapshot.tabs.map(t => `${t.id}:${t.split ?? ''}`).join(' ');
  useEffect(() => { setDrag(current => (current?.released ? null : current)); }, [order]);
  useTimeout(() => { if (drag?.released) setDrag(null); }, duration.dropSettle, [drag?.released]);

  const laneOf = (item: StripItem) => (item.pinned ? layout.pinned : layout.open);
  const moving = drag && !drag.out ? shown.find(i => i.key === drag.key) : undefined;
  const place = drag && moving ? dropPlace(laneOf(moving), layout.slots, drag.key, drag.dx, gap) : -1;
  const slots = drag && moving && place >= 0 ? reflow(laneOf(moving), layout.slots, drag.key, place) : layout.slots;
  const following = !!drag && !drag.released && !drag.out;
  /** Where an item is drawn: under the pointer while it is dragged, else in its place. */
  const slotOf = (item: StripItem): Slot | null => {
    if (item === lifted) return itemSlot(item, full.slots);
    const home = itemSlot(item, layout.slots);
    if (following && item.key === drag.key) return home && { ...home, x: home.x + drag.dx };
    return itemSlot(item, slots);
  };
  const holdsActive = (item: StripItem) => item.tabs.some(t => t.id === activeId);
  const activeItem = shown.find(holdsActive) ?? (lifted && holdsActive(lifted) ? lifted : null);

  const dragTo = (key: string, tabId: string, dx: number, x: number, y: number) => {
    const out = actions.tabDragMove(tabId, x, y, y > geometry.strip + geometry.tearOff);
    setDrag({ key, tabId, dx: out ? 0 : dx, out, released: false });
  };
  const release = (key: string, dx: number, cancelled: boolean) => {
    const wasOut = !!drag?.out;
    const result = cancelled ? (actions.tabDragCancel(), wasOut ? 'stayed' : 'reorder') : actions.tabDragEnd();
    // Gone to a split or a window: it stays out of the tabs until the browser says where it went.
    if (result === 'moved') setDrag(current => current && { ...current, released: true });
    else if (result === 'stayed') setDrag(null);
    else drop(key, dx);
  };
  const drop = (key: string, dx: number) => {
    const item = shown.find(i => i.key === key);
    if (!item) { setDrag(null); return; }
    const lane = laneOf(item);
    const to = dropPlace(lane, layout.slots, key, dx, gap);
    if (to < 0 || to === lane.indexOf(item)) { setDrag(null); return; }
    setDrag({ key, tabId: item.tabs[0].id, dx, out: false, released: true });
    void actions.moveTab(item.tabs[0].id, dropBefore(snapshot.tabs, lane, key, to));
  };
  const handlers = (key: string, tabId: string): DragHandlers => ({
    onDrag: (dx, x, y) => dragTo(key, tabId, dx, x, y),
    onDrop: (dx, cancelled) => release(key, dx, cancelled),
  });

  const plusX = layout.end + (layout.hidden.length ? geometry.overflowButton : 0) + space.xs;
  return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: geometry.strip, flexDirection: 'row',
    paddingLeft: geometry.sidebarCollapsedInset, paddingRight: space.sm + space.hair }}>
    <DragRegion style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    {snapshot.private && <View style={{ height: geometry.strip, justifyContent: 'center', marginRight: space.sm }}>
      <Icon name="eye.slash" tone="iconSecondary" size="small" />
    </View>}
    <View style={{ flex: 1, height: geometry.strip }} pointerEvents="box-none" onLayout={e => setRoom(e.nativeEvent.layout.width)}>
      {room > 0 && <>
        {!!layout.pinned.length && <View pointerEvents="none" style={{ position: 'absolute', left: -space.hair,
          width: layout.pinnedEnd + space.xs, top: tabTop + space.xs, height: geometry.joinedTab - space.sm, borderRadius: radius.field,
          backgroundColor: colors.fillShellGroup }} />}
        {!drag && layout.chips.map(chip => chip.end > chip.x + chip.width &&
          <View key={`wash:${chip.group.id}`} pointerEvents="none" style={{ position: 'absolute', left: chip.x - space.hair,
            width: chip.end - chip.x + space.hair * 2, top: tabTop + space.xs, height: geometry.joinedTab - space.sm,
            borderRadius: radius.field, backgroundColor: colors[groupColorRoles[chip.group.color]], opacity: opacity.groupWash }} />)}
        {layout.chips.map(chip => <StripGroupChip key={`chip:${chip.group.id}`} group={chip.group} x={chip.x} width={chip.width}
          top={tabTop} height={geometry.joinedTab} />)}
        {!floating && <JoinedShape slot={activeItem ? slotOf(activeItem) : null} color={chrome.bar} hidden={!!activeItem && activeItem === lifted}
          following={following && activeItem?.key === drag?.key} />}
        {[...shown, ...(lifted ? [lifted] : [])].map(item => {
          const slot = slotOf(item);
          if (!slot) return null;
          const active = holdsActive(item);
          const dragging = following && item.key === drag?.key;
          const icon = item.pinned || layout.compact;
          const roles = active && !floating ? chrome.roles : null;
          if (item.tabs.length > 1) return <StripSplit key={item.key} tabs={item.tabs} slot={slot} activeId={activeId} icon={icon}
            pinned={item.pinned} roles={roles} dragging={dragging} handlers={tabId => handlers(item.key, tabId)}
            liftedId={drag?.out && drag.key === item.key ? drag.tabId : null} />;
          const tab = item.tabs[0];
          return <StripTab key={item.key} tab={tab} slot={slot} active={active} icon={icon} roles={roles} dragging={dragging} pill={floating && active}
            lifted={item === lifted} {...handlers(item.key, tab.id)} />;
        })}
        {!!layout.hidden.length && <OverflowButton x={layout.end + space.xs} count={layout.hidden.length}
          onPress={() => void actions.hiddenTabsMenu(layout.hidden)} />}
        <PlusButton x={plusX} onPress={() => void actions.openNewTab()} />
      </>}
    </View>
    <View style={{ height: geometry.strip, flexDirection: 'row', alignItems: 'center', gap: space.hair }}>
      <LibraryButtons />
      {/* Last, so its popover hangs at the window's right edge, as in Ardia. */}
      {(!!snapshot.downloads.length || popoverOpen) && <DownloadsButton />}
    </View>
  </View>;
}

/**
 * The active tab's outline, in the toolbar's colour, joined to the toolbar
 * with a concave ear at each bottom corner. Each ear is a ring clipped to a
 * square: the ring's inner edge is the curve, so nothing is drawn over the
 * translucent shell. It reaches a point below the strip to cover the card's
 * top edge, so tab and toolbar read as one piece. Under a split view it
 * spans both of its tabs; it fades while the active tab is pulled out.
 */
function JoinedShape({ slot, color, following, hidden }: { slot: Slot | null; color: string; following: boolean; hidden: boolean }) {
  const { reduceMotion } = useTheme();
  const kept = useLatest(slot);
  const { x, width } = useSlide(kept, reduceMotion, following);
  const fill = useColorFade(color, reduceMotion);
  const presence = usePresence(!!slot && !hidden, 'fade', reduceMotion);
  if (!kept || !presence.mounted) return null;
  const ear = geometry.joinedEar;
  const ring = ear * 2;
  // Position animates on the outer view and opacity on the inner one: they run on different drivers.
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', top: tabTop, left: x, width,
    height: geometry.joinedTab + geometry.hairline }}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: presence.progress }}>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: fill,
        borderTopLeftRadius: radius.tab, borderTopRightRadius: radius.tab }} />
      <View style={{ position: 'absolute', bottom: 0, left: -ear, width: ear, height: ear, overflow: 'hidden' }}>
        <Animated.View style={{ position: 'absolute', left: -ring, top: -ring, width: ring * 2, height: ring * 2, borderRadius: ring,
          borderWidth: ring - ear, borderColor: fill }} />
      </View>
      <View style={{ position: 'absolute', bottom: 0, right: -ear, width: ear, height: ear, overflow: 'hidden' }}>
        <Animated.View style={{ position: 'absolute', left: ear - ring, top: -ring, width: ring * 2, height: ring * 2, borderRadius: ring,
          borderWidth: ring - ear, borderColor: fill }} />
      </View>
    </Animated.View>
  </Animated.View>;
}

/** A pan responder for dragging a tab, made once, that always calls the latest handlers. */
function useTabPan({ onDrag, onDrop }: DragHandlers) {
  const latest = useRef({ onDrag, onDrop });
  latest.current = { onDrag, onDrop };
  return useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => Math.hypot(g.dx, g.dy) > space.xs,
    onPanResponderMove: (_, g) => latest.current.onDrag(g.dx, g.moveX, g.moveY),
    onPanResponderRelease: (_, g) => latest.current.onDrop(g.dx, false),
    onPanResponderTerminate: (_, g) => latest.current.onDrop(g.dx, true),
    onPanResponderTerminationRequest: () => false,
  }), []);
}

const tabTitle = (tab: Tab) => rowTitle(tab);

type StripTabProps = DragHandlers & {
  tab: Tab; slot: Slot; active: boolean; icon: boolean; dragging: boolean;
  /** The active tab drawn as a white pill, when there is no toolbar for it to join. */
  pill?: boolean;
  /** Pulled out of the tabs: it fades while the page shows where it can go. */
  lifted: boolean;
  /** The site's colours, for the active tab, which sits on the joined shape. */
  roles: Partial<Palette> | null;
};

const StripTab = React.memo(function StripTab({ tab, slot, active, icon, dragging, lifted, roles, pill = false, onDrag, onDrop }: StripTabProps) {
  const actions = useActions();
  const { colors, reduceMotion } = useTheme();
  const { focused, handlers } = useInteraction();
  const [hovered, setHovered] = useState(false);
  const { x, width } = useSlide(slot, reduceMotion, dragging);
  const there = usePresence(!lifted, 'fade', reduceMotion);
  const wash = useHoverFade(!active && hovered && !dragging, reduceMotion);
  const pan = useTabPan({ onDrag, onDrop });
  const ref = useRef<View>(null);
  const title = tabTitle(tab);
  const sound = tab.audible || tab.muted;
  const hover = (on: boolean) => {
    setHovered(on);
    if (!on) { actions.leaveTab(); return; }
    ref.current?.measureInWindow((x0, y0, w, h) => actions.hoverTab(tab.id, { x: x0, y: y0, width: w, height: h }, 'below'));
  };
  const label = `${tab.pinned ? 'Pinned: ' : ''}${title}${tab.loading ? ', loading' : ''}${tab.muted ? ', muted' : tab.audible ? ', playing audio' : ''}${
    tab.engine === 'webkit' ? ', in WebKit' : ''}`;
  const body = <Animated.View ref={ref} {...pan.panHandlers} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}
    style={{ position: 'absolute', top: tabTop, left: x, width, height: geometry.joinedTab, zIndex: dragging ? 2 : undefined }}>
    <Animated.View style={{ flex: 1, opacity: there.progress }}>
      {pill && <Panel fill="tabActive" radius="control" elevation="tab" border="tabActiveBorder" style={{ position: 'absolute', top: space.xs,
        bottom: space.xs, left: space.hair, right: space.hair }} />}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', top: space.xs, bottom: space.xs,
        left: space.hair, right: space.hair, borderRadius: radius.control, backgroundColor: colors.tabHoverInset, opacity: wash }} />
      {focused && <View pointerEvents="none" style={{ position: 'absolute', top: space.xs, bottom: space.xs,
        left: space.hair, right: space.hair, borderRadius: radius.control, borderWidth: geometry.focusRing, borderColor: colors.focusRing }} />}
      <ContextMenu onOpen={() => { actions.closeHoverCard(); void actions.tabMenu(tab.id); }} style={{ flex: 1 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={label}
          focusable {...handlers}
          keyDownEvents={[{ key: 'Enter' }, { key: ' ' }]} onKeyDown={e => {
            if (e.nativeEvent.key === 'Enter' || e.nativeEvent.key === ' ') void actions.activateTab(tab.id);
          }}
          // Like a folder tab: it comes forward as soon as it is pressed.
          onPressIn={() => { actions.closeHoverCard(); if (!active) void actions.activateTab(tab.id); }}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: icon ? 'center' : 'flex-start',
            paddingLeft: icon ? 0 : space.md, paddingRight: icon ? 0 : geometry.control + (sound ? geometry.control - space.sm : 0) }}>
          <View style={{ width: geometry.favicon, height: geometry.favicon, alignItems: 'center', justifyContent: 'center' }}>
            <Favicon tab={tab} busy={tab.loading && !active} badges />
          </View>
          {/* Wider than the tab, so the fade, not the text layout, ends the title (which otherwise stopped a letter short). */}
          {!icon && <Fade style={{ flex: 1 }}>
            <Text lines={1} ellipsizeMode="clip" style={{ width: geometry.titleRun }}
              tone={active ? 'tabTextActive' : tab.discarded ? 'textTertiary' : 'tabText'} weight={active ? 'medium' : undefined}>{title}</Text>
          </Fade>}
        </Pressable>
      </ContextMenu>
      {!icon && <View style={{ position: 'absolute', right: space.xs, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center' }}>
        {sound && <IconButton label={tab.muted ? `Unmute ${title}` : `Mute ${title}`} tip={tab.muted ? 'Unmute tab' : 'Mute tab'}
          icon={tab.muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} size="small" tone="iconSecondary"
          onPress={() => void actions.muteTab(tab.id, !tab.muted)} />}
        {(hovered || active) && <IconButton label={`Close ${title}`} tip="Close tab" keys={['⌘', 'W']} icon="xmark" size="small"
          onPress={() => { actions.closeHoverCard(); void actions.closeTab(tab.id); }} />}
      </View>}
      {/* An icon-only tab (pinned, or crowded) shows its sound as a small badge you can press. */}
      {icon && sound && <View style={{ position: 'absolute', right: -space.xs, top: -space.hair }}>
        <IconButton label={tab.muted ? `Unmute ${title}` : `Mute ${title}`} tip={tab.muted ? 'Unmute tab' : 'Mute tab'}
          icon={tab.muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} size="small" tone="iconSecondary"
          onPress={() => void actions.muteTab(tab.id, !tab.muted)} />
      </View>}
    </Animated.View>
  </Animated.View>;
  // Always in a scope, so a tab becoming active or not keeps its views.
  return <PaletteScope roles={roles}>{body}</PaletteScope>;
});

type StripSplitProps = {
  tabs: Tab[]; slot: Slot; activeId: string | null; icon: boolean; pinned: boolean; dragging: boolean;
  /** The side pulled out of the tabs, which fades until it lands. */
  liftedId: string | null;
  roles: Partial<Palette> | null;
  handlers(tabId: string): DragHandlers;
};

/**
 * A split view's tabs as one piece, as in Ardia: the split symbol, then each
 * side's icon and title with a hairline between them, on a soft pill of its
 * own so the pair reads as one. When either side is the active tab the
 * joined shape runs under both, and the focused side's title is the
 * stronger. Press a side to focus it; drag either to move the split; pull
 * one down onto the page to take it out of the split.
 */
const StripSplit = React.memo(function StripSplit({ tabs, slot, activeId, icon, pinned, dragging, liftedId, roles, handlers }: StripSplitProps) {
  const { colors, reduceMotion } = useTheme();
  const { x, width } = useSlide(slot, reduceMotion, dragging);
  const active = tabs.some(t => t.id === activeId);
  const body = <Animated.View
    style={{ position: 'absolute', top: tabTop, left: x, width, height: geometry.joinedTab, zIndex: dragging ? 2 : undefined }}>
    {!active && !pinned && <View pointerEvents="none" style={{ position: 'absolute', top: space.xs, bottom: space.xs, left: space.hair,
      right: space.hair, borderRadius: radius.field, backgroundColor: colors.splitChip }} />}
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {tabs.map((tab, i) => <SplitSide key={tab.id} tab={tab} first={i === 0} focused={tab.id === activeId} inActive={active}
        icon={icon} lifted={tab.id === liftedId} {...handlers(tab.id)} />)}
    </View>
  </Animated.View>;
  return <PaletteScope roles={roles}>{body}</PaletteScope>;
});

function SplitSide({ tab, first, focused, inActive, icon, lifted, onDrag, onDrop }: DragHandlers & {
  tab: Tab; first: boolean; focused: boolean; inActive: boolean; icon: boolean; lifted: boolean;
}) {
  const actions = useActions();
  const { colors, reduceMotion } = useTheme();
  const { focused: keyFocus, handlers } = useInteraction();
  const [hovered, setHovered] = useState(false);
  const there = usePresence(!lifted, 'fade', reduceMotion);
  const pan = useTabPan({ onDrag, onDrop });
  const title = tabTitle(tab);
  const closing = !icon && hovered;
  return <Animated.View {...pan.panHandlers} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    style={{ flex: 1, opacity: there.progress }}>
    {(keyFocus || (!focused && hovered)) && <View pointerEvents="none" style={{ position: 'absolute', top: space.xs, bottom: space.xs,
      left: space.hair, right: space.hair, borderRadius: radius.control, backgroundColor: colors[focused ? 'fillTransparent' : 'tabHoverInset'],
      borderWidth: geometry.focusRing, borderColor: colors[keyFocus ? 'focusRing' : 'fillTransparent'] }} />}
    {!first && <View pointerEvents="none" style={{ position: 'absolute', left: -gap, top: (geometry.joinedTab - geometry.iconSmall) / 2,
      width: geometry.hairline, height: geometry.iconSmall, backgroundColor: colors.tabDivider }} />}
    <ContextMenu onOpen={() => void actions.tabMenu(tab.id)} style={{ flex: 1 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: focused }}
        accessibilityLabel={`Split view: ${title}${tab.loading ? ', loading' : ''}${tab.audible ? ', playing audio' : ''}`}
        focusable {...handlers}
        keyDownEvents={[{ key: 'Enter' }, { key: ' ' }]} onKeyDown={e => {
          if (e.nativeEvent.key === 'Enter' || e.nativeEvent.key === ' ') void actions.activateTab(tab.id);
        }}
        onPressIn={() => { if (!focused) void actions.activateTab(tab.id); }}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: icon ? 'center' : 'flex-start',
          paddingLeft: icon ? 0 : first ? space.md : space.sm, paddingRight: icon ? 0 : closing ? geometry.control : space.sm }}>
        {first && !icon && <Icon name="rectangle.split.2x1" size="small" tone="iconSecondary" />}
        <View style={{ width: geometry.favicon, height: geometry.favicon, alignItems: 'center', justifyContent: 'center' }}>
          <Favicon tab={tab} busy={tab.loading && !focused} badges />
        </View>
        {!icon && <Fade style={{ flex: 1 }}>
          <Text lines={1} ellipsizeMode="clip" style={{ width: geometry.titleRun }} tone={focused ? 'tabTextActive' : inActive ? 'textSecondary' : 'tabText'}
            weight={focused ? 'medium' : undefined}>{title}</Text>
        </Fade>}
      </Pressable>
    </ContextMenu>
    {closing && <View style={{ position: 'absolute', right: space.xs, top: 0, bottom: 0, justifyContent: 'center' }}>
      <IconButton label={`Close ${title}`} icon="xmark" size="small" onPress={() => void actions.closeTab(tab.id)} />
    </View>}
  </Animated.View>;
}

/** "+N": the tabs that no longer fit, as a native menu. */
function OverflowButton({ x, count, onPress }: { x: number; count: number; onPress(): void }) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = useInteraction();
  return <View style={{ position: 'absolute', left: x, top: tabTop, height: geometry.joinedTab, justifyContent: 'center' }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${count} more tabs`} onPress={onPress} {...handlers}
      style={{ width: geometry.overflowButton - space.xs, height: geometry.control, borderRadius: radius.control, flexDirection: 'row',
        alignItems: 'center', justifyContent: 'center', gap: space.hair, backgroundColor: colors[hovered ? 'tabHoverInset' : 'fillTransparent'],
        borderWidth: geometry.focusRing, borderColor: colors[focused ? 'focusRing' : 'fillTransparent'] }}>
      <Text variant="label" tone="tabText">{`+${count}`}</Text>
      <Icon name="chevron.down" tone="iconSecondary" size="tiny" />
    </Pressable>
  </View>;
}

/** New Tab after the last tab; it glides with the tabs as they open and close, rather than jumping ahead of them. */
function PlusButton({ x, onPress }: { x: number; onPress(): void }) {
  const { reduceMotion } = useTheme();
  const slide = useSlide({ x, width: 0 }, reduceMotion);
  return <Animated.View style={{ position: 'absolute', left: slide.x, top: tabTop, height: geometry.joinedTab, justifyContent: 'center' }}>
    <IconButton label="New tab" icon="plus" onPress={onPress} />
  </Animated.View>;
}
