import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beforeIdFor, columnsFor, gridHeight, overZone, placeAt, slotAt, slotOrigin, tileWidth } from './favouriteGrid';

test('one or two favourites share the whole row; past four they wrap in fours', () => {
  assert.equal(columnsFor(0), 1);
  assert.equal(columnsFor(1), 1);
  assert.equal(columnsFor(2), 2);
  assert.equal(columnsFor(4), 4);
  assert.equal(columnsFor(9), 4);
  assert.equal(tileWidth(230, 1, 6), 230);
  assert.equal(tileWidth(230, 2, 6), 112);
  assert.equal(gridHeight(4, 44, 6), 44);
  assert.equal(gridHeight(5, 44, 6), 94);
});

test('slots run left to right, then down', () => {
  const tile = { width: 50, height: 44 };
  assert.deepEqual(slotOrigin(0, 4, tile, 6), { x: 0, y: 0 });
  assert.deepEqual(slotOrigin(3, 4, tile, 6), { x: 168, y: 0 });
  assert.deepEqual(slotOrigin(5, 4, tile, 6), { x: 56, y: 50 });
});

test('the slot under the pointer is the nearest one, never past the last', () => {
  // Two tiles across 230 pt: each 112 wide.
  assert.equal(slotAt(10, 10, 2, 230, 44, 6), 0);
  assert.equal(slotAt(200, 10, 2, 230, 44, 6), 1);
  assert.equal(slotAt(-40, -40, 2, 230, 44, 6), 0);
  // Five tiles: the second row has one; a point under its empty slots picks the last.
  assert.equal(slotAt(200, 60, 5, 230, 44, 6), 4);
  assert.equal(slotAt(10, 60, 5, 230, 44, 6), 4);
  assert.equal(slotAt(180, 10, 5, 230, 44, 6), 3);
});

test('a dragged tile or tab lands at its slot, and moves in front of the tile after it', () => {
  assert.deepEqual(placeAt(['a', 'b', 'c'], 'a', 2), ['b', 'c', 'a']);
  assert.deepEqual(placeAt(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
  assert.deepEqual(placeAt(['a', 'b'], 'x', 1), ['a', 'x', 'b']);
  assert.deepEqual(placeAt(['a', 'b'], 'x', 9), ['a', 'b', 'x']);
  assert.equal(beforeIdFor(['b', 'c', 'a'], 1, 'open'), 'a');
  assert.equal(beforeIdFor(['b', 'c', 'a'], 2, 'open'), 'open');
  assert.equal(beforeIdFor(['b', 'c', 'a'], 2, null), null);
});

test('the grid takes a drop a little outside its edge', () => {
  const zone = { x: 10, y: 100, width: 230, height: 44, gap: 6, tileHeight: 44 };
  assert.ok(overZone(zone, 5, 98, 8));
  assert.ok(!overZone(zone, 5, 160, 8));
});
