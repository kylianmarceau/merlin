// Everything a window's components can ask for. Components never hold the
// engine or call getState(); they call these, and failures become notices.
import { copyText, haptic, imageTone, showMenu, type MenuItem, type SymbolName } from '../platform/shell';
import { shellPrefs } from './shellPrefs';
import { setFavouriteFolders } from './shellPrefsStorage';
import { foldInto, homeKey, leaveFolder, renameFolder, ungroupFolder } from './favouriteFolders';
import { canUseWebKit } from '../lib/engines';
import { pageLabel } from '../lib/format';
import { dropOutcome, type DropTarget, type SplitSide } from './tabDrag';
import { beforeIdFor, overZone, placeAt, slotAt, type GridZone } from './favouriteGrid';
import { withLook, type TabLook } from './tabLooks';
import { tabUnits } from './splits';
import { moveSite, navigateWebKitTab, runPageCommand } from './webkit';
import { groupColors, type Appearance, type Calls, type DownloadAction, type EngineClient, type GroupColor, type Method, type Request,
  type Requests } from '../platform/protocol';
import { currentSuggestions, moveSelection, startQuery, suggestionChoice } from './omnibox';
import {
  dismissHud, dismissToast, pushToast, refreshOverlay, rememberFavicon, showHud, type Hud, type AnchorName, type BrowserStore, type GroupDialog, type HoverCard, type Panel, type PopoverName, type Rect,
  type SearchOwner,
} from './store';
import type { BookmarkItem, MediaAction } from '../platform/protocol';
import { awayFromHome } from './pinned';

let queryCounter = 0;
/** The symbols a tab can show in place of its page's icon (Change Icon), with their names in the menu. */
const symbolTitles = {
  star: 'Star', heart: 'Heart', bolt: 'Bolt', flag: 'Flag', bookmark: 'Bookmark', book: 'Book', briefcase: 'Briefcase', cart: 'Cart',
  envelope: 'Envelope', 'bubble.left': 'Chat', calendar: 'Calendar', 'chart.bar': 'Chart', newspaper: 'News', film: 'Film',
  'music.note': 'Music', gamecontroller: 'Game', house: 'House', graduationcap: 'School', paintpalette: 'Palette', leaf: 'Leaf',
  airplane: 'Travel',
} as const satisfies Partial<Record<SymbolName, string>>;
const tabSymbols = Object.keys(symbolTitles) as (keyof typeof symbolTitles)[];
const groupColorTitle = (color: GroupColor) => color[0].toUpperCase() + color.slice(1);
/** How soon after an outside press closes a popover its own button is ignored. */
const reopenGuardMs = 400;
/**
 * Hover cards and tooltips, as in Dia: half a second under a still pointer,
 * then at once for the next one while the pointer moves on; a card stays a
 * moment after the pointer leaves so it can be reached. Peeking tabs stay as
 * long after the pointer leaves them. In milliseconds (state can't import
 * motion.ts); the tooltips' delay there is the same half second.
 */
