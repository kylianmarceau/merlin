// A window's spaces at work, as Zen's space manager (gZenWorkspaces) runs
// them: which space shows, switching between them, new tabs joining the one
// showing, and the :space commands. The rules are in spaces.ts.
//
// A window holds one data's tabs (Snapshot.data): it shows and places tabs
// in its own data's spaces, and going to a space with other data asks
// Chromium to show the window of this Merlin window that holds it
// (spaces.showData), whose own manager then shows the space.
import type { EngineClient, SpaceCommand } from '../platform/protocol';
import { removeWebKitData } from '../platform/webkit';
import { shellPrefs } from './shellPrefs';
import { setSpaces } from './shellPrefsStorage';
import {
  arrivalTab, cleanName, dataLeftUnused, dataOf, findSpace, firstSpace, homeData, maxSpaces, neighbour, newSpaceId, nextName,
  ownSpaces, savedSpaces, spaceIcons, startingSpace, strays, tabsOf, type Space,
} from './spaces';
import { refreshOverlay, type BrowserStore } from './store';
import type { WorkspaceTheme } from './workspaceTheme';

/** How long a switch waits for Chromium to show the space's tab before the active tab's space counts again. */
const arrivalMs = 1500;
/** How long tabs of a saved space being opened wait for their space to be saved before they count as strays. */
const incomingMs = 10_000;
let makingFirst = false;
let makingOwn = false;
/** Data being deleted: its windows are closing, and don't make a space for it meanwhile (shared by every window). */
const deletingData = new Set<string>();

