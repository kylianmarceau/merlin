import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineClient, type EngineEvent, type Snapshot } from '../platform/protocol';
import { acceptSnapshot, attachEngine, createBrowserStore, openNativePanel, pushToast } from './store';
import { awayFromHome } from './pinned';

function snapshot(revision: number): Snapshot {
  return { session: 's', windowId: 'w', revision, private: false, tabs: [], activeTabId: null, downloads: [], prompt: null,
    appearance: { mode: 'system', accent: 'ocean', reduceMotion: false }, modal: { mode: 'Normal', pending: '', message: '' } };
}
test('a late initial response cannot overwrite a newer tab event', async () => {
  let resolve!: (value: string) => void;
  let listener!: (event: EngineEvent) => void;
  const client = new EngineClient('w', { call: () => new Promise(r => { resolve = r; }), subscribe: l => { listener = l; return () => {}; } });
  const store = createBrowserStore('w');
  const dispose = attachEngine(store, client);
  listener({ type: 'snapshot', snapshot: snapshot(3) });
  resolve(JSON.stringify({ ok: true, value: snapshot(1) }));
  await new Promise(r => setImmediate(r));
  assert.equal(store.getState().snapshot?.revision, 3); dispose();
});
test('closing the window prevents an outstanding snapshot from updating its store', async () => {
  let resolve!: (value: string) => void;
  let removed = false;
  const client = new EngineClient('w', { call: () => new Promise(r => { resolve = r; }), subscribe: () => () => { removed = true; } });
  const store = createBrowserStore('w');
  const dispose = attachEngine(store, client); dispose();
  resolve(JSON.stringify({ ok: true, value: snapshot(1) }));
  await new Promise(r => setImmediate(r));
  assert.equal(store.getState().snapshot, null); assert.equal(removed, true);
});
test('notices survive unrelated browser updates and stay few', () => {
  const store = createBrowserStore('w');
  acceptSnapshot(store, snapshot(1));
  pushToast(store, 'This download could not be opened');
  acceptSnapshot(store, snapshot(2));
  assert.deepEqual(store.getState().toasts.map(t => t.text), ['This download could not be opened']);
  for (const text of ['a', 'b', 'c', 'a']) pushToast(store, text);
  assert.deepEqual(store.getState().toasts.map(t => t.text), ['b', 'c', 'a']);
});
test('suggestions for an older query are ignored', () => {
  let listener!: (event: EngineEvent) => void;
  const client = new EngineClient('w', { call: () => new Promise(() => {}), subscribe: l => { listener = l; return () => {}; } });
  const store = createBrowserStore('w');
  attachEngine(store, client);
  store.setState({ omnibox: { queryId: 'q2', text: 'exa', items: [], itemsQueryId: null, selected: -1, owner: 'address' } });
  const item = { kind: 'url' as const, title: 'Example', detail: 'example.com', url: 'https://example.com/', completion: 'mple.com', default: true };
  listener({ type: 'omnibox.results', windowId: 'w', queryId: 'q1', items: [item] });
  assert.equal(store.getState().omnibox?.items.length, 0);
  listener({ type: 'omnibox.results', windowId: 'w', queryId: 'q2', items: [item] });
  assert.equal(store.getState().omnibox?.items[0].url, 'https://example.com/');
});
test('native menu commands open the matching panel or popover', () => {
  const store = createBrowserStore('w');
  openNativePanel(store, 'extensions');
  assert.equal(store.getState().popover, 'extensions');
  openNativePanel(store, 'history');
  assert.deepEqual([store.getState().panel, store.getState().popover], ['history', null]);
});
test('Command-T opens the new-tab pop-up, and again asks its field for the focus', () => {
  const store = createBrowserStore('w');
  openNativePanel(store, 'newTab');
  assert.equal(store.getState().panel, 'newTab');
  const focus = store.getState().addressFocus;
  openNativePanel(store, 'newTab');
  assert.equal(store.getState().addressFocus, focus + 1);
});
test('unchanged tabs and downloads keep their objects, so their rows skip rendering', () => {
  const tab = (id: string, title: string) => ({ id, title, url: 'https://a.test/', loading: false, pinned: false, audible: false,
    canGoBack: false, canGoForward: false });
  const download = { id: 'd', name: 'f.zip', received: 1, total: 2, state: 'progress' as const };
  const store = createBrowserStore('w');
  acceptSnapshot(store, { ...snapshot(1), tabs: [tab('1', 'One'), tab('2', 'Two')], downloads: [download] });
  const before = store.getState().snapshot!;
  acceptSnapshot(store, { ...snapshot(2), tabs: [tab('1', 'One'), tab('2', 'Two, loaded')], downloads: [{ ...download }] });
  const after = store.getState().snapshot!;
  assert.equal(after.tabs[0], before.tabs[0]);
  assert.notEqual(after.tabs[1], before.tabs[1]);
  assert.equal(after.tabs[1].title, 'Two, loaded');
  assert.equal(after.downloads, before.downloads);
  acceptSnapshot(store, { ...snapshot(3), tabs: [tab('2', 'Two, loaded'), tab('1', 'One')], downloads: [] });
  const moved = store.getState().snapshot!;
  assert.equal(moved.tabs[0], after.tabs[1]);
  assert.deepEqual(moved.downloads, []);
});

