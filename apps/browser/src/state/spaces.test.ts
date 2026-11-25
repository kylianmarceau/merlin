import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Tab } from './types';
import {
  arrivalTab, cleanName, findSpace, maxSpaces, neighbour, nextName, parseSpaces, savedNameFor, savedSpaces, spaceView, startingSpace,
  strays, swipeOffset, swipeOutcome, tabsOf, type Space,
} from './spaces';

const tab = (id: string, extra: Partial<Tab> = {}): Tab => ({ id, title: id, url: `https://${id}.test/`, loading: false, pinned: false,
  audible: false, canGoBack: false, canGoForward: false, ...extra });
const sp = (id: string, extra: Partial<Space> = {}): Space => ({ id, name: id.toUpperCase(), icon: 'house', theme: null, ...extra });
const spaces = [sp('a'), sp('b'), sp('c')];

test('a space shows the favourites, its own tabs and the active tab', () => {
  const tabs = [tab('fav', { pinned: true }), tab('a1', { space: 'a' }), tab('b1', { space: 'b' }), tab('loose'), tab('gone', { space: 'z' })];
  const view = spaceView({ tabs, activeTabId: 'a1' }, spaces, 'a');
  // Tabs without a space, or whose space went, show in the space showing.
  assert.deepEqual(view.tabs.map(t => t.id), ['fav', 'a1', 'loose', 'gone']);
  // While the window catches up with a tab chosen elsewhere, that tab still shows.
  assert.deepEqual(spaceView({ tabs, activeTabId: 'b1' }, spaces, 'a').tabs.map(t => t.id), ['fav', 'a1', 'b1', 'loose', 'gone']);
  // Nothing hidden: the same object.
  const all = { tabs: [tab('a1', { space: 'a' })], activeTabId: 'a1' };
  assert.equal(spaceView(all, spaces, 'a'), all);
  assert.equal(spaceView({ tabs, activeTabId: 'a1' }, spaces, null).tabs.length, tabs.length);
});

test('a split view stays whole and groups with nothing showing go', () => {
  const tabs = [tab('a1', { space: 'a', split: 's' }), tab('b1', { space: 'b', split: 's' }), tab('b2', { space: 'b', group: 'g' })];
  const view = spaceView({ tabs, activeTabId: 'a1', groups: [{ id: 'g' }] }, spaces, 'a');
  assert.deepEqual(view.tabs.map(t => t.id), ['a1', 'b1']);
  assert.deepEqual(view.groups, []);
});

test('strays are the unpinned tabs with no space, or a space that is gone', () => {
  const tabs = [tab('p', { pinned: true }), tab('a1', { space: 'a' }), tab('n'), tab('z', { space: 'z' })];
  assert.deepEqual(strays(tabs, spaces).map(t => t.id), ['n', 'z']);
  assert.deepEqual(tabsOf(tabs, 'b', spaces, 'b').map(t => t.id), ['n', 'z']);
});

test('arriving in a space shows its last selected tab, else its last tab, else none', () => {
  const tabs = [tab('b1', { space: 'b' }), tab('b2', { space: 'b' }), tab('a1', { space: 'a' })];
  assert.equal(arrivalTab(tabs, 'b', spaces, 'a', 'b1')?.id, 'b1');
  assert.equal(arrivalTab(tabs, 'b', spaces, 'a', 'a1')?.id, 'b2');
  assert.equal(arrivalTab(tabs, 'c', spaces, 'a', undefined), null);
});

test('a window starts in its active tab’s space, else the one remembered, else the first', () => {
  assert.equal(startingSpace(spaces, tab('t', { space: 'c' }), 'b'), 'c');
  assert.equal(startingSpace(spaces, tab('t', { pinned: true, space: 'c' }), 'b'), 'b');
  assert.equal(startingSpace(spaces, undefined, 'gone'), 'a');
  assert.equal(startingSpace([], undefined, null), null);
});

