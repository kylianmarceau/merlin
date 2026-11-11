import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Prompt, Snapshot } from '../platform/protocol';
import { overlays, promptPresentation } from './surfaces';

const permission: Prompt = { id: 'native-request', kind: 'permission', anchor: 'site', origin: 'https://example.com',
  title: 'Site permission', message: 'Use your camera', actions: [{ id: 'deny', label: 'Block', emphasis: 'normal' }] };
const state: Snapshot = {
  session: 's', windowId: 'w', revision: 1, private: false, tabs: [], activeTabId: null, downloads: [],
  appearance: { mode: 'system', accent: 'ocean', reduceMotion: false },
  modal: { mode: 'Normal', pending: '', message: '', palette: {
    visible: true, prompt: 'Commands', placeholder: '', text: '', rows: [], selected: -1, error: '', status: '',
  } },
  prompt: permission,
};
const idle: Snapshot = { ...state, prompt: null, modal: { ...state.modal, palette: null } };

test('site questions are popovers; page and window questions are dialogs', () => {
  assert.equal(promptPresentation(permission), 'popover');
  assert.equal(promptPresentation({ ...permission, anchor: 'page', kind: 'alert' }), 'dialog');
  assert.equal(promptPresentation({ ...permission, anchor: undefined }), 'dialog');
  assert.equal(promptPresentation({ ...permission, kind: 'beforeUnload' }), 'dialog');
});
test('a browser prompt takes the popover layer and stays above settings', () => {
  const o = overlays(state, 'settings', 'extensions', null);
  assert.equal(o.prompt?.as, 'popover');
  assert.equal(o.popover, null);
  assert.equal(o.panel, 'settings');
  assert.equal(o.palette, false);
});
test('a page dialog hides the command menu; a site popover does too', () => {
  const dialog = overlays({ ...state, prompt: { ...permission, anchor: 'page', kind: 'confirm' } }, null, null, null);
  assert.equal(dialog.prompt?.as, 'dialog');
  assert.equal(dialog.palette, false);
});
test('quiet requests wait for an explicit reveal', () => {
  const quiet = { ...state, prompt: { ...permission, quiet: true } };
  assert.equal(overlays(quiet, null, null, null).prompt, null);
  assert.equal(overlays(quiet, null, null, null).palette, true);
  assert.equal(overlays(quiet, null, null, 'native-request').prompt?.prompt.id, 'native-request');
  assert.equal(overlays(quiet, null, null, 'stale-request').prompt, null);
});
test('one popover at a time, and an extension popup replaces the list it came from', () => {
  assert.equal(overlays(idle, null, 'extensions', null).popover, 'extensions');
  const popup = { ...idle, extensionPopup: { extensionId: 'e', name: 'E', width: 300, height: 200, ready: true } };
  assert.equal(overlays(popup, null, 'extensions', null).popover, 'extension-popup');
});
