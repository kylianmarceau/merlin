// Tabs the shell shows in WebKit: it runs the rules in webkitModel.ts
// against Chromium's snapshots and the native WebKit pages. One record per
// tab for the whole app; each window draws its own tabs' records over its
// snapshot (store.overlay).
import { createStore } from 'zustand/vanilla';
import { engineFor, siteOf, type PageEngine } from '../lib/engines';
import type { EngineClient } from '../platform/protocol';
import {
  closeWebKitPage, focusWebKitPage, loadWebKitPage, setPrivateWindow, setWebKitAutoPip, subscribeWebKit, webKitCommand, type WebKitCommand,
  type WebKitEvent,
} from '../platform/webkit';
import { shellPrefs } from './shellPrefs';
import { loadEnginePrefs, setSiteEngine } from './shellPrefsStorage';
import { acceptSnapshot, refreshOverlay, rememberFavicon, showStatusMessage, type BrowserStore } from './store';
import {
  backLeavesWebKit, decide, engineOverlay, iconKey, leaveTimeoutMs, overlayCache, overlaySnapshot, type WebKitTab,
} from './webkitModel';

export const webkitTabs = createStore<Record<string, WebKitTab>>()(() => ({}));

type Window = { store: BrowserStore; engine: EngineClient; openTab(url: string): void };
const windows = new Map<string, Window>();
/** Saved site choices have been read; until then no tab moves to WebKit. */
let prefsReady = false;
/** The shell was built without the WebKit module: every page stays in Chromium. */
let unavailable = false;
let stopListening: (() => void) | null = null;
/** A closed tab's page goes once no window has had the tab for this long (a tab moving windows leaves one first). */
const closedTabGraceMs = 1000;
const recheckSlackMs = 100;

/** The Automatic Picture in Picture setting has been read for WebKit (followAutoPip). */
let autoPipRead = false;

const engineOf = (url: string): PageEngine => engineFor(url, shellPrefs.getState());
const pages = () => webkitTabs.getState();

function patch(tabId: string, change: Partial<WebKitTab>) {
  const wk = pages()[tabId];
  if (wk) webkitTabs.setState({ [tabId]: { ...wk, ...change } });
}

/** The tab shows Chromium's page again; WebKit's page and its media stop. */
function remove(tabId: string) {
  if (!pages()[tabId]) return;
  const { [tabId]: _gone, ...rest } = pages();
  webkitTabs.setState(rest, true);
  void closeWebKitPage(tabId).catch(() => {});
}

export const webKitTab = (tabId: string): WebKitTab | undefined => pages()[tabId];

/**
 * Connects a window: its snapshot shows its WebKit tabs, and its tabs move to
 * WebKit when they reach a WebKit site. Returns the disconnect.
 */
export function attachWebKit(store: BrowserStore, engine: EngineClient, openTab: (url: string) => void) {
  const cache = overlayCache();
  store.overlay = snapshot => overlaySnapshot(snapshot, pages(), cache);
  windows.set(store.windowId, { store, engine, openTab });
  listenToPages();
  if (!autoPipRead) {
    autoPipRead = true;
    void engine.request('settings.get', {}).then(p => followAutoPip(p.autoPip), () => { autoPipRead = false; });
  }
  const run = () => reconcile(store, engine);
  const offPrivate = followPrivateWindow(store);
  const offStore = store.subscribe((s, previous) => { if (s.engineSnapshot !== previous.engineSnapshot) run(); });
  const offPages = webkitTabs.subscribe(() => { refreshOverlay(store); showIcons(store); });
  const offPrefs = shellPrefs.subscribe((s, previous) => {
    if (s.siteEngines !== previous.siteEngines || s.protectedVideoInWebKit !== previous.protectedVideoInWebKit) run();
  });
  void loadEnginePrefs().then(() => { prefsReady = true; run(); });
  refreshOverlay(store);
  run();
  return () => {
    offStore(); offPages(); offPrefs(); offPrivate();
    windows.delete(store.windowId);
    store.overlay = snapshot => snapshot;
    pruneLater();
  };
}

