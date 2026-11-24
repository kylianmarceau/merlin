import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Tab, TabGroup } from '../../state/types';
import { geometry } from '../ui/tokens';
import { dropBefore, dropPlace, itemSlot, layoutStrip, reflow, stripItems, type StripMetrics } from './stripLayout';

const m: StripMetrics = {
  tab: geometry.stripTab, floor: geometry.stripTabFloor, active: geometry.stripTabActive,
  icon: geometry.stripTabIcon, gap: geometry.stripGap, pinGap: geometry.stripPinGap, dockGap: geometry.stripDockGap,
  trailing: geometry.control + geometry.stripGap, chipWidth: () => geometry.groupChip,
};
const tab = (id: string, extra: Partial<Tab> = {}): Tab => ({ id, title: id, url: `https://${id}.test/`, loading: false, pinned: false,
  audible: false, canGoBack: false, canGoForward: false, ...extra });

test("a split view's tabs are one item; other tabs are items of their own", () => {
  const items = stripItems([tab('p', { pinned: true }), tab('a'), tab('b', { split: 's' }), tab('c', { split: 's' }), tab('d')]);
  assert.deepEqual(items.map(i => i.key), ['p', 'a', 'split:s', 'd']);
  assert.deepEqual(items[2].tabs.map(t => t.id), ['b', 'c']);
  // Two splits side by side stay apart.
  assert.deepEqual(stripItems([tab('a', { split: 's' }), tab('b', { split: 's' }), tab('c', { split: 't' }), tab('d', { split: 't' })])
    .map(i => i.key), ['split:s', 'split:t']);
});

test('a split takes two cells, side by side, and the item spans both', () => {
  const tabs = [tab('a'), tab('b', { split: 's' }), tab('c', { split: 's' })];
  const layout = layoutStrip(tabs, [], 'a', 1000, m);
  assert.equal(layout.slots.b.width, m.tab);
  assert.equal(layout.slots.c.x, layout.slots.b.x + m.tab + m.gap);
  assert.deepEqual(itemSlot(layout.open[1], layout.slots), { x: layout.slots.b.x, width: m.tab * 2 + m.gap });
  // Crowded, the cells of tabs that aren't active share the room evenly.
  const crowded = layoutStrip(tabs, [], 'x', 270, m);
  assert.equal(crowded.slots.a.width, crowded.slots.b.width);
  assert.ok(crowded.slots.a.width < geometry.stripTabTitleMin);
});

test('leaving an item out closes the others up', () => {
  const tabs = [tab('a'), tab('b'), tab('c')];
  const full = layoutStrip(tabs, [], 'a', 1000, m);
  const lifted = layoutStrip(tabs, [], 'a', 1000, m, 'b');
  assert.equal(lifted.slots.b, undefined);
  assert.equal(lifted.slots.c.x, full.slots.b.x);
});

test('crowded, the active tab keeps a wider minimum than the others, which stop at theirs and scroll', () => {
  const few = [tab('a'), tab('b'), tab('c'), tab('d')];
  const roomy = layoutStrip(few, [], 'b', 1000, m);
  assert.deepEqual(Object.values(roomy.slots).map(s => s.width), [173, 173, 173, 173]);
  assert.equal(roomy.scrolls, false);
  // The active cell keeps its minimum, the other three share what remains.
  const tight = layoutStrip(few, [], 'b', 440, m);
  assert.equal(tight.slots.b.width, m.active);
  assert.equal(tight.slots.a.width, Math.floor((440 - m.trailing - m.active - 3 * m.gap) / 3));
  assert.equal(tight.scrolls, false);
  const many = Array.from({ length: 30 }, (_, i) => tab(`t${i}`));
  const layout = layoutStrip(many, [], 't25', 400, m);
  assert.equal(layout.open.length, 30);
  assert.equal(layout.slots.t0.width, m.floor);
  assert.equal(layout.slots.t25.width, m.active);
  assert.ok(layout.scrolls && layout.end > layout.lane);
});

