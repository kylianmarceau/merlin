import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropCandidates, dropOutcome, paneRects, rememberActive, reorderTarget, splitPartner, zoneHit, zoneRect } from './tabDrag';

const window = { width: 1000, height: 700 };
const page = { x: 260, y: 50, width: 730, height: 640 };

test('zones sit by each edge of the pane and grow; the one under the pointer leans towards it', () => {
  const left = zoneRect(page, 'left', 'grown');
  const right = zoneRect(page, 'right', 'grown');
  assert.ok(left.x > page.x && left.x + left.width < page.x + page.width / 2);
  assert.ok(right.x > page.x + page.width / 2 && right.x + right.width < page.x + page.width);
  assert.ok(zoneRect(page, 'left', 'rest').width < left.width);
  // Centred vertically.
  assert.equal(Math.round(left.y + left.height / 2), Math.round(page.y + page.height / 2));
  const toward = zoneRect(page, 'left', 'active', left.x + left.width + 100);
  assert.ok(toward.x > zoneRect(page, 'left', 'active', left.x + left.width / 2).x);
  // Never past the pane's edge.
  assert.ok(zoneRect(page, 'right', 'active', 5000).x + zoneRect(page, 'right', 'active', 5000).width <= page.x + page.width);
});

test('a zone is hit when the tab reaches it, and keeps the tab until it leaves', () => {
  const candidates: [string, typeof page][] = [['a', page]];
  const left = zoneRect(page, 'left', 'grown');
  const middle = page.y + page.height / 2;
  assert.deepEqual(zoneHit(candidates, left.x + left.width / 2, middle, null), { tabId: 'a', side: 'left' });
  assert.deepEqual(zoneHit(candidates, page.x + page.width - 40, middle, null), { tabId: 'a', side: 'right' });
  // The middle of a wide page and the top edge are not on a zone.
  assert.equal(zoneHit(candidates, page.x + page.width / 2, middle, null), null);
  assert.equal(zoneHit(candidates, left.x, page.y + 10, null), null);
  // Between two panes, each pane's own zones are told apart.
  const halves = paneRects(page, { tabs: ['a', 'b'], layout: 'sideBySide', ratio: 0.5 }, 'a', 6);
  const b = halves.b;
  assert.deepEqual(zoneHit(Object.entries(halves), b.x + 30, middle, null), { tabId: 'b', side: 'left' });
});

test('the panes are the tabs on screen; alone, the dragged tab offers its own pane for the tab used before it', () => {
  const halves = paneRects(page, { tabs: ['a', 'b'], layout: 'sideBySide', ratio: 0.4 }, 'b', 6);
  assert.equal(Math.round(halves.a.width + halves.b.width + 6), page.width);
  assert.ok(halves.a.width < halves.b.width);
  assert.equal(halves.b.x, halves.a.x + halves.a.width + 6);
  const stacked = paneRects(page, { tabs: ['a', 'b'], layout: 'stacked', ratio: 0.5 }, 'a', 6);
  assert.equal(stacked.b.y, stacked.a.y + stacked.a.height + 6);
  // A split the active tab isn't in is not on screen.
  assert.deepEqual(paneRects(page, { tabs: ['x', 'y'], layout: 'sideBySide', ratio: 0.5 }, 'a', 6), { a: page });
  assert.deepEqual(paneRects(page, null, null, 6), {});

  assert.deepEqual(dropCandidates(halves, 'c', 'a').map(([id]) => id), ['a', 'b']);
  assert.deepEqual(dropCandidates(halves, 'b', 'c'), [['a', halves.a]]);
  assert.deepEqual(dropCandidates({ b: page }, 'b', 'a'), [['a', page]]);
  assert.deepEqual(dropCandidates({ b: page }, 'b', null), []);
});

test('the partner is the tab used most recently before, else a neighbour', () => {
  assert.equal(splitPartner('b', ['a', 'b', 'c'], ['b', 'c', 'a']), 'c');
  // Closed tabs are skipped.
  assert.equal(splitPartner('b', ['a', 'b'], ['b', 'gone', 'a']), 'a');
  assert.equal(splitPartner('b', ['a', 'b', 'c'], []), 'a');
  assert.equal(splitPartner('a', ['a', 'b'], []), 'b');
  assert.equal(splitPartner('a', ['a'], ['a']), null);
});

test('recent tabs follow activation, forget closed tabs and keep their list when nothing changes', () => {
  let recent = rememberActive([], 'a', ['a', 'b']);
  recent = rememberActive(recent, 'b', ['a', 'b']);
  assert.deepEqual(recent, ['b', 'a']);
  assert.equal(rememberActive(recent, 'b', ['a', 'b']), recent);
  assert.deepEqual(rememberActive(recent, 'b', ['b']), ['b']);
  assert.deepEqual(rememberActive(recent, null, ['a']), ['a']);
});

test('letting go splits on a zone, leaves for a window elsewhere on the page, and does nothing over the controls', () => {
  const at = (x: number, y: number, target: { tabId: string; side: 'left' | 'right' } | null = null, canDetach = true) =>
    dropOutcome({ x, y, window, page, target, canDetach });
  assert.deepEqual(at(300, 300, { tabId: 'a', side: 'left' }), { kind: 'split', target: { tabId: 'a', side: 'left' } });
  assert.deepEqual(at(600, 300), { kind: 'window' });
  assert.deepEqual(at(-20, 300), { kind: 'window' });
  assert.equal(at(100, 300), null);
  assert.equal(at(500, 20), null);
  // A window's only tab stays.
  assert.equal(at(600, 300, null, false), null);
  assert.equal(at(-5, -5, null, false), null);
});

test('reordering moves a tab before the one now at its place', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(reorderTarget(ids, 'a', 2), { index: 2, beforeId: 'd' });
  assert.deepEqual(reorderTarget(ids, 'd', -2), { index: 1, beforeId: 'b' });
  assert.deepEqual(reorderTarget(ids, 'b', 9), { index: 3, beforeId: null });
  assert.equal(reorderTarget(ids, 'b', 0), null);
  assert.equal(reorderTarget(ids, 'x', 1), null);
});
