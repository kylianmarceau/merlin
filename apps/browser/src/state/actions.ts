// Everything a window's components can ask for. Components never hold the
// engine or call getState(); they call these, and failures become notices.
import { copyText, showMenu, type MenuItem } from '../platform/shell';
import { shellPrefs } from './shellPrefs';
import { canUseWebKit } from '../lib/engines';
import { tabDropZone } from './tabDrag';
import { moveSite, navigateWebKitTab, runPageCommand } from './webkit';
import type { Appearance, Calls, DownloadAction, EngineClient, Method, Request, Requests } from '../platform/protocol';
import {
  dismissToast, pushToast, rememberFavicon, type AnchorName, type BrowserStore, type Panel, type PopoverName, type Rect,
  type SearchOwner,
} from './store';

let queryCounter = 0;
/** How soon after an outside press closes a popover its own button is ignored. */
const reopenGuardMs = 400;

export function createActions(store: BrowserStore, engine: EngineClient) {
  const fail = (e: unknown) => { pushToast(store, e instanceof Error ? e.message : String(e)); };
  /** Runs a browser command; false (with a notice) when it fails. */
  async function run<M extends Method>(method: M, args: Calls[M]['args']) {
    try { await engine.call(method, args); return true; } catch (e) { fail(e); return false; }
  }
  const active = () => {
    const s = store.getState().snapshot;
    return s?.tabs.find(t => t.id === s.activeTabId);
  };
  const isPrivate = () => store.getState().snapshot?.private ?? false;
  /**
   * Where typed text or a suggestion goes in the active tab when it shows
   * WebKit: true when WebKit loaded it, false when Chromium should (the tab
   * then leaves WebKit). `url` is null when only Chromium can tell.
   */
  const webKitTakes = (url: string | null, newTab: boolean) => {
    const t = active();
    return !newTab && t?.engine === 'webkit' && navigateWebKitTab(t.id, url, isPrivate());
  };
  const faviconLoads = new Set<string>();
  let lastClosed: { name: PopoverName | null; at: number } = { name: null, at: 0 };

  const actions = {
    // Browser requests that answer later (settings, history, bookmarks…).
    request<R extends Request>(method: R, args: Requests[R]['args'], timeoutMs?: number) {
      return engine.request(method, args, timeoutMs);
    },

    // Tabs.
    newTab: (url?: string) => run('tabs.create', url ? { url } : {}),
    /** The New Tab buttons: a pop-up over the page when Settings asks for one, otherwise a blank tab. */
    openNewTab() {
      const s = store.getState();
      if (shellPrefs.getState().newTabPopup && s.snapshot?.tabs.length)
        store.setState(state => ({ panel: 'newTab', popover: null, addressFocus: state.addressFocus + 1 }));
      else void actions.newTab();
    },
    activateTab: (tabId: string) => run('tabs.activate', { tabId }),
    closeTab: (tabId: string) => run('tabs.close', { tabId }),
    pinTab: (tabId: string, pinned: boolean) => run('tabs.pin', { tabId, pinned }),
    moveTab: (tabId: string, beforeId: string | null) => run('tabs.move', { tabId, beforeId }),
    bookmarkTab: (tabId: string) => run('tabs.bookmark', { tabId }),
    /** Shows the tab beside the current one in a split view. */
    splitTab: (tabId: string, side: 'left' | 'right' = 'right') => run('tabs.split', { tabId, side }),
    /** Moves the tab into a window of its own, under the pointer. */
    detachTab: (tabId: string) => run('tabs.detach', { tabId }),
    /**
     * A tab being dragged, the pointer at (x, y) in the window. `out` is set
     * once it has left the tabs (the strip or sidebar decides); outside the
     * window always counts. Out of the tabs it has a drop zone on the page.
     * Returns whether it is out of the tabs.
     */
    tabDragMove(tabId: string, x: number, y: number, out: boolean) {
      const s = store.getState();
      const snap = s.snapshot;
      const { width, height } = s.windowSize;
      const outside = out || x < 0 || y < 0 || x > width || y > height;
      if (!snap) return outside;
      const popup = snap.kind === 'popup';
      const zone = outside ? tabDropZone({ x, y, window: s.windowSize, page: s.anchors.page,
        canSplit: !popup && !!snap.activeTabId && tabId !== snap.activeTabId, canDetach: !popup && snap.tabs.length > 1 }) : null;
      const old = s.tabDrag;
      if (!(old && old.tabId === tabId && old.x === x && old.y === y && old.out === outside && old.zone === zone))
        store.setState({ tabDrag: { tabId, x, y, out: outside, zone } });
      return outside;
    },
    /** A tab drag that ended without being let go (the gesture was taken away). */
    tabDragCancel() {
      if (store.getState().tabDrag) store.setState({ tabDrag: null });
    },
    /**
     * The dragged tab was let go. Out of the tabs it goes to its drop zone
     * (beside the current tab, or a new window) and true is returned, so the
     * tabs don't also reorder; inside them, false.
     */
    tabDragEnd() {
      const drag = store.getState().tabDrag;
      if (drag) store.setState({ tabDrag: null });
      if (!drag?.out) return false;
      if (drag.zone === 'window') void actions.detachTab(drag.tabId);
      else if (drag.zone) void actions.splitTab(drag.tabId, drag.zone);
      return true;
    },
    /** The bookmarks bar's contents: the first of Chromium's permanent folders. */
    async bookmarksBar() {
      const root = await engine.request('bookmarks.folder', {});
      const bar = root.items.find(item => item.folder);
      return bar ? (await engine.request('bookmarks.folder', { folderId: bar.id })).items : [];
    },
    openBookmark(url: string, newTab: boolean) {
      const t = active();
      if (newTab || !t) return actions.newTab(url);
      if (webKitTakes(url, false)) return Promise.resolve(true);
      return run('navigation.open', { tabId: t.id, text: url });
    },
    /** A bookmarks-bar folder as a native menu, two levels deep; choosing opens the bookmark. */
    async bookmarkFolderMenu(folderId: string) {
      const urls = new Map<string, string>();
      const level = async (id: string, depth: number): Promise<MenuItem[]> => {
        const { items } = await engine.request('bookmarks.folder', { folderId: id });
        if (!items.length) return [{ id: 'empty', title: 'Empty', enabled: false }];
        return Promise.all(items.map(async item => {
          if (item.folder) return depth < 2 ? { title: item.title, symbol: 'folder' as const, children: await level(item.id, depth + 1) }
            : { id: `folder:${item.id}`, title: item.title, enabled: false };
          urls.set(item.id, item.url ?? '');
          return { id: item.id, title: item.title || item.domain || item.url || 'Bookmark' };
        }));
      };
      try {
        const choice = await showMenu(await level(folderId, 0));
        const url = choice ? urls.get(choice) : undefined;
        if (url) await actions.openBookmark(url, false);
      } catch (e) { fail(e); }
    },
    async bookmarkMenu(item: { id: string; url?: string; editable: boolean }, onChanged: () => void) {
      const choice = await showMenu([
        ...(item.url ? [{ id: 'open', title: 'Open' }, { id: 'tab', title: 'Open in New Tab' }, { id: 'copy', title: 'Copy Address' },
          { separator: true as const }] : []),
        { id: 'remove', title: 'Delete', enabled: item.editable, destructive: true },
      ]);
      if (choice === 'open' && item.url) return actions.openBookmark(item.url, false);
      if (choice === 'tab' && item.url) return actions.openBookmark(item.url, true);
      if (choice === 'copy' && item.url) return actions.copyAddress(item.url);
      if (choice === 'remove') {
        try { await engine.request('bookmarks.remove', { id: item.id }); onChanged(); } catch (e) { fail(e); }
      }
    },
    async copyAddress(url: string) {
      try { await copyText(url); pushToast(store, 'Address copied', 'info'); } catch (e) { fail(e); }
    },
    async tabMenu(tabId: string) {
      const tabs = store.getState().snapshot?.tabs ?? [];
      const index = tabs.findIndex(t => t.id === tabId);
      const tab = tabs[index];
      if (!tab) return;
      const previous = tabs[index - 1];
      const next = tabs[index + 1];
      const others = tabs.filter(t => t.id !== tabId && !t.pinned);
      // Plain words, like the rest of the menu bar; the tab's own title says which tab.
      const items: MenuItem[] = [
        { id: 'pin', title: tab.pinned ? 'Unpin Tab' : 'Pin Tab' },
        { id: 'duplicate', title: 'Duplicate Tab', enabled: !!tab.url },
        { id: 'bookmark', title: 'Bookmark Page…', enabled: tab.id === store.getState().snapshot?.activeTabId },
        // Sites Chromium can't play open in WebKit; either can show any site.
        ...(canUseWebKit(tab.url) ? [tab.engine === 'webkit'
          ? { id: 'chromium', title: 'Open Site in Chromium' } : { id: 'webkit', title: 'Open Site in WebKit' }] : []),
        { separator: true },
        { id: 'split', title: 'Open in Split View', enabled: tab.id !== store.getState().snapshot?.activeTabId,
          symbol: 'rectangle.split.2x1' },
        { id: 'window', title: 'Move to New Window', enabled: tabs.length > 1, symbol: 'arrow.up.forward.app' },
        { separator: true },
        { id: 'up', title: 'Move Up', enabled: !!previous && previous.pinned === tab.pinned },
        { id: 'down', title: 'Move Down', enabled: !!next && next.pinned === tab.pinned },
        { separator: true },
        { id: 'close', title: 'Close Tab' },
        { id: 'others', title: 'Close Other Tabs', enabled: others.length > 0 },
      ];
      let choice: string | null;
      try { choice = await showMenu(items); } catch (e) { fail(e); return; }
      switch (choice) {
        case 'pin': await actions.pinTab(tabId, !tab.pinned); break;
        case 'duplicate': await actions.newTab(tab.url); break;
        case 'bookmark': await actions.bookmarkTab(tabId); break;
        case 'webkit': case 'chromium':
          try { await moveSite(engine, tabId, tab.url, choice); } catch (e) { fail(e); }
          break;
        case 'split': await actions.splitTab(tabId); break;
        case 'window': await actions.detachTab(tabId); break;
        case 'up': if (previous) await actions.moveTab(tabId, previous.id); break;
        case 'down': await actions.moveTab(tabId, tabs[index + 2]?.id ?? null); break;
        case 'close': await actions.closeTab(tabId); break;
        case 'others': for (const t of others) if (!(await actions.closeTab(t.id))) break; break;
        default: break;
      }
    },

    /** The address's button on a WebKit tab: what WebKit is for, and the way back to Chromium. */
    async engineMenu() {
      const tab = active();
      if (!tab || tab.engine !== 'webkit') return;
      const items: MenuItem[] = [
        { id: 'about', title: 'Shown in WebKit, which plays protected video', enabled: false, symbol: 'safari' },
        { id: 'signins', title: 'WebKit keeps its own sign-ins', enabled: false },
        { separator: true },
        { id: 'chromium', title: 'Open Site in Chromium' },
      ];
      let choice: string | null;
      try { choice = await showMenu(items); } catch (e) { fail(e); return; }
      if (choice === 'chromium') {
        try { await moveSite(engine, tab.id, tab.url, 'chromium'); } catch (e) { fail(e); }
      }
    },

    /** The tabs that no longer fit across the top, as a native menu; the chosen one becomes active. */
    async hiddenTabsMenu(tabIds: string[]) {
      const tabs = store.getState().snapshot?.tabs ?? [];
      const items: MenuItem[] = tabIds.flatMap(id => {
        const tab = tabs.find(t => t.id === id);
        return tab ? [{ id: tab.id, title: tab.title || tab.url || 'New Tab' }] : [];
      });
      if (!items.length) return;
      let choice: string | null;
      try { choice = await showMenu(items); } catch (e) { fail(e); return; }
      if (choice) await actions.activateTab(choice);
    },

    // The active page.
    // A tab shown in WebKit goes to its WebKit page instead (state/webkit.ts).
    back: () => {
      const t = active();
      if (!t) return Promise.resolve(false);
      return runPageCommand(t.id, 'back') ? Promise.resolve(true) : run('navigation.back', { tabId: t.id });
    },
    forward: () => {
      const t = active();
      if (!t) return Promise.resolve(false);
      return runPageCommand(t.id, 'forward') ? Promise.resolve(true) : run('navigation.forward', { tabId: t.id });
    },
    reloadTab: (tabId: string) => (runPageCommand(tabId, 'reload') ? Promise.resolve(true) : run('navigation.reload', { tabId })),
    reloadOrStop: () => {
      const t = active();
      if (!t) return Promise.resolve(false);
      const command = t.loading ? 'stop' : 'reload';
      return runPageCommand(t.id, command) ? Promise.resolve(true) : run(t.loading ? 'navigation.stop' : 'navigation.reload', { tabId: t.id });
    },
    openInTab: (tabId: string, text: string) => {
      const t = store.getState().snapshot?.tabs.find(x => x.id === tabId);
      if (t?.engine === 'webkit' && navigateWebKitTab(tabId, addressUrl(text), isPrivate())) return Promise.resolve(true);
      return run('navigation.open', { tabId, text });
    },
    siteInfo: () => run('site.info', {}),

    // The address field. Suggestions arrive as events for the latest query.
    suggest(text: string, preventInline: boolean, owner: SearchOwner = 'address') {
      if (!text.trim()) { actions.stopSuggesting(); return; }
      const queryId = `q${(++queryCounter).toString(36)}`;
      const current = store.getState().omnibox;
      store.setState({ omnibox: { queryId, text, items: current?.owner === owner ? current.items : [], selected: -1, owner } });
      void engine.call('omnibox.query', { queryId, text, preventInline }).catch(fail);
    },
    stopSuggesting() {
      if (!store.getState().omnibox) return;
      store.setState({ omnibox: null });
      void engine.call('omnibox.stop', {}).catch(() => {});
    },
    moveSuggestion(delta: number) {
      const omnibox = store.getState().omnibox;
      if (!omnibox || !omnibox.items.length) return;
      // A default top suggestion already shows as highlighted while nothing
      // is chosen, so moving starts from it and never goes above it.
      const top = omnibox.items[0]?.default ? 0 : -1;
      const from = Math.max(top, omnibox.selected);
      const selected = Math.max(top, Math.min(omnibox.items.length - 1, from + delta));
      store.setState({ omnibox: { ...omnibox, selected } });
    },
    async openSuggestion(index: number, newTab: boolean) {
      const omnibox = store.getState().omnibox;
      if (!omnibox) return false;
      store.setState({ omnibox: null });
      if (webKitTakes(omnibox.items[index]?.url ?? null, newTab)) return true;
      return run('omnibox.open', { queryId: omnibox.queryId, index, newTab });
    },
    async submitAddress(text: string, newTab: boolean) {
      const omnibox = store.getState().omnibox;
      store.setState({ omnibox: null });
      // Enter takes the default suggestion, as Chromium does; without one only Chromium knows.
      const top = omnibox?.items[0];
      // Settings › General › When input looks like a website: Prefer Search Engine searches
      // for "example.com" rather than opening it. A typed scheme ("https://…") still opens.
      if (omnibox && top?.default && top.kind === 'url' && shellPrefs.getState().searchPreference === 'search'
        && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text.trim())) {
        const search = omnibox.items.findIndex(item => item.kind === 'search');
        if (search >= 0) return run('omnibox.open', { queryId: omnibox.queryId, index: search, newTab });
      }
      if (webKitTakes(top?.default ? top.url : addressUrl(text), newTab)) return true;
      return run('omnibox.enter', { ...(omnibox ? { queryId: omnibox.queryId } : {}), text, newTab });
    },

    // Icons, fetched once per favicon key.
    loadFavicon(tabId: string, key: string) {
      // WebKit's icons come with its pages (state/webkit.ts), not from Chromium.
      if (!key || key.startsWith('webkit:') || store.getState().favicons[key] || faviconLoads.has(key)) return;
      faviconLoads.add(key);
      engine.call('favicons.get', { tabId }).then(icon => {
        if (icon) rememberFavicon(store, icon.key, icon.url);
      }, () => {}).finally(() => faviconLoads.delete(key));
    },

    // Panels and popovers.
    openPanel: (panel: Panel) => store.setState({ panel, popover: null }),
    closePanel: () => store.setState({ panel: null }),
    togglePopover(popover: PopoverName) {
      const s = store.getState();
      const showing = s.popover ?? (s.snapshot?.extensionPopup ? 'extensions' : null);
      if (showing === popover) { actions.closePopover(); return; }
      // The press that closed this popover from outside also lands on its
      // button; it must not open it again.
      if (lastClosed.name === popover && Date.now() - lastClosed.at < reopenGuardMs) return;
      store.setState({ popover });
    },
    closePopover() {
      const s = store.getState();
      const showing = s.popover ?? (s.snapshot?.extensionPopup ? 'extensions' : null);
      if (showing) lastClosed = { name: showing, at: Date.now() };
      if (s.snapshot?.extensionPopup) void engine.call('extensions.closePopup', {}).catch(fail);
      store.setState({ popover: null });
    },
    revealPrompt: (promptId: string) => store.setState({ revealedPromptId: promptId, popover: null }),
    setAnchor(name: AnchorName, rect: Rect) {
      const old = store.getState().anchors[name];
      if (old && old.x === rect.x && old.y === rect.y && old.width === rect.width && old.height === rect.height) return;
      store.setState(s => ({ anchors: { ...s.anchors, [name]: rect } }));
    },
    setWindowSize(width: number, height: number) {
      const old = store.getState().windowSize;
      if (old.width !== width || old.height !== height) store.setState({ windowSize: { width, height } });
    },
    dismissToast: (id: number) => dismissToast(store, id),
    notify: (text: string) => pushToast(store, text, 'info'),

    // Browser questions. Errors are returned so the prompt can show them in place.
    answerPrompt: (promptId: string, actionId: string, extra: { text?: string; suppress?: boolean }) =>
      engine.call('permissions.answer', { promptId, actionId, ...extra }),
    updatePromptText: (promptId: string, text: string) => engine.call('prompts.update', { promptId, text }),

    // Settings that live in the snapshot.
    setAppearance(patch: Partial<Appearance>) {
      const current = store.getState().snapshot?.appearance;
      return current ? run('appearance.set', { ...current, ...patch }) : Promise.resolve(false);
    },

    // Downloads.
    downloadAction: (downloadId: string, action: DownloadAction) => run('downloads.act', { downloadId, action }),
    openDownloadsFolder: () => run('downloads.openFolder', {}),
    /** A new download's icon reached the downloads button. */
    downloadLanded: () => store.setState(s => ({ downloadLandings: s.downloadLandings + 1 })),
    /** The downloads panel's Clear: forgets every download that is no longer arriving. */
    clearDownloads() {
      const done = (store.getState().snapshot?.downloads ?? []).filter(d => d.state !== 'progress');
      store.setState({ popover: null });
      return Promise.all(done.map(d => run('downloads.act', { downloadId: d.id, action: 'forget' })));
    },
    /** A download's right-click menu: what its row buttons do, and what the panel leaves out. */
    async downloadMenu(downloadId: string) {
      const d = store.getState().snapshot?.downloads.find(item => item.id === downloadId);
      if (!d) return;
      const status = d.status ?? (d.state === 'complete' ? 'done' : d.state === 'interrupted' ? 'failed' : d.state);
      const running = status === 'progress' || status === 'paused';
      const items: MenuItem[] = [
        { id: 'open', title: 'Open', enabled: status === 'done' },
        { id: 'show', title: 'Show in Finder', enabled: status === 'done' },
        ...(running ? [{ id: 'pause', title: status === 'paused' ? 'Resume' : 'Pause' }, { id: 'cancel', title: 'Cancel' }] : []),
        ...(status === 'failed' || status === 'cancelled' ? [{ id: 'retry', title: 'Try Again' }] : []),
        ...(status === 'dangerous' ? [{ id: 'discard', title: 'Discard', destructive: true }] : []),
        { separator: true },
        ...(d.url ? [{ id: 'copy', title: 'Copy Download Link' }] : []),
        { id: 'forget', title: 'Remove from List', enabled: !running },
        { separator: true },
        { id: 'folder', title: 'Open Downloads Folder' },
      ];
      const choice = await showMenu(items);
      if (choice === 'folder') return actions.openDownloadsFolder();
      if (choice === 'copy' && d.url) return copyText(d.url);
      if (choice) return run('downloads.act', { downloadId, action: choice as DownloadAction });
    },

    // Merlin commands and the command menu.
    command: (text: string) => run('modal.command', { text }),
    paletteKey: (key: 'accept' | 'cancel' | 'next' | 'previous') => run('modal.palette.key', { key }),
    paletteText: (text: string) => engine.call('modal.palette.text', { text }),
    paletteSelect: (index: number) => {
      const revision = store.getState().snapshot?.revision ?? 0;
      return run('modal.palette.select', { index, revision });
    },

    // Ctrl-Tab's cards.
    thumbnail: (tabId: string) => engine.call('tabs.thumbnail', { tabId }).catch(() => null),
    chooseSwitcherTab: (index: number) => run('switcher.choose', { index }),
    cancelSwitcher: () => run('switcher.cancel', {}),

    // Find in page.
    findQuery: (tabId: string, text: string, forward: boolean) => run('find.query', { tabId, text, forward }),
    findClose: () => run('find.close', {}),
    findFocus: (tabId: string, focused: boolean) => run('find.focus', { tabId, focused }),

    // Extensions: the popup appears in the snapshot once the extension opens one.
    async runExtension(id: string) {
      try { await engine.request('extensions.run', { id }); store.setState({ popover: null }); } catch (e) { fail(e); }
    },
  };
  return actions;
}
export type Actions = ReturnType<typeof createActions>;

/** A typed address that is plainly a web address ("https://…"), or null. */
function addressUrl(text: string): string | null {
  const trimmed = text.trim();
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}
