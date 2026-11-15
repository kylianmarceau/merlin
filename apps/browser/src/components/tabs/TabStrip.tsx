import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import type { Tab, TabGroup } from '../../state/types';
import { useActions, useSnapshot } from '../../state/window';
import {
  ContextMenu, DragRegion, Fade, Icon, IconButton, PaletteScope, Text, duration, geometry, radius, space, useColorFade,
  groupColorRoles, opacity, useInteraction, useSlide, useTheme, useTimeout, type Palette,
} from '../ui';
import { StripGroupChip, chipWidth } from './TabGroups';
import { Favicon } from '../favicon/Favicon';
import { useSiteChrome } from './siteChrome';
import { DownloadsButton, LibraryButtons } from './WindowButtons';

// Tabs sit on the bottom of the strip, so the active one can join the toolbar.
const tabTop = geometry.strip - geometry.joinedTab;
const gap = geometry.hairline;
const pinnedGap = space.sm;

type Slot = { x: number; width: number };
/** A group's chip at `x`, and where its shown tabs end. */
type Chip = { group: TabGroup; x: number; width: number; end: number };
type Drag = { id: string; dx: number; released: boolean };

/**
 * Tabs across the top of the window, on the tinted shell beside the traffic
 * lights. The active tab grows out of the toolbar like the tab of a folder,
 * in the colour of the site; it slides to whichever tab becomes active.
 * Pinned tabs are icons in a soft group; the others share the width, drop
 * their titles when crowded, and past that collect behind a "+N" menu.
 * Drag a tab to reorder it, onto the page to split it beside the current
 * tab, or out of the window to give it a window of its own. Empty space
 * moves the window.
 */
