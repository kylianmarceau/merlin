// Where the tabs across the top go: plain arithmetic over the tabs, groups
// and the room there is, tested without a window. Every tab takes one
// cell; a split view's tabs are one item of two cells, side by side, that
// shows and moves as one, as in Ardia.
import type { Tab, TabGroup } from '../../state/types';
import { tabUnits } from '../../state/splits';

export type Slot = { x: number; width: number };
/** A group's chip at `x`, and where its shown tabs end. */
export type Chip = { group: TabGroup; x: number; width: number; end: number };
/** One tab, or the tabs of a split view, which show and move as one. */
export type StripItem = { key: string; tabs: Tab[]; pinned: boolean };
export type StripMetrics = {
  /** A tab's widest, narrowest with a title, and its width as an icon. */
  tab: number; tabMin: number; icon: number;
  /** Between cells; between the pinned tabs and the rest. */
  gap: number; pinnedGap: number;
  /** The "+N" button, and the room kept after the tabs for the New Tab button. */
  overflow: number; trailing: number;
  chipWidth(group: TabGroup): number;
};
export type StripLayout = {
  /** Each shown tab's cell. */
  slots: Record<string, Slot>;
  chips: Chip[];
  /** The shown items in order: pinned ones, then the rest. */
  pinned: StripItem[]; open: StripItem[];
  /** Tabs too narrow to show titles. */
  compact: boolean;
  /** Tabs that don't fit, behind the "+N" menu. */
  hidden: string[];
  end: number; pinnedEnd: number;
};

/** The tabs as items: a split view's tabs together, every other tab alone. */
export function stripItems(tabs: Tab[]): StripItem[] {
  return tabUnits(tabs).map(unit => ({ key: unit.length > 1 ? `split:${unit[0].split}` : unit[0].id, tabs: unit, pinned: unit[0].pinned }));
}

/** An item's place: from its first cell to the end of its last. */
export function itemSlot(item: StripItem, slots: Record<string, Slot>): Slot | null {
  const first = slots[item.tabs[0].id];
  const last = slots[item.tabs[item.tabs.length - 1].id];
  return first && last ? { x: first.x, width: last.x + last.width - first.x } : null;
}

/**
 * Where each tab sits in a lane `room` wide: pinned tabs as icons, then the
 * rest sharing the width, each group led by its chip. A collapsed group
 * shows only its chip (and the item with the active tab). Past the point
 * where even icons don't fit, the items that don't go behind "+N", always
 * keeping the active one. `without` leaves an item out, as when it has been
 * dragged out of the tabs, so the others close up.
 */
export function layoutStrip(tabs: Tab[], groups: TabGroup[], activeId: string | null, room: number, m: StripMetrics,
  without: string | null = null): StripLayout {
  const slots: Record<string, Slot> = {};
  const chips: Chip[] = [];
  const items = stripItems(tabs).filter(item => item.key !== without);
  const pinned = items.filter(i => i.pinned);
  const open = items.filter(i => !i.pinned);
  let cursor = 0;
  for (const item of pinned) for (const t of item.tabs) { slots[t.id] = { x: cursor, width: m.icon }; cursor += m.icon + m.gap; }
  const pinnedEnd = cursor ? cursor - m.gap : 0;
  const start = pinnedEnd ? pinnedEnd + m.pinnedGap : 0;
  const byId = new Map(groups.map(g => [g.id, g]));
  const groupOf = (item: StripItem) => (item.tabs[0].group && byId.get(item.tabs[0].group)) || null;
  const holdsActive = (item: StripItem) => item.tabs.some(t => t.id === activeId);
  const visible = open.filter(i => !groupOf(i)?.collapsed || holdsActive(i));
  const cells = (list: StripItem[]) => list.reduce((n, i) => n + i.tabs.length, 0);
  const leading = [...new Set(open.map(groupOf).filter((g): g is TabGroup => !!g))];
  const chipRoom = leading.reduce((sum, g) => sum + m.chipWidth(g) + m.gap, 0);
  const available = Math.max(0, room - start - chipRoom - m.trailing);
  const count = cells(visible);
  let shown = visible;
  let width = count ? Math.floor((available - m.gap * (count - 1)) / count) : m.tab;
  if (count > 1 && width < m.icon) {
    // Too many to show even as icons: keep as many as fit, always with the active one.
    const fit = Math.max(1, Math.floor((available - m.overflow + m.gap) / (m.icon + m.gap)));
    shown = leadingRun(visible, fit, visible.find(holdsActive) ?? null);
    const n = Math.max(1, cells(shown));
    width = Math.floor((available - m.overflow - m.gap * (n - 1)) / n);
  }
  width = Math.max(Math.min(m.tab, width), Math.min(m.icon, available));
  const showing = new Set(shown);
  cursor = start;
  let chip = null as Chip | null;
  for (const item of open) {
    const group = groupOf(item);
    if (group && group !== chip?.group) {
      chip = { group, x: cursor, width: m.chipWidth(group), end: cursor + m.chipWidth(group) };
      chips.push(chip);
      cursor += chip.width + m.gap;
    } else if (!group) chip = null;
    if (!showing.has(item)) continue;
    for (const t of item.tabs) { slots[t.id] = { x: cursor, width }; cursor += width + m.gap; }
    if (chip) chip.end = cursor - m.gap;
  }
  const end = cursor > start ? cursor - m.gap : start;
  return {
    slots, chips, pinned, open: open.filter(i => showing.has(i)), compact: width < m.tabMin, end, pinnedEnd,
    hidden: visible.filter(i => !showing.has(i)).flatMap(i => i.tabs.map(t => t.id)),
  };
}