test('a pinned tab remembers the page it was pinned on until it is unpinned or closes', () => {
  const tab = (id: string, url: string, pinned: boolean) => ({ id, title: url, url, loading: false, pinned, audible: false,
    canGoBack: false, canGoForward: false });
  const store = createBrowserStore('w');
  acceptSnapshot(store, { ...snapshot(1), tabs: [tab('1', 'merlin://newtab', true), tab('2', 'https://b.test/', false)] });
  // A start page is no home; the first real page is.
  assert.deepEqual(store.getState().pinnedHomes, {});
  acceptSnapshot(store, { ...snapshot(2), tabs: [tab('1', 'https://a.test/', true), tab('2', 'https://b.test/', true)] });
  const homes = store.getState().pinnedHomes;
  assert.equal(homes['1'].url, 'https://a.test/');
  assert.equal(homes['2'].url, 'https://b.test/');
  acceptSnapshot(store, { ...snapshot(3), tabs: [tab('1', 'https://a.test/elsewhere', true), tab('2', 'https://b.test/', true)] });
  assert.equal(store.getState().pinnedHomes, homes, 'navigating keeps the home and the object');
  assert.ok(awayFromHome(store.getState().snapshot!.tabs[0], homes['1']));
  assert.ok(!awayFromHome({ ...tab('2', 'https://b.test/#top', true) }, homes['2']), 'a fragment is the same page');
  acceptSnapshot(store, { ...snapshot(4), tabs: [tab('1', 'https://a.test/elsewhere', false)] });
  assert.deepEqual(store.getState().pinnedHomes, {});
});

test('a hover card goes with its tab, and a peek with the tabs shown again', () => {
  const tab = { id: '1', title: 'A', url: 'https://a.test/', loading: false, pinned: false, audible: false, canGoBack: false, canGoForward: false };
  const store = createBrowserStore('w');
  acceptSnapshot(store, { ...snapshot(1), tabs: [tab], modal: { mode: 'Normal', pending: '', message: '', sidebarHidden: true } });
  store.setState({ hoverCard: { tabId: '1', anchor: { x: 0, y: 0, width: 10, height: 10 }, side: 'right' }, peeking: true });
  acceptSnapshot(store, { ...snapshot(2), tabs: [tab], modal: { mode: 'Normal', pending: '', message: '', sidebarHidden: true } });
  assert.ok(store.getState().hoverCard);
  assert.equal(store.getState().peeking, true);
  acceptSnapshot(store, { ...snapshot(3), tabs: [], modal: { mode: 'Normal', pending: '', message: '', sidebarHidden: false } });
  assert.equal(store.getState().hoverCard, null);
  assert.equal(store.getState().peeking, false);
});

test('tabs say whether they are muted, bookmarked or asleep, and nothing else is accepted there', () => {
  const tab = { id: '1', title: 'A', url: 'https://a.test/', loading: false, pinned: false, audible: true, canGoBack: false, canGoForward: false };
  const store = createBrowserStore('w');
  acceptSnapshot(store, { ...snapshot(1), tabs: [{ ...tab, muted: true, bookmarked: true, discarded: false }] });
  const shown = store.getState().snapshot!.tabs[0];
  assert.equal(shown.muted, true);
  assert.equal(shown.bookmarked, true);
  assert.throws(() => acceptSnapshot(store, { ...snapshot(2), tabs: [{ ...tab, muted: 'yes' }] }));
});
