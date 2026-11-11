import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineClient, type EngineEvent, type Snapshot } from '../platform/protocol';
import { acceptSnapshot, attachEngine, createBrowserStore, openNativePanel, pushToast } from './store';

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
  store.setState({ omnibox: { queryId: 'q2', text: 'exa', items: [], selected: -1 } });
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