/**
 * Tells WebKit's pages Settings › General › Automatic Picture in Picture.
 * Read once when the first window connects, and again whenever
 * Settings changes it. Chromium keeps the setting (merlin.auto_pip); until
 * it is read, WebKit uses its default, on. Undefined: not offered here.
 */
export function followAutoPip(on: boolean | undefined) {
  if (on === undefined || unavailable) return;
  try {
    void setWebKitAutoPip(on).catch(() => {});
  } catch {
    unavailable = true;
  }
}

/**
 * Tells WebKit while this window is a private one. WebKit's private session
 * (its sign-ins and site data) lasts while any private window is open, as
 * Chromium's does, and ends with the last. Returns the window's closing.
 */
function followPrivateWindow(store: BrowserStore): () => void {
  let registered = false;
  const check = () => {
    if (registered || unavailable || store.getState().engineSnapshot?.private !== true) return;
    registered = true;
    try {
      void setPrivateWindow(store.windowId, true).catch(() => {});
    } catch {
      unavailable = true;
    }
  };
  const off = store.subscribe(check);
  check();
  return () => {
    off();
    if (!registered) return;
    try {
      void setPrivateWindow(store.windowId, false).catch(() => {});
    } catch { /* Without the module there are no private WebKit pages. */ }
  };
}

/** Applies the rules to every tab in the window's latest Chromium snapshot. */
function reconcile(store: BrowserStore, engine: EngineClient) {
  const snapshot = store.getState().engineSnapshot;
  if (!snapshot || unavailable) return;
  const now = Date.now();
  const activeSplit = snapshot.tabs.find(t => t.id === snapshot.activeTabId)?.split;
  for (const tab of snapshot.tabs) {
    if (tab.sharedFrom) continue;
    const wk = pages()[tab.id];
    if (wk && wk.windowId !== store.windowId) patch(tab.id, { windowId: store.windowId });
    if (!wk && !prefsReady) continue;
    const visible = tab.id === snapshot.activeTabId || (!!activeSplit && activeSplit === tab.split);
    if (wk?.asleep) {
      if (visible) {
        if (engineOf(wk.url) === 'webkit') {
          patch(tab.id, { asleep: false, loading: true });
          void loadWebKitPage(tab.id, wk.url, snapshot.private).catch(() => {});
        } else {
          remove(tab.id);
          void engine.call('navigation.open', { tabId: tab.id, text: wk.url }).catch(() => {});
        }
      }
      continue;
    }
    if (tab.pinned && tab.discarded && !visible) {
      // Keep the address and icon in the pin while the actual WebKit page is gone.
      if (wk) {
        patch(tab.id, { asleep: true, loading: false, crashed: false, canGoBack: false, canGoForward: false });
        void closeWebKitPage(tab.id).catch(() => {});
      }
      continue;
    }
    const step = decide(tab, wk, engineOf, now);
    switch (step.kind) {
      case 'open': open(store, engine, tab.id, step.url, snapshot.private); break;
      case 'settle': patch(tab.id, { base: step.base }); break;
      case 'leave':
        patch(tab.id, { leavingSince: now, leaveTries: (wk?.leaveTries ?? 0) + 1 });
        void (step.how === 'back' ? engine.call('navigation.back', { tabId: tab.id })
          : step.how === 'stop' ? engine.call('navigation.stop', { tabId: tab.id })
          : engine.call('navigation.open', { tabId: tab.id, text: 'about:blank' })).catch(() => {});
        recheckLater(store, engine);
        break;
      case 'follow':
        void loadWebKitPage(tab.id, step.url, snapshot.private).catch(() => {});
        patch(tab.id, { url: step.url, base: null, leavingSince: now, leaveTries: 0 });
        void leave(store, engine, tab.id);
        break;
      case 'close': remove(tab.id); break;
      case 'migrate':
        remove(tab.id);
        if (step.url !== tab.url) void engine.call('navigation.open', { tabId: tab.id, text: step.url }).catch(() => {});
        break;
      case 'restore': restore(store, tab.id, tab.url, step.url, step.title, snapshot.private); break;
      case 'decline':
        if (declined.has(tab.id)) break;
        declined.add(tab.id);
        void engine.call('tabs.setEngineOverlay', { tabId: tab.id, overlay: null })
          .then(() => engine.call('navigation.open', { tabId: tab.id, text: step.url })).catch(() => {})
          .finally(() => declined.delete(tab.id));
        break;
      default: break;
    }
  }
  pruneLater();
}

