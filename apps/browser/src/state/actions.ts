// Everything a window's components can ask for. Components never hold the
// engine or call getState(); they call these, and failures become notices.
import { showMenu, type MenuItem } from '../platform/shell';
import { shellPrefs } from './shellPrefs';
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
        case 'up': if (previous) await actions.moveTab(tabId, previous.id); break;
        case 'down': await actions.moveTab(tabId, tabs[index + 2]?.id ?? null); break;
        case 'close': await actions.closeTab(tabId); break;
        case 'others': for (const t of others) if (!(await actions.closeTab(t.id))) break; break;
        default: break;
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
    back: () => { const t = active(); return t ? run('navigation.back', { tabId: t.id }) : Promise.resolve(false); },
    forward: () => { const t = active(); return t ? run('navigation.forward', { tabId: t.id }) : Promise.resolve(false); },
    reloadTab: (tabId: string) => run('navigation.reload', { tabId }),
    reloadOrStop: () => {
      const t = active();
      return t ? run(t.loading ? 'navigation.stop' : 'navigation.reload', { tabId: t.id }) : Promise.resolve(false);
    },
    openInTab: (tabId: string, text: string) => run('navigation.open', { tabId, text }),
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
      return run('omnibox.open', { queryId: omnibox.queryId, index, newTab });
    },
    async submitAddress(text: string, newTab: boolean) {
      const omnibox = store.getState().omnibox;
      store.setState({ omnibox: null });
      return run('omnibox.enter', { ...(omnibox ? { queryId: omnibox.queryId } : {}), text, newTab });
    },

    // Icons, fetched once per favicon key.
    loadFavicon(tabId: string, key: string) {
      if (!key || store.getState().favicons[key] || faviconLoads.has(key)) return;
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