export function TabStrip() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const { colors } = useTheme();
  const chrome = useSiteChrome();
  const [room, setRoom] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const activeId = snapshot.activeTabId;
  const pinned = snapshot.tabs.filter(t => t.pinned);
  const open = snapshot.tabs.filter(t => !t.pinned);
  const layout = useMemo(() => layoutTabs(pinned, open, snapshot.groups ?? [], activeId, room),
    [snapshot.tabs, snapshot.groups, activeId, room]);  // eslint-disable-line react-hooks/exhaustive-deps
  const shownOpen = open.filter(t => layout.slots[t.id]);

  // A dropped tab keeps its new place until Chromium reports the new order.
  const order = snapshot.tabs.map(t => t.id).join(' ');
  useEffect(() => { setDrag(current => (current?.released ? null : current)); }, [order]);
  useTimeout(() => { if (drag?.released) setDrag(null); }, duration.dropSettle, [drag?.released]);

  const dragGroup = drag ? (snapshot.tabs.find(t => t.id === drag.id)?.pinned ? pinned : shownOpen) : [];
  const target = drag ? dropIndex(dragGroup, layout.slots, drag) : -1;
  const slots = drag ? reorderedSlots(dragGroup, layout.slots, drag, target) : layout.slots;
  // The joined shape follows the active tab while it is dragged, then settles into its new place.
  const held = drag && !drag.released && drag.id === activeId && layout.slots[drag.id];
  const activeSlot = held ? { ...held, x: held.x + drag.dx } : activeId ? slots[activeId] ?? null : null;

  // Pulled down past the strip (or out of the window) a tab leaves the strip
  // for the page: it splits or becomes a window. Its slot waits in place.
  const dragTo = (id: string, dx: number, x: number, y: number) => {
    const out = actions.tabDragMove(id, x, y, y > geometry.strip + geometry.tearOff);
    setDrag({ id, dx: out ? 0 : dx, released: false });
  };
  const release = (id: string, dx: number, cancelled: boolean) => {
    if (cancelled) actions.tabDragCancel();
    else if (actions.tabDragEnd()) { setDrag(null); return; }
    drop(id, dx);
  };

  const drop = (id: string, dx: number) => {
    const current = { id, dx, released: true };
    const group = snapshot.tabs.find(t => t.id === id)?.pinned ? pinned : shownOpen;
    const to = dropIndex(group, layout.slots, current);
    const from = group.findIndex(t => t.id === id);
    if (to < 0 || to === from) { setDrag(null); return; }
    setDrag(current);
    const ids = group.map(t => t.id).filter(other => other !== id);
    ids.splice(to, 0, id);
    let beforeId: string | null = ids[to + 1] ?? null;
    if (!beforeId) {
      // Dropped last in its group: before whatever follows the group.
      const all = snapshot.tabs.filter(t => t.id !== id);
      const last = all.findIndex(t => t.id === ids[to - 1]);
      beforeId = all[last + 1]?.id ?? null;
    }
    void actions.moveTab(id, beforeId);
  };

  const plusX = layout.end + (layout.hidden.length ? geometry.overflowButton : 0) + space.xs;
  return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: geometry.strip, flexDirection: 'row',
    paddingLeft: geometry.sidebarCollapsedInset, paddingRight: space.sm + space.hair }}>
    <DragRegion style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    {snapshot.private && <View style={{ height: geometry.strip, justifyContent: 'center', marginRight: space.sm }}>
      <Icon name="eye.slash" tone="iconSecondary" size="small" />
    </View>}
    <View style={{ flex: 1, height: geometry.strip }} pointerEvents="box-none" onLayout={e => setRoom(e.nativeEvent.layout.width)}>
      {room > 0 && <>
        {!!pinned.length && <View pointerEvents="none" style={{ position: 'absolute', left: -space.hair, width: layout.pinnedEnd + space.xs,
          top: tabTop + space.xs, height: geometry.joinedTab - space.sm, borderRadius: radius.field, backgroundColor: colors.fillShellGroup }} />}
        {!drag && layout.chips.map(chip => chip.end > chip.x + chip.width &&
          <View key={`wash:${chip.group.id}`} pointerEvents="none" style={{ position: 'absolute', left: chip.x - space.hair,
            width: chip.end - chip.x + space.hair * 2, top: tabTop + space.xs, height: geometry.joinedTab - space.sm,
            borderRadius: radius.field, backgroundColor: colors[groupColorRoles[chip.group.color]], opacity: opacity.groupWash }} />)}
        {layout.chips.map(chip => <StripGroupChip key={`chip:${chip.group.id}`} group={chip.group} x={chip.x} width={chip.width}
          top={tabTop} height={geometry.joinedTab} />)}
        <JoinedShape slot={activeSlot} color={chrome.bar} following={!!drag && !drag.released && drag.id === activeId} />
        {snapshot.tabs.map(tab => {
          const slot = slots[tab.id];
          if (!slot) return null;
          const active = tab.id === activeId;
          const group = tab.pinned ? pinned : shownOpen;
          const index = group.findIndex(t => t.id === tab.id);
          const previous = index > 0 ? group[index - 1] : undefined;
          const quiet = (t: Tab | undefined) => !!t && t.id !== activeId && t.id !== hoveredId;
          const dragging = drag?.id === tab.id && !drag.released;
          return <StripTab key={tab.id} tab={tab} slot={dragging ? { ...layout.slots[tab.id], x: layout.slots[tab.id].x + drag.dx } : slot}
            active={active} icon={tab.pinned || layout.compact} roles={active ? chrome.roles : null}
            divider={!tab.pinned && !drag && quiet(previous) && quiet(tab)} dragging={dragging}
            onHover={on => setHoveredId(current => (on ? tab.id : current === tab.id ? null : current))}
            onDrag={(dx, x, y) => dragTo(tab.id, dx, x, y)} onDrop={(dx, cancelled) => release(tab.id, dx, cancelled)} />;
        })}
        {!!layout.hidden.length && <OverflowButton x={layout.end + space.xs} count={layout.hidden.length}
          onPress={() => void actions.hiddenTabsMenu(layout.hidden)} />}
        <View style={{ position: 'absolute', left: plusX, top: tabTop, height: geometry.joinedTab, justifyContent: 'center' }}>
          <IconButton label="New tab" icon="plus" onPress={() => void actions.openNewTab()} />
        </View>
      </>}
    </View>
    <View style={{ height: geometry.strip, flexDirection: 'row', alignItems: 'center', gap: space.hair }}>
      <LibraryButtons />
      {/* Last, so its popover hangs at the window's right edge, as in Ardia. */}
      <DownloadsButton />
    </View>
  </View>;
}

/**
 * Where each tab sits in a lane `room` wide: pinned tabs as icons, then the
 * rest sharing the width, each group led by its chip. A collapsed group
 * shows only its chip.
 */