test('stepping goes round the ends unless told not to', () => {
  assert.equal(neighbour(spaces, 'c', 1)?.id, 'a');
  assert.equal(neighbour(spaces, 'a', -1)?.id, 'c');
  assert.equal(neighbour(spaces, 'c', 1, false), null);
  assert.equal(neighbour([sp('a')], 'a', 1), null);
});

test(':space go takes a number or a name', () => {
  assert.equal(findSpace(spaces, '2')?.id, 'b');
  assert.equal(findSpace(spaces, '9'), null);
  assert.equal(findSpace([sp('w', { name: 'Work' }), sp('x', { name: 'Workout' })], 'work')?.id, 'w');
  assert.equal(findSpace([sp('x', { name: 'Workout' })], 'wo')?.id, 'x');
});

test('names: trimmed and one line; new ones numbered past those taken', () => {
  assert.equal(cleanName('  Deep \n work  '), 'Deep work');
  assert.equal(cleanName('x'.repeat(80)).length, 64);
  assert.equal(nextName([sp('a', { name: 'Home' })]), 'Space 2');
  assert.equal(nextName([sp('a', { name: 'Home' }), sp('b', { name: 'Space 2' })]), 'Space 3');
  assert.equal(savedNameFor('My Work ✨'), 'My-Work');
  assert.equal(savedNameFor('✨'), '');
  assert.equal(savedNameFor('Café'), 'Cafe');
});

test('spaces read back keep only well-formed ones, once each', () => {
  const raw = JSON.stringify([
    { id: 'a', name: 'Home', icon: 'house', theme: null, saved: 'home' },
    { id: 'a', name: 'Again', icon: 'house' },
    { id: 'bad id', name: 'X', icon: 'house' },
    { id: 'b', name: '   ', icon: 'house' },
    { id: 'c', name: 'Work', icon: 'briefcase', saved: '../evil' },
  ]);
  const read = parseSpaces(raw);
  assert.deepEqual(read.map(s => s.id), ['a', 'c']);
  assert.equal(read[0].saved, 'home');
  assert.equal(read[1].saved, undefined);
  assert.deepEqual(parseSpaces('nonsense'), []);
  assert.deepEqual(parseSpaces(null), []);
  assert.equal(parseSpaces(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, icon: 'house' })))).length,
    maxSpaces);
  assert.deepEqual(savedSpaces(read), { home: 'a' });
});

test('a swipe past a quarter of the width changes space; past the last it makes one', () => {
  assert.deepEqual(swipeOutcome(-30, 0, 200, 0, 3), { kind: 'stay' });
  assert.deepEqual(swipeOutcome(-60, 0, 200, 0, 3), { kind: 'switch', to: 1 });
  assert.deepEqual(swipeOutcome(60, 0, 200, 1, 3), { kind: 'switch', to: 0 });
  assert.deepEqual(swipeOutcome(60, 0, 200, 0, 3), { kind: 'stay' });
  assert.deepEqual(swipeOutcome(-60, 0, 200, 2, 3), { kind: 'create' });
  assert.deepEqual(swipeOutcome(-60, 0, 200, maxSpaces - 1, maxSpaces), { kind: 'stay' });
  // A quick flick counts though it went less far.
  assert.deepEqual(swipeOutcome(-20, -400, 200, 0, 3), { kind: 'switch', to: 1 });
  assert.deepEqual(swipeOutcome(-60, 0, 0, 0, 3), { kind: 'stay' });
});

test('a swipe follows the fingers, resisting past the ends', () => {
  assert.equal(swipeOffset(-50, 1, 3, 200), -50);
  const pulled = swipeOffset(100, 0, 3, 200);
  assert.ok(pulled > 0 && pulled < 200 * 0.12);
  assert.ok(Math.abs(swipeOffset(-100, 2, 3, 200)) < 200 * 0.35);
});