export function createSpaces(store: BrowserStore, engine: EngineClient, fail: (e: unknown) => void) {
  const spaces = () => shellPrefs.getState().spaces;
  /** The data this window holds; undefined from an engine that doesn't say. */
  const windowData = () => store.getState().engineSnapshot?.data || undefined;
  /** The spaces this window has tabs in: those with its data. */
  const mine = () => ownSpaces(spaces(), windowData());
  /** Whether space `id` keeps its tabs in this window. */
  const isOwn = (id: string) => mine().some(s => s.id === id);
  /** Spaces are for normal windows that keep a session: not private windows (as in Zen) or pop-ups. */
  const enabled = () => {
    const s = store.getState().engineSnapshot;
    return !!s && !s.private && s.kind !== 'popup';
  };
  // While a switch waits for its tab to show, the old active tab doesn't pull the window back.
  let arriving: { space: string; until: number } | null = null;
  // Tabs Chromium is being told to put in a space, and which: until a snapshot
  // shows them there, their old space doesn't count.
  const placing = new Map<string, string>();
  // The tabs of the last snapshot, to tell new ones.
  let seen: Set<string> | null = null;
  // Spaces a saved space is opening into, until the window shows them (by
  // when to give up): their tabs aren't strays or new tabs to place meanwhile.
  const incoming = new Map<string, number>();
  let told = '';

  /** Tells Chromium which space shows, for :space save and open, autosave, gt and new tabs. */
  function tell(id: string) {
    const all = spaces();
    const saved = all.find(s => s.id === id)?.saved ?? '';
    const others = savedSpaces(all);
    const key = JSON.stringify([id, saved, others]);
    if (key === told) return;
    told = key;
    void engine.call('spaces.activate', { spaceId: id, saved, savedSpaces: others }).catch(() => { told = ''; });
  }

  /** Shows space `id` in the sidebar and tabs; `direction` says which way it slides in. */
  function show(id: string, direction?: 1 | -1) {
    const state = store.getState();
    if (state.activeSpace === id) return;
    const all = spaces();
    const from = all.findIndex(s => s.id === state.activeSpace);
    const to = all.findIndex(s => s.id === id);
    store.setState({
      activeSpace: id,
      spaceMove: from >= 0 ? { direction: direction ?? (to > from ? 1 : -1), serial: (state.spaceMove?.serial ?? 0) + 1 } : state.spaceMove,
    });
    refreshOverlay(store);
    sync();
  }

  /** Brings the window in line with Chromium's tabs and the spaces: run on every snapshot and change of spaces. */
  function sync() {
    const snapshot = store.getState().engineSnapshot;
    const prefs = shellPrefs.getState();
    if (!snapshot) return;
    const fresh = seen ? snapshot.tabs.filter(t => !seen!.has(t.id)) : [];
    seen = new Set(snapshot.tabs.map(t => t.id));
    for (const [id, space] of placing) if (!seen.has(id) || snapshot.tabs.some(t => t.id === id && t.space === space)) placing.delete(id);
    if (!prefs.spacesLoaded) return;
    if (!enabled()) {
      if (store.getState().activeSpace) { store.setState({ activeSpace: null }); refreshOverlay(store); }
      return;
    }
    const every = prefs.spaces;
    for (const [id, until] of incoming) if (Date.now() > until || store.getState().activeSpace === id) incoming.delete(id);
    if (!every.length) {
      // The first window to look makes the first space; every tab joins it.
      if (!makingFirst) { makingFirst = true; void setSpaces([firstSpace()]).finally(() => { makingFirst = false; }); }
      return;
    }
    // Tabs are placed only in the spaces with this window's data.
    const all = ownSpaces(every, snapshot.data || undefined);
    if (!all.length) {
      // Data no space has any more (its spaces deleted while it was closed):
      // a space of its own takes its tabs.
      if (!makingOwn && every.length < maxSpaces && !deletingData.has(snapshot.data ?? '')) {
        makingOwn = true;
        const data = snapshot.data && snapshot.data !== homeData ? snapshot.data : undefined;
        void setSpaces([...every, { id: newSpaceId(), name: nextName(every), icon: freshIcon(every), theme: null, ...(data ? { data } : {}) }])
          .finally(() => { makingOwn = false; });
      }
      return;
    }
    const activeTab = snapshot.tabs.find(t => t.id === snapshot.activeTabId);
    let active = store.getState().activeSpace;
    if (!active || !all.some(s => s.id === active)) {
      active = startingSpace(all, activeTab, null);
      if (!active) return;
      store.setState({ activeSpace: active });
      refreshOverlay(store);
    }
    // A new tab joins the space showing (or being arrived in), as a new tab
    // does in Zen. Chromium files it with the tab that opened it, which for
    // New Tab is whichever tab was active: perhaps a favourite, or the tab
    // just left.
    const target = arriving?.space ?? active;
    for (const tab of fresh) {
      if (tab.pinned || !tab.space || tab.space === target || incoming.has(tab.space) || !all.some(s => s.id === tab.space)) continue;
      place(tab.id, target);
    }
    const placed = (tab: { id: string; space?: string }) => placing.get(tab.id) ?? tab.space;
    if (arriving && (Date.now() > arriving.until || !activeTab || activeTab.pinned || placed(activeTab) === arriving.space)) arriving = null;
    // A tab chosen in another space (gt, Ctrl-Tab, a link, the palette) shows that space, as in Zen.
    const activeSpace = activeTab ? placed(activeTab) : undefined;
    if (!arriving && activeTab && !activeTab.pinned && activeSpace && activeSpace !== active &&
        all.some(s => s.id === activeSpace)) {
      show(activeSpace);
      return;
    }
    if (activeTab && !activeTab.pinned && (activeSpace ?? active) === active && store.getState().lastSelected[active] !== activeTab.id)
      store.setState(s => ({ lastSelected: { ...s.lastSelected, [active]: activeTab.id } }));
    // Not while a saved space is opening: Chromium has already switched to
    // it, and the space showing here is about to change too.
    if (!incoming.size) tell(active);
    // Tabs with no space yet, or whose space is gone, join the one showing;
    // not those of a saved space being opened, whose space is on its way.
    for (const tab of strays(snapshot.tabs, all)) {
      if (placing.has(tab.id) || (tab.space && incoming.has(tab.space))) continue;
      place(tab.id, active);
    }
  }

  function place(tabId: string, space: string) {
    if (placing.get(tabId) === space) return;
    placing.set(tabId, space);
    void engine.call('tabs.setSpace', { tabId, space }).catch(() => placing.delete(tabId));
  }

  /** Shows a space: its last selected tab, else its last tab, else a new tab in it (a favourite showing stays). */
  async function switchTo(id: string, direction?: 1 | -1) {
    const state = store.getState();
    const snapshot = state.engineSnapshot;
    const every = spaces();
    if (!snapshot || !state.activeSpace || id === state.activeSpace || !every.some(s => s.id === id)) return;
    if (!isOwn(id)) {
      // Another data's space: the window holding that data takes this one's
      // place and shows it. This window keeps showing its own space, hidden.
      const target = every.find(s => s.id === id)!;
      try { await engine.request('spaces.showData', { spaceId: id, data: dataOf(target) }); } catch (e) { fail(e); }
      return;
    }
    const all = mine();
    const activeTab = snapshot.tabs.find(t => t.id === snapshot.activeTabId);
    const target = arrivalTab(snapshot.tabs, id, all, state.activeSpace, state.lastSelected[id]);
    arriving = { space: id, until: Date.now() + arrivalMs };
    show(id, direction);
    try {
      if (target) { if (target.id !== snapshot.activeTabId) await engine.call('tabs.activate', { tabId: target.id }); }
      else if (!activeTab?.pinned) await engine.call('tabs.create', {});
    } catch (e) { fail(e); }
  }

  const save = (next: Space[]) => setSpaces(next).catch(fail);
  /** An icon no other space uses yet, so new spaces are told apart. */
  const freshIcon = (all: Space[]) => spaceIcons.find(icon => !all.some(s => s.icon === icon)) ?? 'circle.fill';
  const update = (id: string, change: Partial<Space>) => save(spaces().map(s => (s.id === id ? { ...s, ...change } : s)));
  const api = {
    sync,
    /** Shows space `id`. */
    switchSpace: (id: string, direction?: 1 | -1) => switchTo(id, direction),
    /** The next (1) or previous (-1) space, round the ends as in Zen. */
    stepSpace(step: 1 | -1) {
      const active = store.getState().activeSpace;
      const to = active ? neighbour(spaces(), active, step) : null;
      if (to) void switchTo(to.id, step);
    },
    /**
     * Makes a space after the others and shows it, as Arc's New Space does:
     * with the data of the space showing, or with data of its own (`ownData`),
     * logged out everywhere, with its own history, passwords, bookmarks,
     * extensions and favourites.
     */
    async createSpace(name?: string, theme?: WorkspaceTheme | null, ownData = false) {
      const all = spaces();
      if (!enabled()) return;
      if (all.length >= maxSpaces) { fail(new Error(`Merlin keeps at most ${maxSpaces} spaces`)); return; }
      const named = cleanName(name ?? '') || nextName(all);
      let data = windowData();
      if (ownData) {
        try { data = await engine.request('spaces.newData', { name: named }); } catch (e) { fail(e); return; }
      }
      const space: Space = { id: newSpaceId(), name: named, icon: freshIcon(spaces()), theme: theme ?? null,
        ...(data && data !== homeData ? { data } : {}) };
      await save([...spaces(), space]);
      await switchTo(space.id, 1);
    },
    renameSpace(id: string, name: string) {
      const clean = cleanName(name);
      if (clean) void update(id, { name: clean });
    },
    setSpaceIcon: (id: string, icon: string) => void update(id, { icon }),
    setSpaceTheme: (id: string, theme: WorkspaceTheme | null) => void update(id, { theme }),
    /** Moves a space to `index` in the switcher. */
    moveSpace(id: string, index: number) {
      const all = spaces();
      const space = all.find(s => s.id === id);
      if (!space) return;
      const rest = all.filter(s => s.id !== id);
      rest.splice(Math.max(0, Math.min(rest.length, index)), 0, space);
      void save(rest);
    },
    /**
     * Deletes a space everywhere and closes its tabs in this window; its saved
     * file, if any, stays. Data no other space uses goes with it.
     */
    async closeSpace(id: string) {
      const all = spaces();
      if (all.length < 2) { fail(new Error('Merlin keeps at least one space')); return; }
      const gone = all.find(s => s.id === id);
      if (!gone) return;
      const unused = dataLeftUnused(all, id);
      const state = store.getState();
      if (state.activeSpace === id) {
        const to = neighbour(all, id, -1, false) ?? neighbour(all, id, 1, false);
        if (to) await switchTo(to.id, to === neighbour(all, id, 1, false) ? 1 : -1);
      }
      const snapshot = store.getState().engineSnapshot;
      const doomed = snapshot && isOwn(id)
        ? tabsOf(snapshot.tabs, id, mine(), store.getState().activeSpace ?? id).filter(t => t.space === id) : [];
      // Its data, when no space has it now: its windows close with it. That
      // comes first, so its windows never see their data without a space
      // (they would make one for it).
      if (unused) {
        deletingData.add(dataOf(gone));
        try {
          await engine.request('spaces.deleteData', { data: dataOf(gone) });
          // Its WebKit pages' sign-ins and site data go too.
          await removeWebKitData(dataOf(gone)).catch(() => {});
        } catch (e) { deletingData.delete(dataOf(gone)); fail(e); return; }
        await save(spaces().filter(s => s.id !== id));
        return;
      }
      await save(spaces().filter(s => s.id !== id));
      for (const tab of doomed) {
        try { await engine.call('tabs.close', { tabId: tab.id }); } catch { /* Already closed. */ }
      }
    },
    /**
     * Puts a tab in another space; the window goes with it when it is the tab
     * showing. A space with other data opens the page again there, logged in
     * as that data is, and the tab here closes.
     */
    moveTabToSpace(tabId: string, id: string) {
      const target = spaces().find(s => s.id === id);
      if (target && !isOwn(id)) {
        void engine.request('spaces.moveTabToData', { tabId, spaceId: id, data: dataOf(target) }).catch(fail);
        return;
      }
      void engine.call('tabs.setSpace', { tabId, space: id }).catch(fail);
    },
    /** :space commands typed in the command line or sent by browserctl. */
    command(event: SpaceCommand) {
      if (!enabled()) { fail(new Error('This window has no spaces')); return; }
      const active = store.getState().activeSpace;
      const all = spaces();
      switch (event.verb) {
        case 'next': api.stepSpace(1); break;
        case 'prev': api.stepSpace(-1); break;
        case 'go': {
          const to = findSpace(all, event.arg);
          if (to) void switchTo(to.id);
          else fail(new Error(`No space ${event.arg}`));
          break;
        }
        case 'new': void api.createSpace(event.arg); break;
        case 'rename': if (active) api.renameSpace(active, event.arg); break;
        case 'close': if (active) void api.closeSpace(active); break;
        case 'switch': void switchTo(event.spaceId); break;
        case 'opened': {
          // A saved space opened here: the space kept under that name takes
          // its tabs (they join the space showing), else it becomes a space.
          const name = cleanName(event.arg) || nextName(all);
          // Its tabs came into this window, so with this window's data: a
          // space with other data under the same name doesn't take them.
          const own = mine();
          const known = own.find(s => s.saved === event.arg) ?? own.find(s => s.id === event.spaceId);
          arriving = { space: known?.id ?? event.spaceId, until: Date.now() + arrivalMs };
          if (known) { show(known.id); break; }
          if (all.length >= maxSpaces) { fail(new Error(`Merlin keeps at most ${maxSpaces} spaces`)); break; }
          const data = windowData();
          const space: Space = { id: event.spaceId, name, icon: freshIcon(all), theme: null, saved: event.arg,
            ...(data && data !== homeData ? { data } : {}) };
          incoming.set(space.id, Date.now() + incomingMs);
          void save([...all.map(s => (s.saved === event.arg ? { ...s, saved: undefined } : s)), space]).then(() => show(space.id));
          break;
        }
        case 'saved': {
          // One space per saved name.
          if (!all.some(s => s.id === event.spaceId && s.saved !== event.arg)) break;
          void save(all.map(s => (s.id === event.spaceId ? { ...s, saved: event.arg }
            : s.saved === event.arg ? { ...s, saved: undefined } : s)));
          break;
        }
        default: break;
      }
    },
  };
  return api;
}

export type SpaceActions = ReturnType<typeof createSpaces>;

/** Keeps the window's spaces in step with Chromium's snapshots and with changes to the spaces from any window. */
export function attachSpaces(store: BrowserStore, spaces: SpaceActions) {
  store.spaceCommand = spaces.command;
  const unsubscribeStore = store.subscribe((state, previous) => {
    if (state.engineSnapshot !== previous.engineSnapshot) spaces.sync();
  });
  const unsubscribePrefs = shellPrefs.subscribe((prefs, previous) => {
    if (prefs.spaces === previous.spaces && prefs.spacesLoaded === previous.spacesLoaded) return;
    refreshOverlay(store);
    spaces.sync();
  });
  spaces.sync();
  return () => { unsubscribeStore(); unsubscribePrefs(); store.spaceCommand = () => {}; };
}