function layoutTabs(pinned: Tab[], open: Tab[], groups: TabGroup[], activeId: string | null, room: number) {
  const slots: Record<string, Slot> = {};
  const chips: Chip[] = [];
  const icon = geometry.stripTabIcon;
  pinned.forEach((t, i) => { slots[t.id] = { x: i * (icon + gap), width: icon }; });
  const pinnedEnd = pinned.length ? pinned.length * (icon + gap) - gap : 0;
  const start = pinned.length ? pinnedEnd + pinnedGap : 0;
  const byId = new Map(groups.map(g => [g.id, g]));
  const groupOf = (t: Tab) => (t.group && byId.get(t.group)) || null;
  const visible = open.filter(t => !groupOf(t)?.collapsed || t.id === activeId);
  const leading = [...new Set(open.map(groupOf).filter((g): g is TabGroup => !!g))];
  const chipRoom = leading.reduce((sum, g) => sum + chipWidth(g) + gap, 0);
  const available = Math.max(0, room - start - chipRoom - geometry.control - space.xs);
  let shown = visible;
  let width = visible.length ? Math.floor((available - gap * (visible.length - 1)) / visible.length) : geometry.stripTab;
  if (visible.length > 1 && width < icon) {
    // Too many to show even as icons: keep as many as fit, always with the active one.
    const fit = Math.max(1, Math.floor((available - geometry.overflowButton + gap) / (icon + gap)));
    const activeIndex = visible.findIndex(t => t.id === activeId);
    shown = activeIndex >= fit ? [...visible.slice(0, fit - 1), visible[activeIndex]] : visible.slice(0, fit);
    width = Math.floor((available - geometry.overflowButton - gap * (shown.length - 1)) / shown.length);
  }
  width = Math.max(Math.min(geometry.stripTab, width), Math.min(icon, available));
  const showing = new Set(shown.map(t => t.id));
  let cursor = start;
  let chip = null as Chip | null;
  for (const t of open) {
    const group = groupOf(t);
    if (group && group !== chip?.group) {
      chip = { group, x: cursor, width: chipWidth(group), end: cursor + chipWidth(group) };
      chips.push(chip);
      cursor += chip.width + gap;
    } else if (!group) chip = null;
    if (!showing.has(t.id)) continue;
    slots[t.id] = { x: cursor, width };
    cursor += width + gap;
    if (chip) chip.end = cursor - gap;
  }
  const end = cursor > start ? cursor - gap : start;
  return { slots, chips, compact: width < geometry.stripTabMin, hidden: visible.filter(t => !showing.has(t.id)).map(t => t.id), end,
    pinnedEnd };
}

/** The place in its group a dragged tab would drop into. */
function dropIndex(group: Tab[], slots: Record<string, Slot>, drag: Drag) {
  const from = group.findIndex(t => t.id === drag.id);
  const slot = slots[drag.id];
  if (from < 0 || !slot || group.length < 2) return from;
  const step = slot.width + gap;
  return Math.max(0, Math.min(group.length - 1, Math.round(from + drag.dx / step)));
}

/** The group's slots with the dragged tab moved to `target` and the others closing up around it. */
function reorderedSlots(group: Tab[], slots: Record<string, Slot>, drag: Drag, target: number) {
  const ids = group.map(t => t.id);
  const from = ids.indexOf(drag.id);
  if (from < 0 || target < 0) return slots;
  const moved = ids.filter(id => id !== drag.id);
  moved.splice(target, 0, drag.id);
  const next = { ...slots };
  moved.forEach((id, i) => { next[id] = slots[ids[i]]; });
  return next;
}

/**
 * The active tab's outline, in the toolbar's colour, joined to the toolbar
 * with a concave ear at each bottom corner. Each ear is a ring clipped to a
 * square: the ring's inner edge is the curve, so nothing is drawn over the
 * translucent shell. It reaches a point below the strip to cover the card's
 * top edge, so tab and toolbar read as one piece.
 */
function JoinedShape({ slot, color, following }: { slot: Slot | null; color: string; following: boolean }) {
  const { reduceMotion } = useTheme();
  const { x, width } = useSlide(slot, reduceMotion, following);
  const fill = useColorFade(color, reduceMotion);
  if (!slot) return null;
  const ear = geometry.joinedEar;
  const ring = ear * 2;
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', top: tabTop, left: x, width,
    height: geometry.joinedTab + geometry.hairline }}>
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
  </Animated.View>;
}

