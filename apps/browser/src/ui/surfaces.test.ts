import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Snapshot } from '@merlin/engine/protocol';
import { visibleSurface } from './surfaces';

const state: Snapshot = {
  session: 's', windowId: 'w', revision: 1, private: false, tabs: [], activeTabId: null, downloads: [],
  appearance: { mode: 'system', accent: 'ocean', reduceMotion: false },
  modal: { mode: 'Normal', pending: '', message: '', palette: {
    visible: true, prompt: 'Commands', placeholder: '', text: '', rows: [], selected: -1, error: '', status: ''
  } },
  prompt: { id: 'native-request', kind: 'permission', origin: 'https://example.com', title: 'Site permission',
    message: 'Use your camera', actions: [{ id: 'deny', label: 'Block', emphasis: 'normal' }] },
};
test('a browser permission request remains visible when settings and an error also exist', () => {
  assert.equal(visibleSurface(state, 'A download could not open', 'settings'), 'prompt');
});
test('quiet requests wait for an explicit reveal and then take priority', () => {
  const quiet = { ...state, prompt: { ...state.prompt!, quiet: true } };
  assert.equal(visibleSurface(quiet, null, 'settings'), 'palette');
  assert.equal(visibleSurface(quiet, null, 'settings', 'native-request'), 'prompt');
  assert.equal(visibleSurface(quiet, null, 'settings', 'stale-request'), 'palette');
});
test('a browser prompt stays above the full Settings and Library panels', () => {
  assert.equal(visibleSurface(state, null, 'history'), 'prompt');
  const idle = { ...state, prompt: null, modal: { ...state.modal, palette: null } };
  assert.equal(visibleSurface(idle, null, 'bookmarks'), 'bookmarks');
  assert.equal(visibleSurface(idle, 'Bookmarks are still loading', 'bookmarks'), 'error');
});
