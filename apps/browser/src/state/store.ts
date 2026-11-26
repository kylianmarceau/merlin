// One store per window. Chromium owns browser state and sends it as
// snapshots; the store adds only what the shell itself decides: which panel
// or popover is open, notices, address suggestions, icons and anchor places.
// Tabs the shell shows in WebKit are drawn over Chromium's (state/webkit.ts):
// `snapshot` is what components show, `engineSnapshot` what Chromium sent.
import { createStore } from 'zustand/vanilla';
import { shellPrefs } from './shellPrefs';
import type { IconTone } from '../platform/shell';
import { validateSnapshot, type EngineClient, type HistorySwipe, type PanelName, type Snapshot, type SpaceCommand, type Suggestion } from '../platform/protocol';
import { acceptResults, type Omnibox } from './omnibox';
import { rememberActive, type TabDrag } from './tabDrag';
import type { GridZone } from './favouriteGrid';
import { dressSnapshot, type TabLooks } from './tabLooks';
import { spaceView } from './spaces';
import type { WorkspaceTheme } from './workspaceTheme';
import type { Tab } from '../platform/protocol';

/** `location` is ⌘L's centred field for the current tab (Settings › Appearance › ⌘L opens the command bar: In the centre). */
export type Panel = 'settings' | 'history' | 'bookmarks' | 'downloads' | 'command' | 'newTab' | 'location' | null;
export type PopoverName = 'extensions' | 'downloads';
/** Places popovers attach to. Toolbar and sidebar controls report their frames; `page` is where pages show, for dropping tabs. */
export type AnchorName = 'site' | 'requests' | 'extensions' | 'downloads' | 'address' | 'page';
export type Rect = { x: number; y: number; width: number; height: number };
/** A tab's hover card: which tab, where its row or tile is in the window, and which side the card opens on. */
export type HoverCard = { tabId: string; anchor: Rect; side: 'right' | 'below' };
/** Naming a tab group: a new one for `tabId`, or renaming `groupId`. */
export type GroupDialog = { kind: 'new'; tabId: string } | { kind: 'rename'; groupId: string } | { kind: 'renameTab'; tabId: string }
  | { kind: 'renameFolder'; folderId: string }
  /** Naming a new space (with the colour it will take), or renaming one. */
  | { kind: 'newSpace'; theme: WorkspaceTheme | null } | { kind: 'renameSpace'; spaceId: string };
export type StatusMessage = { text: string; isError: boolean };
export { currentSuggestions, type Omnibox, type SearchOwner } from './omnibox';

export type BrowserState = {
  /** What the window shows: Chromium's snapshot, with WebKit tabs as WebKit shows them. */
  snapshot: Snapshot | null;
  /** Chromium's own snapshot. */
  engineSnapshot: Snapshot | null;
  connectionError: string | null;
  panel: Panel;
  popover: PopoverName | null;
  /** A quiet request the person chose to see. */
  revealedPromptId: string | null;
  statusMessage: StatusMessage | null;
  addressFocus: number;
  addressRevert: number;
  omnibox: Omnibox | null;
  /** Icon data URLs by favicon key. */
  favicons: Record<string, string>;
  /** Whether each icon (by favicon key) is all one dark or light colour, so it can be drawn as a template where it would vanish. */
  iconTones: Record<string, IconTone>;
  anchors: Partial<Record<AnchorName, Rect>>;
  windowSize: { width: number; height: number };
  /** Counts new downloads' icons reaching the downloads button, which nudges each time. */
  downloadLandings: number;
  /** A tab being dragged, and where it would go if let go now. */
  tabDrag: TabDrag | null;
  /** Where each page on screen is, in the window, by tab: both sides of a split view, else the active tab's. */
  panes: Record<string, Rect>;
  /** Where the favourite tiles are, so a tab dragged from the list can be dropped among them to pin it. */
  favouriteZone: GridZone | null;
  /** A tab dragged from the list over the favourites, and the slot it would be pinned into. */
  pinDrop: { tabId: string; index: number } | null;
  /** Tabs most recently active first, for the tab a dragged tab splits with when it is the only one on screen. */
  recentTabs: string[];
  groupDialog: GroupDialog | null;
  /** A favourite folder opened to show its tiles, under its own tile. */
  openFolder: { folderId: string; anchor: Rect } | null;
  /** The card over a hovered tab (title, address, actions), as in Dia and Ardia. */
  hoverCard: HoverCard | null;
  /** The hidden tabs, slid in over the page because the pointer reached the window's edge. */
  peeking: boolean;
  /** The window is in front (key); its shell dims a little when it isn't, as macOS sidebars do. */
  windowKey: boolean;
  /** Which of the window's edges meet the screen's: there the pointer stops, so the peek strip can stay thin. */
  screenEdges: { left: boolean; top: boolean };
  /** A two-finger swipe back or forward over the page, as Chromium reports it; the shell draws its arrow. */
  historySwipe: HistorySwipe | null;
  /** Names and icons the user gave tabs in Merlin (Rename Tab, Change Icon), by tab. */
  tabLooks: TabLooks;
  /** Where each pinned tab started, by tab: its tile offers to go back there once it has navigated away. */
  pinnedHomes: Record<string, { url: string; title: string }>;
  /** The space the window shows (state/spaces.ts); null in windows without spaces (private and pop-up ones). */
  activeSpace: string | null;
  /** The tab last selected in each space, by space, to come back to. */
  lastSelected: Record<string, string>;
  /** Every tab, as `snapshot` would show them without spaces: for the Ctrl-Tab cards and the media player. */
  allTabs: Tab[];
  /** The last change of space, for the slide between them: which way (1 to the right) and a count that changes each time. */
  spaceMove: { direction: 1 | -1; serial: number } | null;
  /** Tests only: the window's interface fails as it next draws, to show its error boundary. */
  failInRender: boolean;
};