test('after a close, held widths stay as they were until released', () => {
  const tabs = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => tab(id));
  const before = layoutStrip(tabs, [], 'a', 600, m);
  const closed = tabs.filter(t => t.id !== 'c');
  const held = layoutStrip(closed, [], 'a', 600, m, null, before.cells);
  assert.equal(held.slots.d.width, before.slots.d.width);
  assert.equal(held.slots.d.x, before.slots.c.x);
  assert.equal(held.slots.a.width, before.slots.a.width);
  const released = layoutStrip(closed, [], 'a', 600, m);
  assert.ok(released.slots.d.width > before.slots.d.width);
});

test("a collapsed group shows its chip, and only the item with the active tab", () => {
  const group: TabGroup = { id: 'g', title: '', color: 'blue', collapsed: true };
  const tabs = [tab('a', { group: 'g' }), tab('b', { group: 'g', split: 's' }), tab('c', { group: 'g', split: 's' }), tab('d')];
  const layout = layoutStrip(tabs, [group], 'c', 1000, m);
  assert.equal(layout.slots.a, undefined);
  assert.ok(layout.slots.b && layout.slots.c);
  assert.equal(layout.chips.length, 1);
});

test('a dragged item moves a cell at a time, between items only, and its drop names the tab it goes before', () => {
  const tabs = [tab('a'), tab('b', { split: 's' }), tab('c', { split: 's' }), tab('d'), tab('e')];
  const layout = layoutStrip(tabs, [], 'a', 2000, m);
  const lane = layout.open;
  const step = m.tab + m.gap;
  // "a" pulled one cell right would land inside the split: it goes after the split or stays.
  assert.equal(dropPlace(lane, layout.slots, 'a', step * 0.4, m.gap), 0);
  assert.equal(dropPlace(lane, layout.slots, 'a', step * 1.6, m.gap), 1);
  assert.equal(dropBefore(tabs, lane, 'a', 1), 'd');
  // The split moves as one.
  assert.equal(dropPlace(lane, layout.slots, 'split:s', step * 2, m.gap), 3);
  assert.equal(dropBefore(tabs, lane, 'split:s', 3), null);
  assert.equal(dropPlace(lane, layout.slots, 'split:s', -step, m.gap), 0);
  assert.equal(dropBefore(tabs, lane, 'split:s', 0), 'a');
  // The others close up around it.
  const moved = reflow(lane, layout.slots, 'split:s', 0);
  assert.equal(moved.b.x, layout.slots.a.x);
  assert.equal(moved.c.x, layout.slots.b.x);
  assert.equal(moved.a.x, layout.slots.c.x);
});

test('dropped last among the pinned tabs, a tab goes before the first of the others', () => {
  const tabs = [tab('p', { pinned: true }), tab('q', { pinned: true }), tab('a')];
  const layout = layoutStrip(tabs, [], 'a', 1000, m);
  assert.equal(dropPlace(layout.pinned, layout.slots, 'p', m.icon + m.pinGap, m.pinGap), 1);
  assert.equal(dropBefore(tabs, layout.pinned, 'p', 1), 'a');
});

test('the dock uses even pin spacing and the strip ends at its edge when only pins remain', () => {
  const pins = [tab('p', { pinned: true }), tab('q', { pinned: true, split: 's' }), tab('r', { pinned: true, split: 's' })];
  const dock = layoutStrip(pins, [], 'q', 500, m);
  const step = m.icon + m.pinGap;
  assert.deepEqual(Object.values(dock.slots).map(slot => slot.x), [0, step, step * 2]);
  assert.deepEqual(itemSlot(dock.pinned[1], dock.slots), { x: step, width: m.icon * 2 + m.pinGap });
  assert.equal(dock.pinnedEnd, m.icon + step * 2);
  assert.equal(dock.end, dock.pinnedEnd);
  const withOpen = layoutStrip([...pins, tab('a')], [], 'a', 500, m);
  assert.equal(withOpen.slots.a.x, dock.pinnedEnd + m.dockGap);
});

test('a dock that fills the lane cannot collapse the only open tab', () => {
  const pins = Array.from({ length: 12 }, (_, i) => tab(`p${i}`, { pinned: true }));
  const layout = layoutStrip([...pins, tab('a')], [], 'a', 400, m);
  assert.equal(layout.slots.a.width, m.active);
  assert.equal(layout.end, layout.slots.a.x + layout.slots.a.width);
  assert.equal(layout.scrolls, true);
});