/**
 * The items that fit in `fit` cells: the active one, and as many of the
 * others as fit, first ones first, in their order. Nothing after an item
 * that doesn't fit is shown, so the order never skips.
 */
function leadingRun(visible: StripItem[], fit: number, active: StripItem | null) {
  const room = fit - (active ? active.tabs.length : 0);
  const run: StripItem[] = [];
  let used = 0;
  for (const item of visible) {
    if (item === active) continue;
    if (used + item.tabs.length > room) break;
    used += item.tabs.length;
    run.push(item);
  }
  if (!active) return run;
  const at = visible.indexOf(active);
  const before = run.filter(i => visible.indexOf(i) < at);
  return [...before, active, ...run.filter(i => visible.indexOf(i) > at)];
}

/**
 * Where a dragged item lands among the other items of its lane after moving
 * `dx`: the number of them it goes after. It moves a cell at a time, and
 * only ever between items, never into a split.
 */
export function dropPlace(lane: StripItem[], slots: Record<string, Slot>, key: string, dx: number, gap: number): number {
  const from = lane.findIndex(i => i.key === key);
  const first = from >= 0 ? slots[lane[from].tabs[0].id] : undefined;
  if (from < 0 || !first) return -1;
  const before = lane.slice(0, from).reduce((n, i) => n + i.tabs.length, 0);
  const wanted = before + dx / (first.width + gap);
  const others = lane.filter(i => i.key !== key);
  let best = 0, bestDistance = Infinity, at = 0;
  for (let place = 0; place <= others.length; place++) {
    const distance = Math.abs(at - wanted);
    if (distance < bestDistance) { best = place; bestDistance = distance; }
    at += others[place]?.tabs.length ?? 0;
  }
  return best;
}

/** The lane's cells with the dragged item at `place` and the others closing up around it. */
export function reflow(lane: StripItem[], slots: Record<string, Slot>, key: string, place: number): Record<string, Slot> {
  const dragged = lane.find(i => i.key === key);
  if (!dragged || place < 0) return slots;
  const cells = lane.flatMap(i => i.tabs.map(t => slots[t.id]));
  if (cells.some(c => !c)) return slots;
  const order = lane.filter(i => i !== dragged);
  order.splice(place, 0, dragged);
  const next = { ...slots };
  order.flatMap(i => i.tabs).forEach((t, n) => { next[t.id] = cells[n]; });
  return next;
}

/** The tab a dragged item dropped at `place` goes before (null: the end), as Chromium's order counts it. */
export function dropBefore(tabs: Tab[], lane: StripItem[], key: string, place: number): string | null {
  const dragged = lane.find(i => i.key === key);
  if (!dragged) return null;
  const others = lane.filter(i => i !== dragged);
  const next = others[place];
  if (next) return next.tabs[0].id;
  // Last in its lane: before whatever follows the lane.
  const moving = new Set(dragged.tabs.map(t => t.id));
  const rest = tabs.filter(t => !moving.has(t.id));
  const last = others[others.length - 1]?.tabs.at(-1);
  const at = last ? rest.findIndex(t => t.id === last.id) : -1;
  return at >= 0 ? rest[at + 1]?.id ?? null : null;
}
