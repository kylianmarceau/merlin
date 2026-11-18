import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineFor } from '../lib/engines';
import type { Snapshot, Tab } from '../platform/protocol';
import {
  backLeavesWebKit, decide, engineOverlay, iconKey, leaveTimeoutMs, overlayCache, overlaySnapshot, overlayTab, type WebKitTab,
} from './webkitModel';

const engineOf = (url: string) => engineFor(url, { protectedVideoInWebKit: true, siteEngines: {} });
const tab = (url: string, extra: Partial<Tab> = {}): Tab => ({ id: 't', title: 'Chromium', url, loading: false, pinned: false,
  audible: false, canGoBack: false, canGoForward: false, ...extra });
const wk = (extra: Partial<WebKitTab> = {}): WebKitTab => ({ url: 'https://www.netflix.com/', title: 'Netflix', loading: false,
  canGoBack: false, canGoForward: false, crashed: false, windowId: 'w', base: 'https://www.google.com/search?q=netflix', leavingSince: 0, leaveTries: 0, ...extra });

test('a tab reaching a WebKit site opens in WebKit; others are left alone', () => {
  assert.deepEqual(decide(tab('https://www.netflix.com/'), undefined, engineOf, 0), { kind: 'open', url: 'https://www.netflix.com/' });
  assert.deepEqual(decide(tab('https://example.com/'), undefined, engineOf, 0), { kind: 'none' });
  assert.deepEqual(decide(tab('https://www.netflix.com/', { crashed: true }), undefined, engineOf, 0), { kind: 'none' });
});

test('WebKit waits for Chromium to leave the site, then remembers where it went', () => {
  const leaving = wk({ base: null, leavingSince: 1000 });
  const later = 1000 + leaveTimeoutMs + 1;
  assert.deepEqual(decide(tab('https://www.google.com/'), leaving, engineOf, 1500), { kind: 'settle', base: 'https://www.google.com/' });
  assert.deepEqual(decide(tab(''), leaving, engineOf, 1500), { kind: 'settle', base: '' });
  // Still loading: maybe not committed, so no Back yet.
  const loading = tab('https://www.netflix.com/', { loading: true, canGoBack: true });
  assert.deepEqual(decide(loading, leaving, engineOf, 1500), { kind: 'none' });
  assert.deepEqual(decide(loading, leaving, engineOf, later), { kind: 'leave', how: 'stop' });
  assert.deepEqual(decide(loading, { ...leaving, leaveTries: 1 }, engineOf, later), { kind: 'leave', how: 'back' });
  // Loaded in Chromium: back to the page before at once, or a blank page if there is none.
  assert.deepEqual(decide(tab('https://www.netflix.com/', { canGoBack: true }), leaving, engineOf, 1500), { kind: 'leave', how: 'back' });
  assert.deepEqual(decide(tab('https://www.netflix.com/'), leaving, engineOf, 1500), { kind: 'leave', how: 'blank' });
  // Once asked, it waits before asking again.
  assert.deepEqual(decide(tab('https://www.netflix.com/', { canGoBack: true }), { ...leaving, leaveTries: 1, leavingSince: 1400 }, engineOf, 1500), { kind: 'none' });
  const pendingNoHistory = tab('https://www.netflix.com/', { loading: true });
  assert.deepEqual(decide(pendingNoHistory, { ...leaving, leaveTries: 1 }, engineOf, later), { kind: 'leave', how: 'stop' });
  assert.deepEqual(decide(pendingNoHistory, { ...leaving, leaveTries: 2 }, engineOf, later), { kind: 'leave', how: 'blank' });
});

test('Chromium navigating by itself takes the tab back, or WebKit follows it to another WebKit site', () => {
  const shown = wk();
  assert.deepEqual(decide(tab(shown.base!), shown, engineOf, 0), { kind: 'none' });
  assert.deepEqual(decide(tab('https://www.google.com/search?q=other'), shown, engineOf, 0),
    { kind: 'settle', base: 'https://www.google.com/search?q=other' }, 'the same site changing its address is not leaving');
  assert.deepEqual(decide(tab('https://example.com/'), shown, engineOf, 0), { kind: 'close' });
  assert.deepEqual(decide(tab('https://www.netflix.com/title/1'), shown, engineOf, 0), { kind: 'follow', url: 'https://www.netflix.com/title/1' });
  const fromStart = wk({ base: 'about:blank' });
  assert.deepEqual(decide(tab(''), fromStart, engineOf, 0), { kind: 'settle', base: '' });
  assert.deepEqual(decide(tab('https://example.com/'), fromStart, engineOf, 0), { kind: 'close' });
});

