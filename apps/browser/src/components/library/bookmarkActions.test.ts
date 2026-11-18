import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BookmarkItem } from '../../state/types';
import { rowAccessibilityActions, rowActionForKey, rowActionNamed, rowKeyDownEvents } from '../ui/rowActions';
import { bookmarkRowActions } from './bookmarkActions';

const item = (over: Partial<BookmarkItem> = {}) =>
  ({ id: '7', title: 'Example', url: 'https://example.com/', folder: false, editable: true, ...over }) as BookmarkItem;

function record(it: BookmarkItem, place: { index: number; count: number; searching: boolean }) {
  const calls: string[] = [];
  const actions = bookmarkRowActions(it, place, {
    move: delta => calls.push(`move ${delta}`), edit: () => calls.push('edit'), remove: () => calls.push('remove'),
  });
  return { actions, calls };
}

test('M13: VoiceOver can move, edit and delete a bookmark from its Actions menu', () => {
  const { actions, calls } = record(item(), { index: 1, count: 3, searching: false });
  assert.deepEqual(rowAccessibilityActions(actions).map(a => a.label), ['Move Up', 'Move Down', 'Edit Example', 'Delete Example']);
  for (const name of ['moveUp', 'moveDown', 'edit', 'delete']) rowActionNamed(actions, name)!.run();
  assert.deepEqual(calls, ['move -1', 'move 1', 'edit', 'remove']);
});

test('M13: the keyboard moves and deletes a focused bookmark, and only with the exact keys', () => {
  const { actions, calls } = record(item(), { index: 1, count: 3, searching: false });
  rowActionForKey(actions, { key: 'ArrowUp', altKey: true })!.run();
  rowActionForKey(actions, { key: 'ArrowDown', altKey: true })!.run();
  rowActionForKey(actions, { key: 'Backspace', metaKey: true })!.run();
  assert.deepEqual(calls, ['move -1', 'move 1', 'remove']);
  // A plain arrow or Delete, or one with another modifier too, does nothing.
  assert.equal(rowActionForKey(actions, { key: 'ArrowUp' }), undefined);
  assert.equal(rowActionForKey(actions, { key: 'Backspace' }), undefined);
  assert.equal(rowActionForKey(actions, { key: 'Backspace', metaKey: true, shiftKey: true }), undefined);
});

test('a focused row still opens with Return and Space, and claims only its own keys', () => {
  const { actions } = record(item(), { index: 1, count: 3, searching: false });
  const claimed = rowKeyDownEvents(actions);
  assert.deepEqual(claimed.slice(0, 2), [{ key: 'Enter' }, { key: ' ' }]);
  assert.deepEqual(claimed.slice(2), [
    { key: 'ArrowUp', metaKey: false, altKey: true, shiftKey: false, ctrlKey: false },
    { key: 'ArrowDown', metaKey: false, altKey: true, shiftKey: false, ctrlKey: false },
    { key: 'Backspace', metaKey: true, altKey: false, shiftKey: false, ctrlKey: false },
  ]);
});

test('no moves past either end or in search results, and none at all for a row that can’t change', () => {
  assert.deepEqual(record(item(), { index: 0, count: 2, searching: false }).actions.map(a => a.name), ['moveDown', 'edit', 'delete']);
  assert.deepEqual(record(item(), { index: 1, count: 2, searching: false }).actions.map(a => a.name), ['moveUp', 'edit', 'delete']);
  assert.deepEqual(record(item(), { index: 1, count: 3, searching: true }).actions.map(a => a.name), ['edit', 'delete']);
  assert.deepEqual(record(item({ editable: false }), { index: 1, count: 3, searching: false }).actions, []);
  assert.equal(record(item({ folder: true, title: 'Work' }), { index: 0, count: 1, searching: false }).actions[0].label, 'Rename Work');
});