/** Restored tabs whose WebKit page now loads in Chromium, while that is under way. */
const declined = new Set<string>();

/**
 * A tab the session restored showing `url` in WebKit: it shows there again,
 * over the page Chromium restored behind it, which it needn't leave.
 */
function restore(store: BrowserStore, tabId: string, base: string, url: string, title: string, ephemeral: boolean) {
  webkitTabs.setState({ [tabId]: {
    url, title, loading: true, canGoBack: false, canGoForward: false, crashed: false,
    windowId: store.windowId, base, leavingSince: Date.now(), leaveTries: 0,
  } });
  loadWebKitPage(tabId, url, ephemeral).catch(() => {
    unavailable = true;
    remove(tabId);
  });
}

/** What native code was last told each WebKit tab shows, and that tab's window. */
const told = new Map<string, { key: string; windowId: string }>();

/**
 * Tells native code what each WebKit tab shows, so its bookmarks, workspaces,
 * browserctl and session restore use WebKit's page rather than Chromium's
 * hidden one; and when a tab shows Chromium's page again.
 */
function tellNative() {
  const all = pages();
  for (const [tabId, wk] of Object.entries(all)) {
    const overlay = engineOverlay(wk);
    if (!overlay) continue;
    const key = `${overlay.url}\n${overlay.title}\n${wk.windowId}`;
    if (told.get(tabId)?.key === key) continue;
    const window = windows.get(wk.windowId);
    if (!window) continue;
    told.set(tabId, { key, windowId: wk.windowId });
    void window.engine.call('tabs.setEngineOverlay', { tabId, overlay }).catch(() => {});
  }
  for (const [tabId, { windowId }] of told) {
    if (all[tabId]) continue;
    told.delete(tabId);
    // The tab may have closed; then there is nothing to tell.
    void windows.get(windowId)?.engine.call('tabs.setEngineOverlay', { tabId, overlay: null }).catch(() => {});
  }
}

function open(store: BrowserStore, engine: EngineClient, tabId: string, url: string, ephemeral: boolean) {
  webkitTabs.setState({ [tabId]: {
    url, title: '', loading: true, canGoBack: false, canGoForward: false, crashed: false,
    windowId: store.windowId, base: null, leavingSince: Date.now(), leaveTries: 0,
  } });
  loadWebKitPage(tabId, url, ephemeral).catch(() => {
    // An older shell without the module: say so once and leave pages in Chromium.
    unavailable = true;
    remove(tabId);
    showStatusMessage(store, 'This copy of Merlin can’t open pages in WebKit, so protected video won’t play.');
  });
  void leave(store, engine, tabId);
}

/**
 * Starts moving Chromium's own tab off the site. A navigation Chromium
 * hasn't committed yet just stops, and its tab stays on the page before;
 * one it has committed goes back to that page once it has loaded, or to a
 * blank page in a tab that has none (decide(), step "leave"). That page
 * waits behind WebKit's, and Back on WebKit's first page shows it.
 */
async function leave(store: BrowserStore, engine: EngineClient, tabId: string) {
  try {
    await engine.call('navigation.stop', { tabId });
    acceptSnapshot(store, await engine.call('window.snapshot', {}));
  } catch {
    // The tab closed meanwhile, or the window did.
  }
  recheckLater(store, engine);
}

/** Chromium may send nothing more while the shell waits on it; look again regardless. */
function recheckLater(store: BrowserStore, engine: EngineClient) {
  setTimeout(() => { if (windows.has(store.windowId)) reconcile(store, engine); }, leaveTimeoutMs + recheckSlackMs);
}

let pruneTimer: ReturnType<typeof setTimeout> | null = null;
/** Closes the pages of tabs no window has any more. */
function pruneLater() {
  if (pruneTimer) return;
  pruneTimer = setTimeout(() => {
    pruneTimer = null;
    const open = new Set<string>();
    for (const { store } of windows.values()) for (const t of store.getState().engineSnapshot?.tabs ?? []) open.add(t.id);
    for (const tabId of Object.keys(pages())) if (!open.has(tabId)) remove(tabId);
  }, closedTabGraceMs);
}

