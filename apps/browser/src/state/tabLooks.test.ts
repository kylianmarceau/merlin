import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dressSnapshot, withLook } from './tabLooks';
import type { Snapshot } from '../platform/protocol';

const tab = (id: string) => ({ id, title: `Page ${id}`, url: `https://${id}.test/`, loading: false, pinned: false, audible: false,
  canGoBack: false, canGoForward: false });
const snapshot = { tabs: [tab('a'), tab('b')] } as unknown as Snapshot;

test('a renamed tab keeps its page title and gains its name and symbol', () => {
  const looks = withLook({}, 'a', { name: 'Mail', symbol: 'envelope' }, ['a', 'b']);
  const out = dressSnapshot(snapshot, looks);
  assert.equal(out.tabs[0].name, 'Mail');
  assert.equal(out.tabs[0].title, 'Page a');
  assert.equal(out.tabs[0].symbol, 'envelope');
  assert.equal(out.tabs[1], snapshot.tabs[1]);
  // Nothing changed: the same objects come back.
  assert.equal(dressSnapshot(snapshot, looks), out);
});

test('clearing a name or icon forgets it, and closed tabs are forgotten', () => {
  let looks = withLook({}, 'a', { name: 'Mail' }, ['a', 'b']);
  looks = withLook(looks, 'b', { symbol: 'star' }, ['a', 'b']);
  looks = withLook(looks, 'a', { name: '' }, ['a', 'b']);
  assert.deepEqual(looks, { b: { symbol: 'star' } });
  assert.deepEqual(withLook(looks, 'c', { name: 'x' }, ['c']), { c: { name: 'x' } });
  assert.equal(dressSnapshot(snapshot, {}), snapshot);
});
