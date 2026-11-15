import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reorderTarget, tabDropZone } from './tabDrag';

const window = { width: 1000, height: 700 };
const page = { x: 260, y: 50, width: 730, height: 640 };
const at = (x: number, y: number, canSplit = true, canDetach = true) => tabDropZone({ x, y, window, page, canSplit, canDetach });

test('the page halves split, outside the window detaches', () => {
  assert.equal(at(300, 300), 'left');
  assert.equal(at(900, 300), 'right');
  assert.equal(at(-20, 300), 'window');
  assert.equal(at(500, 720), 'window');
});

test('over the tabs or toolbar a dragged tab has no drop zone', () => {
  assert.equal(at(100, 300), null);
  assert.equal(at(500, 20), null);
  assert.equal(tabDropZone({ x: 500, y: 300, window, page: undefined, canSplit: true, canDetach: true }), null);
});

test('the current tab leaves for a window; a lone tab goes nowhere', () => {
  assert.equal(at(300, 300, false), 'window');
  assert.equal(at(300, 300, false, false), null);
  assert.equal(at(-5, -5, true, false), null);
});

test('reordering moves a tab before the one now at its place', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(reorderTarget(ids, 'a', 2), { index: 2, beforeId: 'd' });
  assert.deepEqual(reorderTarget(ids, 'd', -2), { index: 1, beforeId: 'b' });
  assert.deepEqual(reorderTarget(ids, 'b', 9), { index: 3, beforeId: null });
  assert.equal(reorderTarget(ids, 'b', 0), null);
  assert.equal(reorderTarget(ids, 'x', 1), null);
});
