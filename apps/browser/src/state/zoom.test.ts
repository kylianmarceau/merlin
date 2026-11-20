import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomChange } from './zoom';
import type { Snapshot, Tab } from './types';

const tab = (url: string, percent: number): Tab => ({ id: 't', title: '', url, loading: false, pinned: false, audible: false,
  canGoBack: false, canGoForward: false, zoom: { percent, default: percent === 100 } });
const shot = (t: Tab, active = 't'): Snapshot => ({ session: 's', windowId: 'w', revision: 1, private: false, tabs: [t, { ...t, id: 'u' }],
  activeTabId: active, downloads: [], prompt: null, appearance: { mode: 'system', accent: 'ocean', reduceMotion: false },
  modal: { mode: 'Normal', pending: '', message: '' } });

test('zooming the page in front gives its new zoom', () => {
  assert.deepEqual(zoomChange(shot(tab('https://a.test/x', 100)), shot(tab('https://a.test/x', 125))), { percent: 125, default: false });
  assert.deepEqual(zoomChange(shot(tab('https://a.test/x', 125)), shot(tab('https://a.test/y', 100))), { percent: 100, default: true });
});
test('a new tab, a new site or an unchanged zoom shows nothing', () => {
  assert.equal(zoomChange(null, shot(tab('https://a.test/', 125))), null);
  assert.equal(zoomChange(shot(tab('https://a.test/', 100)), shot(tab('https://a.test/', 100))), null);
  assert.equal(zoomChange(shot(tab('https://a.test/', 100)), shot(tab('https://b.test/', 125))), null);
  assert.equal(zoomChange(shot(tab('https://a.test/', 100), 'u'), shot(tab('https://a.test/', 125))), null);
  assert.equal(zoomChange(shot({ ...tab('https://a.test/', 100), zoom: undefined }), shot(tab('https://a.test/', 125))), null);
});