/** WebKit's icons, under the favicon keys its tabs show. */
function showIcons(store: BrowserStore) {
  const known = store.getState().favicons;
  for (const wk of Object.values(pages()))
    if (wk.windowId === store.windowId && wk.faviconKey && wk.favicon && !known[wk.faviconKey]) rememberFavicon(store, wk.faviconKey, wk.favicon);
}

let telling = false;
function listenToPages() {
  if (!telling) {
    telling = true;
    webkitTabs.subscribe(tellNative);
  }
  if (stopListening) return;
  try {
    stopListening = subscribeWebKit(onPageEvent);
  } catch {
    unavailable = true;
  }
}

function onPageEvent(event: WebKitEvent) {
  const tabId = event.type === 'pageState' ? event.state.tabId : event.tabId;
  const wk = pages()[tabId];
  if (!wk || wk.asleep) return;
  const window = windows.get(wk.windowId);
  switch (event.type) {
    case 'pageState': {
      const s = event.state;
      patch(tabId, {
        url: s.url || wk.url, title: s.title, loading: s.loading, canGoBack: s.canGoBack, canGoForward: s.canGoForward,
        crashed: s.crashed, color: s.color, surface: s.surface, favicon: s.favicon,
        faviconKey: s.favicon ? (s.favicon === wk.favicon && wk.faviconKey ? wk.faviconKey : iconKey(s.favicon)) : undefined,
      });
      break;
    }
    case 'openTab':
      if (!window) break;
      if (event.download) showStatusMessage(window.store, 'Pages in WebKit can’t download files. Open the site in Chromium to download it.', false);
      else if (event.peek || event.groupLink) {
        void window.engine.call('tabs.create', { url: event.url, ...(event.peek ? { peek: true } : { opener: tabId }) })
          .catch(error => showStatusMessage(window.store, String(error)));
      } else window.openTab(event.url);
      break;
    case 'toolbarDirection': patch(tabId, { toolbarHidden: event.down }); break;
    case 'pageKey': runPageCommand(tabId, event.command); break;
    case 'reopenTab':
      if (window?.store.getState().snapshot?.activeTabId === tabId) {
        void window.engine.call('modal.command', { text: 'tabrestore' }).catch(error => showStatusMessage(window.store, String(error)));
      }
      break;
    case 'pageError': if (window) showStatusMessage(window.store, event.message); break;
    default: break;
  }
}

/**
 * Back, Forward, Reload and Stop on a WebKit tab. False when the tab isn't
 * one, so the caller asks Chromium instead.
 */
export function runPageCommand(tabId: string, command: WebKitCommand): boolean {
  const wk = pages()[tabId];
  if (!wk) return false;
  if (command === 'back' && !wk.canGoBack) {
    // WebKit's first page: Back shows the page Chromium has behind it.
    if (backLeavesWebKit(wk)) remove(tabId);
    return true;
  }
  if (command === 'forward' && !wk.canGoForward) return true;
  void webKitCommand(tabId, command).catch(() => {});
  return true;
}

/**
 * An address typed or chosen for a WebKit tab. A WebKit site loads in its
 * page; anything else leaves WebKit, and the caller asks Chromium. True when
 * WebKit took it.
 */
export function navigateWebKitTab(tabId: string, url: string | null, ephemeral: boolean): boolean {
  const wk = pages()[tabId];
  if (!wk) return false;
  if (url && engineOf(url) === 'webkit') {
    void loadWebKitPage(tabId, url, ephemeral).then(() => focusWebKitPage(tabId)).catch(() => {});
    patch(tabId, { url });
    return true;
  }
  remove(tabId);
  return false;
}

/**
 * The tab menu's "Open in WebKit" or "Open in Chromium": the tab's site
 * moves, and stays moved. Returns whether anything changed.
 */
export async function moveSite(url: string, to: PageEngine) {
  const site = siteOf(url);
  if (!site) return false;
  // The new choice reaches every tab on the site in every window (attachWebKit's preference watch).
  await setSiteEngine(site, to);
  return true;
}