export function initialState(): BrowserState {
  return {
    snapshot: null, engineSnapshot: null, connectionError: null, panel: null, popover: null, revealedPromptId: null, statusMessage: null,
    addressFocus: 0, addressRevert: 0, omnibox: null, favicons: {}, iconTones: {}, anchors: {}, windowSize: { width: 0, height: 0 },
    downloadLandings: 0, tabDrag: null, panes: {}, favouriteZone: null, pinDrop: null, recentTabs: [], groupDialog: null, openFolder: null, hoverCard: null, peeking: false, windowKey: true, screenEdges: { left: true, top: true }, historySwipe: null, tabLooks: {}, pinnedHomes: {},
    activeSpace: null, lastSelected: {}, allTabs: [], spaceMove: null,
    failInRender: false,
  };
}

/** Draws the shell's own changes (WebKit tabs) over a Chromium snapshot. */
export type SnapshotOverlay = (snapshot: Snapshot) => Snapshot;

export function createBrowserStore(windowId: string) {
  const store = createStore<BrowserState>()(() => initialState());
  return Object.assign(store, { windowId, overlay: ((s: Snapshot) => s) as SnapshotOverlay,
    /** :space commands from Chromium; state/spaceManager.ts handles them once attached. */
    spaceCommand: ((_event: SpaceCommand) => {}) as (event: SpaceCommand) => void });
}
export type BrowserStore = ReturnType<typeof createBrowserStore>;

/** When each window last took a snapshot, for the trace's snapshot-commit lines (useCommitTrace). */
export const snapshotAccepted = new WeakMap<BrowserStore, { revision: number; at: number; tabs: number }>();
let timing = false;
/** Records snapshotAccepted; state/window.tsx turns it on while tracing. */
export function timeSnapshots(on: boolean) { timing = on; }

/** Applies a snapshot unless an equal or newer one from this session is already shown. */
export function acceptSnapshot(store: BrowserStore, input: unknown) {
  const at = timing ? performance.now() : 0;
  const next = validateSnapshot(input, store.windowId);
  const current = store.getState().engineSnapshot;
  if (current && current.session === next.session && current.revision >= next.revision) return;
  const engineSnapshot = current ? shareUnchanged(current, next) : next;
  const recentTabs = rememberActive(store.getState().recentTabs, next.activeTabId, next.tabs.map(t => t.id));
  if (timing) snapshotAccepted.set(store, { revision: next.revision, at, tabs: next.tabs.length });
  const { snapshot, allTabs } = present(store, engineSnapshot);
  const state = store.getState();
  const pinnedHomes = rememberPinnedHomes(state.pinnedHomes, snapshot.tabs);
  // A card for a tab that closed, or a peek with the tabs shown again, goes.
  // So does a card the keyboard moved on from, as Dia's goes on any key: a
  // tab opened, closed or switched to, the find bar opened, or keys typed.
  const before = state.snapshot;
  const keyed = !!before && (before.activeTabId !== snapshot.activeTabId || before.tabs.length !== snapshot.tabs.length ||
    (!before.find?.visible && !!snapshot.find?.visible) || before.modal.pending !== snapshot.modal.pending);
  const hoverCard = state.hoverCard && !keyed && snapshot.tabs.some(t => t.id === state.hoverCard?.tabId) ? state.hoverCard : null;
  const peeking = state.peeking && !!snapshot.modal.sidebarHidden;
  const modal = snapshot.modal;
  const modalMessageChanged = modal.message !== before?.modal.message || modal.messageIsError !== before?.modal.messageIsError;
  const statusMessage = modal.message && modalMessageChanged
    ? { text: modal.message, isError: !!modal.messageIsError }
    : state.statusMessage;
  store.setState({ engineSnapshot, snapshot, allTabs, connectionError: null, recentTabs, pinnedHomes, hoverCard, peeking, statusMessage });
}

