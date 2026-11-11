import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineClient, type EngineEvent, type Snapshot } from '@merlin/engine/protocol';
import { createBrowserStore, attachEngine } from './browser';

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
test('unrelated browser updates preserve an error until it is dismissed', () => {
  const store = createBrowserStore('w');
  store.getState().accept(snapshot(1));
  store.setState({ error: 'This download could not be opened' });
  store.getState().accept(snapshot(2));
  assert.equal(store.getState().error, 'This download could not be opened');
  assert.equal(store.getState().snapshot?.revision, 2);
});