const hoverTiming = { open: 500, warm: 300, close: 200, peekClose: 200 } as const;



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
  /** Notes whether an icon is one dark or light colour (GitHub's black mark), so it can be drawn light on the dark shell. */
  const learnTone = (key: string, url: string) => {
    void imageTone(url).then(tone => {
      if (tone && store.getState().iconTones[key] !== tone) store.setState(s => ({ iconTones: { ...s.iconTones, [key]: tone } }));
    });
  };
  // Hover cards: the timer that opens the next one, the one that closes the
  // shown one, and until when the next opens at once.
  let cardOpen: ReturnType<typeof setTimeout> | null = null;
  let cardClose: ReturnType<typeof setTimeout> | null = null;
  let cardWarmUntil = 0;
  const clearCardTimers = () => {
    if (cardOpen) clearTimeout(cardOpen);
    if (cardClose) clearTimeout(cardClose);
    cardOpen = cardClose = null;
  };
  let peekClose: ReturnType<typeof setTimeout> | null = null;
  // A native menu (a tab's right-click menu) covers the peeking tabs, which
  // reads as the pointer leaving them, and an animation started while it
  // tracks stalls half-way. So they hold still while a menu is open, and a
  // leave during it counts only once it has closed (if the pointer is back
  // on them, AppKit says so and they stay).
  let menusOpen = 0;
  let leftDuringMenu = false;
  const menu = async (items: MenuItem[]) => {
    menusOpen++;
    try { return await showMenu(items); } finally {
      menusOpen--;
      if (!menusOpen && leftDuringMenu) { leftDuringMenu = false; actions.unpeek(); }
    }
  };
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
    /**
     * The star: saves the tab's page into the Bookmarks Bar folder, or removes
     * it when it is already bookmarked. Says which, as the star is small.
     */
    async bookmarkTab(tabId: string, bookmarked?: boolean) {
      const tab = store.getState().snapshot?.tabs.find(t => t.id === tabId);
      const on = bookmarked ?? !tab?.bookmarked;
      if (!(await run('tabs.bookmark', { tabId, bookmarked: on }))) return false;
      // Edit opens the Library's bookmarks, to rename it or move it to another folder.
      if (on) showHud(store, 'Added to the Bookmarks bar', 'info', 'bookmark.fill', { label: 'Edit', run: () => actions.openPanel('bookmarks') });
      else showHud(store, 'Bookmark removed', 'info', 'bookmark');
      return true;
    },
    muteTab: (tabId: string, muted: boolean) => run('tabs.mute', { tabId, muted }),
    /** Plays, pauses or skips a tab's media from the sidebar's player. */
    mediaTab: (tabId: string, action: MediaAction) => run('tabs.media', { tabId, action }),
    /** A pinned tab goes back to the page it was pinned on. */
    returnToPinnedPage(tabId: string) {
      const home = store.getState().pinnedHomes[tabId];
      if (!home) return Promise.resolve(false);
      const tab = store.getState().snapshot?.tabs.find(t => t.id === tabId);
      if (tab?.engine === 'webkit' && navigateWebKitTab(tabId, home.url, isPrivate())) return Promise.resolve(true);
      return run('navigation.open', { tabId, text: home.url });
    },
    copyTabLink(tabId: string) {
      const tab = store.getState().snapshot?.tabs.find(t => t.id === tabId);
      return tab?.url ? actions.copyAddress(tab.url) : Promise.resolve();
    },
    /** Closes the open tabs after this one in the list, as Chrome's Close Tabs Below. */
    async closeTabsBelow(tabId: string) {
      const tabs = store.getState().snapshot?.tabs ?? [];
      const below = tabs.slice(tabs.findIndex(t => t.id === tabId) + 1).filter(t => !t.pinned);
      for (const t of below) if (!(await actions.closeTab(t.id))) break;
    },

    // Hover cards over tabs and pinned tiles.
    /** The pointer came to a tab; its card opens after a rest, or at once if one was just showing. */
    hoverTab(tabId: string, anchor: Rect, side: HoverCard['side']) {
      clearCardTimers();
      const shown = store.getState().hoverCard;
      const show = () => { cardOpen = null; store.setState({ hoverCard: { tabId, anchor, side } }); };
      if (shown || Date.now() < cardWarmUntil) show();
      else cardOpen = setTimeout(show, hoverTiming.open);
    },
    /** The pointer left a tab, or the card: the card closes shortly unless the pointer comes back. */
    leaveTab() {
      if (cardOpen) { clearTimeout(cardOpen); cardOpen = null; }
      if (cardClose || !store.getState().hoverCard) return;
      cardClose = setTimeout(() => {
        cardClose = null;
        cardWarmUntil = Date.now() + hoverTiming.warm;
        store.setState({ hoverCard: null });
      }, hoverTiming.close);
    },
    /** The pointer is on the card itself: it stays. */
    holdHoverCard() { if (cardClose) { clearTimeout(cardClose); cardClose = null; } },
    /** A press, a drag or a scroll: the card goes at once, and the next one waits again. */
    closeHoverCard() {
      clearCardTimers();
      cardWarmUntil = 0;
      if (store.getState().hoverCard) store.setState({ hoverCard: null });
    },

    // The hidden tabs peeking in from the window's edge.
    /** The pointer reached the edge, or came back to the peeking tabs. */
    peek() {
      leftDuringMenu = false;
      if (peekClose) { clearTimeout(peekClose); peekClose = null; }
      const s = store.getState();
      if (!s.peeking && s.snapshot?.modal.sidebarHidden && !s.snapshot.fullscreen) store.setState({ peeking: true });
    },
    /** The pointer left the peeking tabs: they slide away shortly, unless the address is being typed in. */
    unpeek() {
      if (menusOpen) { leftDuringMenu = true; return; }
      if (peekClose || !store.getState().peeking) return;
      peekClose = setTimeout(() => {
        peekClose = null;
        if (store.getState().omnibox) return;
        store.setState({ peeking: false });
      }, hoverTiming.peekClose);
    },
    /** The window came to the front or left it, or moved against or away from the screen's edges. */
    setWindowFacts(facts: { key: boolean; leftEdge: boolean; topEdge: boolean }) {
      const s = store.getState();
      if (s.windowKey !== facts.key || s.screenEdges.left !== facts.leftEdge || s.screenEdges.top !== facts.topEdge)
        store.setState({ windowKey: facts.key, screenEdges: { left: facts.leftEdge, top: facts.topEdge } });
    },
    endPeek() {
      if (peekClose) { clearTimeout(peekClose); peekClose = null; }
      if (store.getState().peeking) store.setState({ peeking: false });
    },
    /** Shows the tab in a split view beside `beside`, or the current tab, and focuses it. */
    splitTab: (tabId: string, side: SplitSide = 'right', beside?: string) =>
      run('tabs.split', beside ? { tabId, side, beside } : { tabId, side }),
    /** Ends the tab's split view; both tabs stay open. */
    unsplitTab: (tabId: string) => run('tabs.unsplit', { tabId }),
    /** Moves the tab into a window of its own, under the pointer. */
    detachTab: (tabId: string) => run('tabs.detach', { tabId }),

    // Tab groups.
    /** Adds the tab to `groupId`, or to a new group named `title` when `groupId` is null. */
    groupTab: (tabId: string, groupId: string | null, title?: string) =>
      run('tabs.group', title === undefined ? { tabId, groupId } : { tabId, groupId, title }),
    ungroupTab: (tabId: string) => run('tabs.ungroup', { tabId }),
    /** A pinned tab's place in the favourite folders: its pinned home page. */
    favouriteKey(tabId: string): string | null {
      const s = store.getState();
      const tab = s.snapshot?.tabs.find(t => t.id === tabId);
      return tab ? homeKey(s.pinnedHomes[tabId]?.url ?? tab.url) : null;
    },
    /** A favourite dropped onto another, as in Ardia: the two make a folder, or it joins the one the other is in. */
    foldFavourite(tabId: string, targetId: string) {
      const key = actions.favouriteKey(tabId), target = actions.favouriteKey(targetId);
      if (!key || !target || key === target) return;
      haptic('alignment');
      void setFavouriteFolders(foldInto(shellPrefs.getState().favouriteFolders, key, target, `f${Date.now().toString(36)}`));
    },
    leaveFavouriteFolder(tabId: string) {
      const key = actions.favouriteKey(tabId);
      if (key) void setFavouriteFolders(leaveFolder(shellPrefs.getState().favouriteFolders, key));
    },
    openFavouriteFolder: (folderId: string, anchor: Rect) => {
      actions.closeHoverCard();
      store.setState({ openFolder: { folderId, anchor }, popover: null });
    },
    closeFavouriteFolder: () => store.setState({ openFolder: null }),
    /** A folder tile's own menu: rename it, or put its favourites back as tiles of their own. */
    async folderMenu(folderId: string) {
      let choice: string | null;
      try {
        choice = await menu([
          { id: 'rename', title: 'Rename Folder…', symbol: 'pencil' },
          { id: 'ungroup', title: 'Ungroup Folder', symbol: 'folder.badge.minus' },
        ]);
      } catch (e) { fail(e); return; }
      if (choice === 'rename') actions.nameGroup({ kind: 'renameFolder', folderId });
      if (choice === 'ungroup') {
        store.setState({ openFolder: null });
        void setFavouriteFolders(ungroupFolder(shellPrefs.getState().favouriteFolders, folderId));
      }
    },
    /**
     * A tab dropped onto another, as in Ardia: it joins that tab's group, or
     * the two make a new one (the engine names the group's colour; the name
     * stays empty until it is renamed).
     */
    async groupOnContact(tabId: string, targetId: string) {
      const groupOf = (s: ReturnType<typeof store.getState>) => s.snapshot?.tabs.find(t => t.id === targetId)?.group;
      let group = groupOf(store.getState());
      if (!group) {
        if (!await actions.groupTab(targetId, null)) return false;
        group = await until(store, groupOf);
      }
      return group ? actions.groupTab(tabId, group) : false;
    },
    updateGroup: (groupId: string, change: { title?: string; color?: GroupColor; collapsed?: boolean }) =>
      run('groups.update', { groupId, ...change }),
    ungroupGroup: (groupId: string) => run('groups.ungroup', { groupId }),
    closeGroup: (groupId: string) => run('groups.close', { groupId }),
    /** Opens the field that names a new group for the tab, or renames a group. */
    nameGroup: (dialog: GroupDialog) =>
      store.setState({ groupDialog: dialog, panel: null, popover: null }),
    closeGroupDialog: () => store.setState({ groupDialog: null }),
    /** The group dialog's answer: names the new group, or renames the group. Empty names are allowed. */
    async submitGroupDialog(title: string) {
      const dialog = store.getState().groupDialog;
      if (!dialog) return;
      const name = title.trim();
      if (dialog.kind === 'renameTab') { actions.setTabLook(dialog.tabId, { name }); store.setState({ groupDialog: null }); return; }
      if (dialog.kind === 'renameFolder') {
        void setFavouriteFolders(renameFolder(shellPrefs.getState().favouriteFolders, dialog.folderId, name));
        store.setState({ groupDialog: null });
        return;
      }
      const ok = dialog.kind === 'new' ? await actions.groupTab(dialog.tabId, null, name)
        : await actions.updateGroup(dialog.groupId, { title: name });
      if (ok) store.setState({ groupDialog: null });
    },
    /** A tab's own name or icon in Merlin (empty puts the page's back). */
    setTabLook(tabId: string, change: TabLook) {
      const s = store.getState();
      store.setState({ tabLooks: withLook(s.tabLooks, tabId, change, (s.engineSnapshot?.tabs ?? []).map(t => t.id)) });
      refreshOverlay(store);
    },
    async groupMenu(groupId: string) {
      const snap = store.getState().snapshot;
      const group = snap?.groups?.find(g => g.id === groupId);
      if (!group) return;
      const holdsEveryTab = !!snap && snap.tabs.every(t => t.group === groupId);
      const items: MenuItem[] = [
        { id: 'rename', title: 'Rename Group…' },
        { title: 'Colour', children: groupColors.map(color => ({ id: `tint:${color}`, title: groupColorTitle(color),
          checked: group.color === color })) },
        { id: 'collapse', title: group.collapsed ? 'Expand Group' : 'Collapse Group', enabled: group.collapsed || !holdsEveryTab },
        { separator: true },
        { id: 'ungroup', title: 'Ungroup' },
        { id: 'close', title: 'Close Group', destructive: true },
      ];
      let choice: string | null;
      try { choice = await menu(items); } catch (e) { fail(e); return; }
      if (choice === 'rename') actions.nameGroup({ kind: 'rename', groupId });
      else if (choice === 'collapse') await actions.updateGroup(groupId, { collapsed: !group.collapsed });
      else if (choice === 'ungroup') await actions.ungroupGroup(groupId);
      else if (choice === 'close') await actions.closeGroup(groupId);
      else if (choice?.startsWith('tint:')) await actions.updateGroup(groupId, { color: choice.slice('tint:'.length) as GroupColor });
    },
    toggleGroup(groupId: string) {
      const group = store.getState().snapshot?.groups?.find(g => g.id === groupId);
      return group ? actions.updateGroup(groupId, { collapsed: !group.collapsed }) : Promise.resolve(false);
    },

    // Peek: a link in a floating card over the page.
    closePeek: () => run('peek.close', {}),
    promotePeek: () => run('peek.promote', {}),
    /**
     * A tab being dragged, the pointer at (x, y) in the window. `out` is set
     * once it has left the tabs (the strip or sidebar decides); outside the
     * window always counts. Out of the tabs the page shows drop zones, and
     * the one under the pointer is kept (`setTabDropTarget`). Returns
     * whether it is out of the tabs.
     */
    tabDragMove(tabId: string, x: number, y: number, out: boolean) {
      const s = store.getState();
      const { width, height } = s.windowSize;
      const outside = out || x < 0 || y < 0 || x > width || y > height;
      const old = s.tabDrag;
      const target = old?.tabId === tabId && outside ? old.target : null;
      // A tick as the tab leaves the tabs for the page or another window.
      if (old?.tabId === tabId && outside && !old.out) haptic('alignment');
      if (!(old && old.tabId === tabId && old.x === x && old.y === y && old.out === outside && old.target === target))
        store.setState({ tabDrag: { tabId, x, y, out: outside, target } });
      return outside;
    },
    /** The drop zone under the dragged tab, as the page's zones work it out. */
    setTabDropTarget(target: DropTarget | null) {
      const drag = store.getState().tabDrag;
      if (!drag || (drag.target?.tabId === target?.tabId && drag.target?.side === target?.side)) return;
      // A tick as it reaches a drop zone.
      if (drag.out && target) haptic('alignment');
      store.setState({ tabDrag: { ...drag, target: drag.out ? target : null } });
    },
    /** A tab drag that ended without being let go (the gesture was taken away). */
    tabDragCancel() {
      if (store.getState().tabDrag) store.setState({ tabDrag: null });
      if (store.getState().pinDrop) store.setState({ pinDrop: null });
    },
    /** Where the favourite tiles are in the window, as the sidebar lays them out (null while there are none to show). */
    setFavouriteZone(zone: GridZone | null) {
      const old = store.getState().favouriteZone;
      if (old === zone || (old && zone && (Object.keys(zone) as (keyof GridZone)[]).every(k => old[k] === zone[k]))) return;
      store.setState({ favouriteZone: zone });
    },
    /**
     * A tab dragged from the list, the pointer at (x, y) in the window: over
     * the favourites it would be pinned into the slot under the pointer, and
     * the tiles make room for it. A tick as it reaches them and at each new
     * slot. Returns whether it is over them.
     */
    pinDragOver(tabId: string, x: number, y: number) {
      const s = store.getState();
      const zone = s.favouriteZone;
      const pinned = (s.snapshot?.tabs ?? []).filter(t => t.pinned && t.id !== tabId);
      const over = !!zone && overZone(zone, x, y, zone.gap * 2);
      const index = over && zone ? slotAt(x - zone.x, y - zone.y, pinned.length + 1, zone.width, zone.tileHeight, zone.gap) : -1;
      const old = s.pinDrop;
      if (!over) { if (old) store.setState({ pinDrop: null }); return false; }
      if (old?.tabId === tabId && old.index === index) return true;
      haptic(old ? 'alignment' : 'level');
      store.setState({ pinDrop: { tabId, index } });
      return true;
    },
    /** The dragged tab was let go: over the favourites it is pinned into its slot. Returns whether it was. */
    pinDragEnd() {
      const s = store.getState();
      const drop = s.pinDrop;
      if (!drop) return false;
      store.setState({ pinDrop: null, tabDrag: null });
      const tabs = s.snapshot?.tabs ?? [];
      const order = placeAt(tabs.filter(t => t.pinned).map(t => t.id), drop.tabId, drop.index);
      void (async () => {
        await actions.pinTab(drop.tabId, true);
        const firstOpen = tabs.find(t => !t.pinned && t.id !== drop.tabId)?.id ?? null;
        if (drop.index < order.length - 1) await actions.moveTab(drop.tabId, beforeIdFor(order, drop.index, firstOpen));
      })();
      return true;
    },
    /** A favourite tile dragged to slot `index` among the tiles. */
    async moveFavourite(tabId: string, index: number) {
      const tabs = store.getState().snapshot?.tabs ?? [];
      const ids = tabs.filter(t => t.pinned).map(t => t.id);
      if (ids.indexOf(tabId) === index) return;
      const order = placeAt(ids, tabId, index);
      await actions.moveTab(tabId, beforeIdFor(order, index, tabs.find(t => !t.pinned)?.id ?? null));
    },
    /**
     * The dragged tab was let go. Among the tabs it is theirs to reorder
     * ('reorder'). Out of them it goes beside a pane in a split view or to a
     * window of its own ('moved'), or stays where it was ('stayed').
     */
    tabDragEnd(): 'reorder' | 'moved' | 'stayed' {
      const s = store.getState();
      const drag = s.tabDrag;
      if (drag) store.setState({ tabDrag: null });
      if (!drag?.out) return 'reorder';
      const snap = s.snapshot;
      const outcome = snap && dropOutcome({ x: drag.x, y: drag.y, window: s.windowSize, page: s.anchors.page, target: drag.target,
        canDetach: snap.kind !== 'popup' && snap.tabs.length > 1 });
      if (outcome?.kind === 'split') void actions.splitTab(drag.tabId, outcome.target.side, outcome.target.tabId);
      else if (outcome?.kind === 'window') void actions.detachTab(drag.tabId);
      return outcome ? 'moved' : 'stayed';
    },
    /** Where each page on screen is, for the drop zones. */
    setPanes(panes: Record<string, Rect>) {
      const old = store.getState().panes;
      const same = (a: Rect | undefined, b: Rect) => !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
      const ids = Object.keys(panes);
      if (ids.length === Object.keys(old).length && ids.every(id => same(old[id], panes[id]))) return;
      store.setState({ panes });
    },
    /**
     * The bookmarks bar's contents: Chromium's Bookmarks Bar folder, then
     * Other Bookmarks as one folder when it holds anything, as Chrome's bar
     * ends with it. Bookmarks saved before Merlin saved into the bar are there.
     */
    async bookmarksBar(): Promise<BookmarkItem[]> {
      const root = await engine.request('bookmarks.folder', {});
      const [bar, ...rest] = root.items.filter(item => item.folder);
      const items = bar ? (await engine.request('bookmarks.folder', { folderId: bar.id })).items : [];
      const other = rest.find(item => (item.count ?? 0) > 0);
      return other ? [...items, other] : items;
    },
    /** A page's icon (a bookmark, a history row), fetched once per address. */
    loadPageFavicon(url: string) {
      const key = `page:${url}`;
      if (!/^(https?|file):/i.test(url) || key in store.getState().favicons || faviconLoads.has(key)) return;
      faviconLoads.add(key);
      engine.request('favicons.page', { url }).then(icon => {
        // Remembered even when there is none, so the row isn't asked again; '' draws the fallback.
        rememberFavicon(store, key, icon ?? '');
        if (icon) learnTone(key, icon);
      }, () => {}).finally(() => faviconLoads.delete(key));
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
        const choice = await menu(await level(folderId, 0));
        const url = choice ? urls.get(choice) : undefined;
        if (url) await actions.openBookmark(url, false);
      } catch (e) { fail(e); }
    },
    async bookmarkMenu(item: { id: string; url?: string; editable: boolean }, onChanged: () => void) {
      const choice = await menu([
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
      try { await copyText(url); showHud(store, 'Link copied', 'info', 'link'); } catch (e) { fail(e); }
    },
    async tabMenu(tabId: string) {
      const snap = store.getState().snapshot;
      const tabs = snap?.tabs ?? [];
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return;
      // A split view's tabs move as one, so Move Up and Down step over whole splits.
      const units = tabUnits(tabs);
      const unit = units.findIndex(u => u.some(t => t.id === tabId));
      const previous = units[unit - 1]?.[0];
      const next = units[unit + 1]?.[0];
      const shownTogether = !!tab.split && tabs.some(t => t.id === snap?.activeTabId && t.split === tab.split);
      const others = tabs.filter(t => t.id !== tabId && !t.pinned);
      const below = tabs.slice(tabs.findIndex(t => t.id === tabId) + 1).filter(t => !t.pinned);
      const home = tab.pinned ? store.getState().pinnedHomes[tabId] : undefined;
      const folderKey = tab.pinned ? actions.favouriteKey(tabId) : null;
      const inFolder = !!folderKey && shellPrefs.getState().favouriteFolders.some(f => f.members.includes(folderKey));
      const page = !!tab.url && !/^(about|chrome|merlin):/.test(tab.url);
      const groups = (store.getState().snapshot?.groups ?? []).filter(g => g.id !== tab.group);
      // As in Ardia, every item carries a symbol; the tab's own title says which tab.
      const look = store.getState().tabLooks[tabId];
      const items: MenuItem[] = [
        { id: 'pin', title: tab.pinned ? 'Unpin Tab' : 'Pin Tab', symbol: tab.pinned ? 'pin.slash' : 'pin' },
        ...(inFolder ? [{ id: 'unfold', title: 'Remove from Folder', symbol: 'folder.badge.minus' as const }] : []),
        ...(home && awayFromHome(tab, home) ? [{ id: 'home', title: 'Back to Pinned Page', symbol: 'arrow.uturn.backward' as const }] : []),
        { id: 'duplicate', title: 'Duplicate Tab', enabled: !!tab.url, symbol: 'doc.on.doc' },
        { id: 'reload', title: 'Reload Tab', symbol: 'arrow.clockwise' },
        ...(tab.audible || tab.muted ? [{ id: 'mute', title: tab.muted ? 'Unmute Tab' : 'Mute Tab',
          symbol: (tab.muted ? 'speaker.wave.2' : 'speaker.slash') as 'speaker.wave.2' | 'speaker.slash' }] : []),
        { separator: true },
        { id: 'rename', title: 'Rename Tab…', symbol: 'pencil' },
        { title: 'Change Icon', symbol: 'face.smiling', children: [
          ...tabSymbols.map(name => ({ id: `icon:${name}`, title: symbolTitles[name], symbol: name, checked: look?.symbol === name })),
          { separator: true },
          { id: 'icon:', title: 'Use the Site’s Icon', symbol: 'globe', enabled: !!look?.symbol },
        ] },
        ...(look?.name ? [{ id: 'unname', title: 'Use the Page’s Title', symbol: 'arrow.counterclockwise' as const }] : []),
        { separator: true },
        { id: 'bookmark', title: tab.bookmarked ? 'Remove Bookmark' : 'Add to Bookmarks Bar', enabled: page,
          symbol: (tab.bookmarked ? 'bookmark.fill' : 'bookmark') as 'bookmark' | 'bookmark.fill' },
        { id: 'copy', title: 'Copy Link', enabled: page, symbol: 'link' },
        // Sites Chromium can't play open in WebKit; either can show any site.
        ...(canUseWebKit(tab.url) ? [tab.engine === 'webkit'
          ? { id: 'chromium', title: 'Open Site in Chromium', symbol: 'globe' as const }
          : { id: 'webkit', title: 'Open Site in WebKit', symbol: 'safari' as const }] : []),
        { separator: true },
        tab.split ? { id: 'unsplit', title: 'Separate Split View', symbol: 'rectangle.portrait.and.arrow.right' }
          : { id: 'split', title: 'Open in Split View', enabled: tab.id !== snap?.activeTabId && !shownTogether, symbol: 'rectangle.split.2x1' },
        { id: 'window', title: 'Move to New Window', enabled: tabs.length > 1, symbol: 'arrow.up.forward.app' },
        { separator: true },
        // Chromium keeps pinned tabs out of groups.
        { id: 'group-new', title: 'Add to New Group…', enabled: !tab.pinned, symbol: 'rectangle.stack.badge.plus' },
        ...(groups.length ? [{ title: 'Add to Group', enabled: !tab.pinned, symbol: 'rectangle.stack' as const,
          children: groups.map(g => ({ id: `group:${g.id}`, title: g.title || 'Unnamed Group' })) }] : []),
        ...(tab.group ? [{ id: 'ungroup', title: 'Remove from Group', symbol: 'rectangle.stack.badge.minus' as const }] : []),
        { separator: true },
        { id: 'up', title: 'Move Up', enabled: !!previous && previous.pinned === tab.pinned, symbol: 'arrow.up' },
        { id: 'down', title: 'Move Down', enabled: !!next && next.pinned === tab.pinned, symbol: 'arrow.down' },
        { separator: true },
        { id: 'close', title: 'Close Tab', symbol: 'xmark' },
        { id: 'others', title: 'Close Other Tabs', enabled: others.length > 0, symbol: 'xmark.square' },
        { id: 'below', title: 'Close Tabs Below', enabled: below.length > 0, symbol: 'arrow.down.to.line' },
      ];
      let choice: string | null;
      try { choice = await menu(items); } catch (e) { fail(e); return; }
      switch (choice) {
        case 'pin': await actions.pinTab(tabId, !tab.pinned); break;
        case 'unfold': actions.leaveFavouriteFolder(tabId); break;
        case 'rename': actions.nameGroup({ kind: 'renameTab', tabId }); break;
        case 'unname': actions.setTabLook(tabId, { name: '' }); break;
        case 'duplicate': await actions.newTab(tab.url); break;
        case 'bookmark': await actions.bookmarkTab(tabId); break;
        case 'home': await actions.returnToPinnedPage(tabId); break;
        case 'reload': await actions.reloadTab(tabId); break;
        case 'mute': await actions.muteTab(tabId, !tab.muted); break;
        case 'copy': await actions.copyTabLink(tabId); break;
        case 'below': await actions.closeTabsBelow(tabId); break;
        case 'webkit': case 'chromium':
          try { await moveSite(tab.url, choice); } catch (e) { fail(e); }
          break;
        case 'split': await actions.splitTab(tabId); break;
        case 'unsplit': await actions.unsplitTab(tabId); break;
        case 'window': await actions.detachTab(tabId); break;
        case 'group-new': actions.nameGroup({ kind: 'new', tabId }); break;
        case 'ungroup': await actions.ungroupTab(tabId); break;
        case 'up': if (previous) await actions.moveTab(tabId, previous.id); break;
        case 'down': await actions.moveTab(tabId, units[unit + 2]?.[0].id ?? null); break;
        case 'close': await actions.closeTab(tabId); break;
        case 'others': for (const t of others) if (!(await actions.closeTab(t.id))) break; break;
        default:
          if (choice?.startsWith('group:')) await actions.groupTab(tabId, choice.slice('group:'.length));
          else if (choice?.startsWith('icon:')) actions.setTabLook(tabId, { symbol: choice.slice('icon:'.length) });
          break;
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
      try { choice = await menu(items); } catch (e) { fail(e); return; }
      if (choice === 'chromium') {
        try { await moveSite(tab.url, 'chromium'); } catch (e) { fail(e); }
      }
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
    /**
     * Back or Forward held, or right-clicked: the pages that way, nearest
     * first, as a native menu, as in Safari and Dia. Choosing one goes there.
     * A WebKit tab's history is WebKit's own; it has no list here.
     */
    async historyMenu(direction: 'back' | 'forward') {
      const t = active();
      if (!t || t.engine === 'webkit') return;
      let history;
      try { history = await engine.call('navigation.history', { tabId: t.id }); } catch (e) { fail(e); return; }
      const entries = direction === 'back'
        ? history.entries.filter(e => e.index < history.current).reverse()
        : history.entries.filter(e => e.index > history.current);
      if (!entries.length) return;
      const items: MenuItem[] = entries.slice(0, 20).map(e => ({ id: String(e.index), title: pageLabel(e.title, e.url) }));
      let choice: string | null;
      try { choice = await menu(items); } catch (e) { fail(e); return; }
      if (choice !== null) await run('navigation.go', { tabId: t.id, index: Number(choice) });
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
      store.setState({ omnibox: startQuery(store.getState().omnibox, queryId, text, owner) });
      void engine.call('omnibox.query', { queryId, text, preventInline }).catch(fail);
    },
    stopSuggesting() {
      if (!store.getState().omnibox) return;
      store.setState({ omnibox: null });
      void engine.call('omnibox.stop', {}).catch(() => {});
    },
    moveSuggestion(delta: number) {
      const next = moveSelection(store.getState().omnibox, delta);
      if (next) store.setState({ omnibox: next });
    },
    /**
     * Opens row `index` of the latest query's rows. A greyed row, from an
     * older query, opens nothing. Chromium is sent the row's query, index
     * and address, and opens it only if its list still has that match there.
     */
    async openSuggestion(index: number, newTab: boolean) {
      const choice = suggestionChoice(store.getState().omnibox, index);
      if (!choice) return false;
      store.setState({ omnibox: null });
      if (webKitTakes(choice.url, newTab)) return true;
      return run('omnibox.open', { ...choice, newTab });
    },
    async submitAddress(text: string, newTab: boolean) {
      const omnibox = store.getState().omnibox;
      store.setState({ omnibox: null });
      // Enter takes the default suggestion, as Chromium does; without one only Chromium knows.
      // Rows of an older query don't describe this text.
      const items = currentSuggestions(omnibox);
      const top = items[0];
      // Settings › General › When input looks like a website: Prefer Search Engine searches
      // for "example.com" rather than opening it. A typed scheme ("https://…") still opens.
      if (omnibox && top?.default && top.kind === 'url' && shellPrefs.getState().searchPreference === 'search'
        && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text.trim())) {
        const search = suggestionChoice(omnibox, items.findIndex(item => item.kind === 'search'));
        if (search) return run('omnibox.open', { ...search, newTab });
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
        if (!icon) return;
        rememberFavicon(store, icon.key, icon.url);
        learnTone(icon.key, icon.url);
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
    /**
     * Escape in a text field outside an open popover closes the popover
     * first: a click on a popover's button leaves the keyboard in the field,
     * so the popover's own Escape never ran. True when it closed one.
     */
    escapePopover() {
      const s = store.getState();
      if (!s.popover && !s.snapshot?.extensionPopup) return false;
      actions.closePopover();
      return true;
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
    /** A short confirmation over the page that leaves on its own (see Hud). */
    showHud: (text: string, tone: Hud['tone'] = 'info', symbol?: Hud['symbol'], action?: Hud['action']) => showHud(store, text, tone, symbol, action),
    dismissHud: (id: number) => dismissHud(store, id),
    notify: (text: string) => pushToast(store, text, 'info'),

    // Browser questions. Errors are returned so the prompt can show them in place.
    answerPrompt: (promptId: string, actionId: string, extra: { text?: string; secret?: string; suppress?: boolean }) =>
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
    /**
     * The downloads panel's Clear: forgets every download that is no longer
     * arriving. The snapshot carries only the most recent ones, so the full
     * list is asked for first: forgetting only those let the next older ones
     * take their place, and Clear seemed to do nothing.
     */
    async clearDownloads() {
      store.setState({ popover: null });
      let all = store.getState().snapshot?.downloads ?? [];
      try { all = await engine.request('downloads.list', {}); } catch { /* the recent ones, at least */ }
      const done = all.filter(d => d.state !== 'progress');
      const results = await Promise.allSettled(done.map(d => engine.call('downloads.act', { downloadId: d.id, action: 'forget' })));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) fail(failed.reason);
      return !failed;
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
      const choice = await menu(items);
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
    /** Gives the keyboard back to the active page; quiet, as nothing asked for it. */
    focusPage() { void engine.call('page.focus', {}).catch(() => {}); },
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

/** The first value `pick` finds in the store, now or as the store changes within `ms`; undefined if none comes. */
function until<T>(store: BrowserStore, pick: (state: ReturnType<BrowserStore['getState']>) => T | null | undefined,
  ms = 2000): Promise<T | undefined> {
  const now = pick(store.getState());
  if (now) return Promise.resolve(now);
  return new Promise(resolve => {
    const stop = store.subscribe(state => {
      const found = pick(state);
      if (!found) return;
      clearTimeout(timer);
      stop();
      resolve(found);
    });
    const timer = setTimeout(() => { stop(); resolve(undefined); }, ms);
  });
}
