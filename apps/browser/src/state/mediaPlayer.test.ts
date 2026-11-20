import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepDismissed, playerTab } from './mediaPlayer';
import type { Tab } from './types';

const tab = (id: string, extra: Partial<Tab> = {}): Tab => ({ id, title: id, url: `https://${id}.test/`, loading: false, pinned: false,
  audible: false, canGoBack: false, canGoForward: false, ...extra });
const media = (playing: boolean) => ({ playing, title: '', artist: '', canNext: false, canPrevious: false });

test('the player is for a background tab with media, playing before paused, then the most recent', () => {
  const tabs = [tab('a', { media: media(false) }), tab('b', { audible: true }), tab('c', { media: media(true) }), tab('d')];
  assert.equal(playerTab(tabs, 'd', [], new Set())?.id, 'b');
  assert.equal(playerTab(tabs, 'd', ['c', 'b'], new Set())?.id, 'c');
  assert.equal(playerTab(tabs, 'c', ['c', 'b'], new Set())?.id, 'b');
  assert.equal(playerTab(tabs, 'd', [], new Set(['b', 'c']))?.id, 'a');
  assert.equal(playerTab([tab('d')], 'd', [], new Set()), null);
});
test('the tab beside the active one in a split is on screen, so has no player', () => {
  const tabs = [tab('a', { split: 's' }), tab('b', { split: 's', audible: true })];
  assert.equal(playerTab(tabs, 'a', [], new Set()), null);
});
test('a dismissal holds until the tab plays again after a pause', () => {
  const paused = [tab('a', { media: media(false) })];
  const playing = [tab('a', { media: media(true) })];
  assert.deepEqual([...keepDismissed(new Set(['a']), playing, new Map([['a', true]]))], ['a']);
  assert.deepEqual([...keepDismissed(new Set(['a']), paused, new Map([['a', true]]))], ['a']);
  assert.deepEqual([...keepDismissed(new Set(['a']), playing, new Map([['a', false]]))], []);
  assert.deepEqual([...keepDismissed(new Set(['a']), [], new Map())], []);
});