type StripTabProps = {
  tab: Tab; slot: Slot; active: boolean; icon: boolean; divider: boolean; dragging: boolean;
  /** The site's colours, for the active tab, which sits on the joined shape. */
  roles: Partial<Palette> | null;
  onHover(on: boolean): void;
  /** The pointer moved `dx` along the strip, and is at (x, y) in the window. */
  onDrag(dx: number, x: number, y: number): void;
  onDrop(dx: number, cancelled: boolean): void;
};

const StripTab = React.memo(function StripTab({ tab, slot, active, icon, divider, dragging, roles, onHover, onDrag, onDrop }: StripTabProps) {
  const actions = useActions();
  const { colors, reduceMotion } = useTheme();
  const { focused, handlers } = useInteraction();
  const [hovered, setHovered] = useState(false);
  const { x, width } = useSlide(slot, reduceMotion, dragging);
  const title = isStartUrl(tab.url) ? 'New Tab' : tab.title || tab.url || 'New Tab';
  const hover = (on: boolean) => { setHovered(on); onHover(on); };
  // Latest callbacks for the responder, which is made once.
  const latest = useRef({ onDrag, onDrop });
  latest.current = { onDrag, onDrop };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => Math.hypot(g.dx, g.dy) > space.xs,
    onPanResponderMove: (_, g) => latest.current.onDrag(g.dx, g.moveX, g.moveY),
    onPanResponderRelease: (_, g) => latest.current.onDrop(g.dx, false),
    onPanResponderTerminate: (_, g) => latest.current.onDrop(g.dx, true),
    onPanResponderTerminationRequest: () => false,
  }), []);
  const label = `${tab.pinned ? 'Pinned: ' : ''}${title}${tab.loading ? ', loading' : ''}${tab.audible ? ', playing audio' : ''}`;
  const body = <Animated.View {...pan.panHandlers} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}
    style={{ position: 'absolute', top: tabTop, left: x, width, height: geometry.joinedTab, zIndex: dragging ? 2 : undefined }}>
    {divider && <View pointerEvents="none" style={{ position: 'absolute', left: -gap, top: (geometry.joinedTab - geometry.iconSmall) / 2,
      width: geometry.hairline, height: geometry.iconSmall, backgroundColor: colors.tabDivider }} />}
    {(focused || (!active && hovered)) && <View pointerEvents="none" style={{ position: 'absolute', top: space.xs, bottom: space.xs,
      left: space.hair, right: space.hair, borderRadius: radius.control, backgroundColor: colors[active ? 'fillTransparent' : 'tabHoverInset'],
      borderWidth: geometry.focusRing, borderColor: colors[focused ? 'focusRing' : 'fillTransparent'] }} />}
    <ContextMenu onOpen={() => void actions.tabMenu(tab.id)} style={{ flex: 1 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={label}
        focusable {...handlers}
        keyDownEvents={[{ key: 'Enter' }, { key: ' ' }]} onKeyDown={e => {
          if (e.nativeEvent.key === 'Enter' || e.nativeEvent.key === ' ') void actions.activateTab(tab.id);
        }}
        // Like a folder tab: it comes forward as soon as it is pressed.
        onPressIn={() => { if (!active) void actions.activateTab(tab.id); }}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: icon ? 'center' : 'flex-start',
          paddingLeft: icon ? 0 : space.md, paddingRight: icon ? 0 : geometry.control }}>
        <View style={{ width: geometry.favicon, height: geometry.favicon, alignItems: 'center', justifyContent: 'center' }}>
          <Favicon tab={tab} busy={tab.loading && !active} />
        </View>
        {!icon && <Fade style={{ flex: 1 }}>
          <Text lines={1} ellipsizeMode="clip" tone={active ? 'tabTextActive' : 'tabText'} weight={active ? 'medium' : undefined}>{title}</Text>
        </Fade>}
      </Pressable>
    </ContextMenu>
    {!icon && (hovered || active) && <View style={{ position: 'absolute', right: space.xs, top: 0, bottom: 0, justifyContent: 'center' }}>
      <IconButton label={`Close ${title}`} icon="xmark" size="small" onPress={() => void actions.closeTab(tab.id)} />
    </View>}
  </Animated.View>;
  // Always in a scope, so a tab becoming active or not keeps its views.
  return <PaletteScope roles={roles}>{body}</PaletteScope>;
});

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