/**
 * Each pinned tab's page when it was first seen pinned (pinned in this
 * window, or restored pinned); unpinned and closed tabs are forgotten. The
 * same object comes back when nothing changed.
 */
export function rememberPinnedHomes(homes: BrowserState['pinnedHomes'], tabs: Snapshot['tabs']): BrowserState['pinnedHomes'] {
  const next: BrowserState['pinnedHomes'] = {};
  let changed = false;
  for (const tab of tabs) {
    if (!tab.pinned) continue;
    const home = homes[tab.id] ?? (tab.url && !isBlank(tab.url) ? { url: tab.url, title: tab.title } : undefined);
    if (!home) continue;
    next[tab.id] = home;
    if (home !== homes[tab.id]) changed = true;
  }
  if (!changed && Object.keys(next).length === Object.keys(homes).length) return homes;
  return next;
}
const isBlank = (url: string) => url === 'about:blank' || /^(chrome|merlin):\/\//.test(url);

/** Shows the snapshot again after the overlay's own state changed. */
export function refreshOverlay(store: BrowserStore) {
  const { engineSnapshot, snapshot, allTabs } = store.getState();
  if (!engineSnapshot) return;
  const next = present(store, engineSnapshot);
  if (next.snapshot !== snapshot || next.allTabs !== allTabs) store.setState(next);
}

/** What the window shows of Chromium's snapshot: WebKit's pages and the tabs' own names laid over it, then only the space showing. */
function present(store: BrowserStore, engineSnapshot: Snapshot) {
  const dressed = dressSnapshot(store.overlay(engineSnapshot), store.getState().tabLooks);
  return { snapshot: spaceView(dressed, shellPrefs.getState().spaces, store.getState().activeSpace), allTabs: dressed.tabs };
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

export function showStatusMessage(store: BrowserStore, text: string, isError = true) {
  store.setState({ statusMessage: { text, isError } });
}

export function dismissStatusMessage(store: BrowserStore, message: StatusMessage) {
  if (store.getState().statusMessage === message) store.setState({ statusMessage: null });
}

/** Native requests to open a panel. Extensions is a popover in this shell. */
export function openNativePanel(store: BrowserStore, panel: PanelName) {
  if (panel === 'extensions') store.setState({ popover: panel, panel: null });
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
    if (store.getState().snapshot) showStatusMessage(store, message);
    else store.setState({ connectionError: message });
  };
  // Subscribe before reading, so a tab event cannot fall between snapshot and subscription.
  const unsubscribe = engine.subscribe(event => {
    if (disposed) return;
    try {
      switch (event.type) {
        case 'snapshot': acceptSnapshot(store, event.snapshot); break;
        case 'address.focus':
          // ⌘L in the centre edits the current page's address over the page, as in Arc.
          if (shellPrefs.getState().commandBarPlacement === 'centred' && store.getState().panel !== 'newTab' && store.getState().snapshot?.activeTabId)
            store.setState(s => ({ panel: 'location', popover: null, addressFocus: s.addressFocus + 1 }));
          else store.setState(s => ({ addressFocus: s.addressFocus + 1 }));
          break;
        case 'address.revert': store.setState(s => ({ addressRevert: s.addressRevert + 1, omnibox: null })); break;
        case 'command.open': store.setState({ panel: 'command', popover: null }); break;
        case 'panel.open': openNativePanel(store, event.panel); break;
        case 'history.swipe': store.setState({ historySwipe: event }); break;
        case 'space.command': store.spaceCommand(event); break;
        case 'omnibox.results': {
          // Results for an older query never replace newer ones.
          const next = acceptResults(store.getState().omnibox, event.queryId, event.items);
          if (next) store.setState({ omnibox: next });
          break;
        }
        case 'engine.error': showStatusMessage(store, event.message); break;
        // Only a test instance sends this (test.shell): the error boundary
        // catches a failure while drawing; the host reloads the bridge after
        // one no boundary sees.
        case 'test.throw':
          if (event.where === 'render') store.setState({ failInRender: true });
          else setTimeout(() => { throw new Error('test.shell: an uncaught error from a timer'); });
          break;
        default: break;
      }
    } catch (e) { fail(e); }
  });
  void engine.call('window.snapshot', {}).then(snapshot => {
    if (!disposed) acceptSnapshot(store, snapshot);
  }).catch(fail);
  return () => { disposed = true; unsubscribe(); };
}