test('Back leaves WebKit only for a page of Chromium’s, never for the start page', () => {
  assert.equal(backLeavesWebKit(wk()), true);
  assert.equal(backLeavesWebKit(wk({ canGoBack: true })), false);
  assert.equal(backLeavesWebKit(wk({ base: 'about:blank' })), false);
  assert.equal(backLeavesWebKit(wk({ base: null })), false);
  assert.equal(overlayTab(tab('https://www.google.com/'), wk()).canGoBack, true);
  assert.equal(overlayTab(tab(''), wk({ base: '' })).canGoBack, false);
});

test('a WebKit tab shows WebKit’s page, none of Chromium’s', () => {
  const shown = overlayTab(tab('https://www.google.com/', { audible: true, color: '#FFFFFF', start: true, favicon: 'chromium-key',
    displayUrl: 'google.com', displayHost: 'google.com', security: 'secure' }),
    wk({ title: '', color: undefined, faviconKey: 'webkit:x' }));
  // Chromium's formatting and lock describe its own page, not WebKit's.
  assert.equal(shown.displayUrl, undefined);
  assert.equal(shown.displayHost, undefined);
  assert.equal(shown.security, undefined);
  assert.equal(shown.url, 'https://www.netflix.com/');
  assert.equal(shown.title, 'netflix.com');
  assert.equal(shown.engine, 'webkit');
  assert.equal(shown.audible, false);
  assert.equal(shown.start, false);
  assert.equal(shown.color, undefined);
  assert.equal(shown.favicon, 'webkit:x');
});

test('overlaid snapshots keep unchanged objects', () => {
  const plain = tab('https://example.com/', { id: 'a' });
  const moved = tab('https://www.google.com/', { id: 'b' });
  const snapshot = { session: 's', windowId: 'w', revision: 1, private: false, tabs: [plain, moved], activeTabId: 'a', downloads: [],
    prompt: null, appearance: { mode: 'system', accent: 'ocean', reduceMotion: false }, modal: { mode: 'Normal', pending: '' , message: '' } } as Snapshot;
  const cache = overlayCache();
  assert.equal(overlaySnapshot(snapshot, {}, cache), snapshot);
  const page = wk();
  const first = overlaySnapshot(snapshot, { b: page }, cache);
  const second = overlaySnapshot(snapshot, { b: page }, cache);
  assert.notEqual(first, snapshot);
  assert.equal(first.tabs[0], plain);
  assert.equal(first.tabs[1], second.tabs[1]);
  assert.notEqual(overlaySnapshot(snapshot, { b: { ...page, title: 'New' } }, cache).tabs[1], first.tabs[1]);
});

test('icon keys are stable and tell icons apart', () => {
  assert.equal(iconKey('data:image/png;base64,AAAA'), iconKey('data:image/png;base64,AAAA'));
  assert.notEqual(iconKey('data:image/png;base64,AAAA'), iconKey('data:image/png;base64,AAAB'));
  assert.ok(iconKey('data:x').startsWith('webkit:'));
});

test('a tab restored showing WebKit shows it again, unless its site now opens in Chromium', () => {
  const restored = tab('https://www.google.com/search?q=netflix', { restoreInWebKit: { url: 'https://www.netflix.com/watch/1', title: 'Netflix' } });
  assert.deepEqual(decide(restored, undefined, engineOf, 0), { kind: 'restore', url: 'https://www.netflix.com/watch/1', title: 'Netflix' });
  const chromium = (url: string) => engineFor(url, { protectedVideoInWebKit: false, siteEngines: {} });
  assert.deepEqual(decide(restored, undefined, chromium, 0), { kind: 'decline', url: 'https://www.netflix.com/watch/1' });
  // Once shown, the hint left in the snapshot until native code hears changes nothing.
  assert.deepEqual(decide(restored, wk({ base: restored.url }), engineOf, 0), { kind: 'none' });
  assert.equal(overlayTab(restored, wk()).restoreInWebKit, undefined);
});

test('native code hears what a WebKit tab shows, once it shows a web page', () => {
  assert.deepEqual(engineOverlay(wk({ url: 'https://www.netflix.com/watch/1', title: 'Netflix' })),
    { engine: 'webkit', url: 'https://www.netflix.com/watch/1', title: 'Netflix' });
  assert.equal(engineOverlay(wk({ url: '' })), null);
  assert.equal(engineOverlay(undefined), null);
});
