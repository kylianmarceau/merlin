import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Tab } from './types';
import { foldInto, gridItems, homeKey, leaveFolder, parseFolders, renameFolder, ungroupFolder, type FavouriteFolder } from './favouriteFolders';

const tab = (id: string, url: string): Tab => ({ id, title: id, url, loading: false, pinned: true, audible: false,
  canGoBack: false, canGoForward: false });
const key = (t: Tab) => homeKey(t.url);

test("a pinned page's key keeps its origin and path, not its query or fragment", () => {
  assert.equal(homeKey('https://Mail.Example.com/inbox/?tab=1#x'), 'https://mail.example.com/inbox');
  assert.equal(homeKey('https://example.com/'), 'https://example.com');
});

test('a folder takes the place of its first member and gathers the rest', () => {
  const pinned = [tab('a', 'https://a.test/'), tab('b', 'https://b.test/'), tab('c', 'https://c.test/'), tab('d', 'https://d.test/')];
  const folders: FavouriteFolder[] = [{ id: 'f', name: 'Mail', members: ['https://d.test', 'https://b.test'] }];
  const items = gridItems(pinned, key, folders);
  assert.deepEqual(items.map(i => i.id), ['a', 'folder:f', 'c']);
  const folder = items[1];
  assert.ok(folder.kind === 'folder');
  assert.deepEqual(folder.tabs.map(t => t.id), ['b', 'd']);
});

test('a folder with one member here shows as that tab', () => {
  const pinned = [tab('a', 'https://a.test/'), tab('b', 'https://b.test/')];
  const folders: FavouriteFolder[] = [{ id: 'f', name: '', members: ['https://b.test', 'https://gone.test'] }];
  assert.deepEqual(gridItems(pinned, key, folders).map(i => [i.kind, i.id]), [['tab', 'a'], ['tab', 'b']]);
});

test('dropping onto a tile makes a folder, or joins the one it is in', () => {
  let folders = foldInto([], 'https://b.test', 'https://a.test', 'f1');
  assert.deepEqual(folders, [{ id: 'f1', name: '', members: ['https://a.test', 'https://b.test'] }]);
  folders = foldInto(folders, 'https://c.test', 'https://b.test', 'f2');
  assert.deepEqual(folders[0].members, ['https://a.test', 'https://b.test', 'https://c.test']);
  // Moving a member to another tile takes it out of its folder first; a folder of one goes.
  folders = foldInto([{ id: 'f', name: '', members: ['x', 'y'] }], 'y', 'z', 'g');
  assert.deepEqual(folders, [{ id: 'g', name: '', members: ['z', 'y'] }]);
});

test('leaving, renaming and ungrouping', () => {
  const folders: FavouriteFolder[] = [{ id: 'f', name: '', members: ['a', 'b', 'c'] }];
  assert.deepEqual(leaveFolder(folders, 'c')[0].members, ['a', 'b']);
  assert.deepEqual(leaveFolder(leaveFolder(folders, 'c'), 'b'), []);
  assert.equal(renameFolder(folders, 'f', '  Work ')[0].name, 'Work');
  assert.deepEqual(ungroupFolder(folders, 'f'), []);
});

test('saved folders are read back, and anything malformed is dropped', () => {
  assert.deepEqual(parseFolders('[{"id":"f","name":"Mail","members":["a","b","a"]}]'), [{ id: 'f', name: 'Mail', members: ['a', 'b'] }]);
  assert.deepEqual(parseFolders('[{"id":"f","members":["a","b"]}, 3, null]'), []);
  assert.deepEqual(parseFolders('not json'), []);
  assert.deepEqual(parseFolders(null), []);
});
