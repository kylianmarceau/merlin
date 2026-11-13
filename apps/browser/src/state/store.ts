// One store per window. Chromium owns browser state and sends it as
// snapshots; the store adds only what the shell itself decides: which panel
// or popover is open, notices, address suggestions, icons and anchor places.
import { createStore } from 'zustand/vanilla';
import { validateSnapshot, type EngineClient, type PanelName, type Snapshot, type Suggestion } from '../platform/protocol';

export type Panel = 'settings' | 'history' | 'bookmarks' | 'downloads' | 'command' | 'newTab' | null;
export type PopoverName = 'extensions' | 'profiles' | 'downloads';
/** Places popovers attach to. Toolbar and sidebar controls report their frames. */
export type AnchorName = 'site' | 'requests' | 'extensions' | 'downloads' | 'profiles' | 'address';
export type Rect = { x: number; y: number; width: number; height: number };
export type Toast = { id: number; tone: 'error' | 'info'; text: string };
/**
 * `selected` is the highlighted suggestion; -1 means what was typed. `owner`
 * is the field that asked: the toolbar's address field shows its list under
 * itself; the start page and the new-tab pop-up show theirs in place.
 */
export type SearchOwner = 'address' | 'search';
export type Omnibox = { queryId: string; text: string; items: Suggestion[]; selected: number; owner: SearchOwner };

export type BrowserState = {
  snapshot: Snapshot | null;
  connectionError: string | null;
  panel: Panel;
  popover: PopoverName | null;
  /** A quiet request the person chose to see. */
  revealedPromptId: string | null;
  toasts: Toast[];
  addressFocus: number;
  addressRevert: number;
  omnibox: Omnibox | null;
  /** Icon data URLs by favicon key. */
  favicons: Record<string, string>;
  anchors: Partial<Record<AnchorName, Rect>>;
  windowSize: { width: number; height: number };
};

export function initialState(): BrowserState {
  return {
    snapshot: null, connectionError: null, panel: null, popover: null, revealedPromptId: null, toasts: [],
    addressFocus: 0, addressRevert: 0, omnibox: null, favicons: {}, anchors: {}, windowSize: { width: 0, height: 0 },
  };
}

export function createBrowserStore(windowId: string) {
  const store = createStore<BrowserState>()(() => initialState());
  return Object.assign(store, { windowId });
}
export type BrowserStore = ReturnType<typeof createBrowserStore>;

/** Applies a snapshot unless an equal or newer one from this session is already shown. */
export function acceptSnapshot(store: BrowserStore, input: unknown) {
  const next = validateSnapshot(input, store.windowId);
  const current = store.getState().snapshot;
  if (current && current.session === next.session && current.revision >= next.revision) return;
  store.setState({ snapshot: current ? shareUnchanged(current, next) : next, connectionError: null });
}

/**
 * Keeps the previous objects for tabs and downloads that did not change, so
 * memoized rows skip rendering: a snapshot arrives whenever any tab loads,
 * retitles or a download moves, but usually only one row changed.
 */
export function shareUnchanged(previous: Snapshot, next: Snapshot): Snapshot {
  const reuse = <T extends { id: string }>(old: T[], fresh: T[]) => {
    const byId = new Map(old.map(item => [item.id, item]));
    let same = old.length === fresh.length;
    const merged = fresh.map((item, i) => {
      const before = byId.get(item.id);
      const kept = before && shallowEqual(before, item) ? before : item;
      if (kept !== old[i]) same = false;
      return kept;
    });
    return same ? old : merged;
  };
  return { ...next, tabs: reuse(previous.tabs, next.tabs), downloads: reuse(previous.downloads, next.downloads) };
}
function shallowEqual(a: object, b: object) {
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every(k => x[k] === y[k]);
}

let toastCounter = 0;
export function pushToast(store: BrowserStore, text: string, tone: Toast['tone'] = 'error') {
  const id = ++toastCounter;
  // The newest three; an identical notice replaces its older copy.
  store.setState(s => ({ toasts: [...s.toasts.filter(t => t.text !== text), { id, tone, text }].slice(-3) }));
  return id;
}
export function dismissToast(store: BrowserStore, id: number) {
  store.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
}

/** Native requests to open a panel. Extensions and profiles are popovers in this shell. */
export function openNativePanel(store: BrowserStore, panel: PanelName) {
  if (panel === 'extensions' || panel === 'profiles') store.setState({ popover: panel, panel: null });
  // Command-T again while the pop-up is open asks its field for the focus.
  else if (panel === 'newTab') store.setState(s => ({ panel, popover: null, addressFocus: s.panel === 'newTab' ? s.addressFocus + 1 : s.addressFocus }));
  else store.setState({ panel, popover: null });
}

const faviconLimit = 300;
export function rememberFavicon(store: BrowserStore, key: string, url: string) {
  store.setState(s => {
    const keys = Object.keys(s.favicons);
    const kept = keys.length >= faviconLimit ? Object.fromEntries(keys.slice(-faviconLimit / 2).map(k => [k, s.favicons[k]])) : s.favicons;
    return { favicons: { ...kept, [key]: url } };
  });
}

export function attachEngine(store: BrowserStore, engine: EngineClient) {
  let disposed = false;
  const fail = (e: unknown) => {
    if (disposed) return;
    const message = e instanceof Error ? e.message : String(e);
    if (store.getState().snapshot) pushToast(store, message);
    else store.setState({ connectionError: message });
  };
  // Subscribe before reading, so a tab event cannot fall between snapshot and subscription.
  const unsubscribe = engine.subscribe(event => {
    if (disposed) return;
    try {
      switch (event.type) {
        case 'snapshot': acceptSnapshot(store, event.snapshot); break;
        case 'address.focus': store.setState(s => ({ addressFocus: s.addressFocus + 1 })); break;
        case 'address.revert': store.setState(s => ({ addressRevert: s.addressRevert + 1, omnibox: null })); break;
        case 'command.open': store.setState({ panel: 'command', popover: null }); break;
        case 'panel.open': openNativePanel(store, event.panel); break;
        case 'omnibox.results': {
          const current = store.getState().omnibox;
          // Results for an older query never replace newer ones.
          if (current && current.queryId === event.queryId)
            store.setState({ omnibox: { ...current, items: event.items, selected: Math.min(current.selected, event.items.length - 1) } });
          break;
        }
        case 'engine.error': pushToast(store, event.message); break;
        default: break;
      }
    } catch (e) { fail(e); }
  });
  void engine.call('window.snapshot', {}).then(snapshot => {
    if (!disposed) acceptSnapshot(store, snapshot);
  }).catch(fail);
  return () => { disposed = true; unsubscribe(); };
}
