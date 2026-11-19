// The window context: its store and actions. Components read state through
// useBrowser and act through useActions; neither exposes the engine.
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { connectEngine } from '../platform/engine';
import { copyText, onMenuCommand, releaseVersion, setMenuState } from '../platform/shell';
import { setShellPref } from './shellPrefsStorage';
import { shellPrefs, useShellPrefs } from './shellPrefs';
import type { Request, Requests } from '../platform/protocol';
import { settle, type ActionResult } from '../lib/result';
import { createActions, type Actions } from './actions';
import { attachEngine, createBrowserStore, pushToast, snapshotAccepted, timeSnapshots, type BrowserState, type BrowserStore } from './store';
import { traceNow, traceTiming, tracing } from './trace';
import { followUpdateSetting } from './updates';
import { overlays } from './surfaces';
import { attachWebKit } from './webkit';

timeSnapshots(tracing);

type Window = { store: BrowserStore; actions: Actions };
const WindowContext = createContext<Window | null>(null);

// Open windows, newest last: app-wide notices (an update) go to one of them.
const open: Window[] = [];
let updatesFollowed = false;
function followUpdates() {
  if (updatesFollowed) return;
  updatesFollowed = true;
  followUpdateSetting(update => {
    const window = open[open.length - 1];
    if (window) pushToast(window.store, `${update.name} is available.`, 'info',
      { label: 'View', run: () => void window.actions.newTab(update.url) });
  });
}

/**
 * The window's line to Chromium for its error boundary (InterfaceBoundary),
 * apart from the window's own connection, which may be what failed. Reports
 * never throw; `reloadWindow` says whether Chromium will give the window a
 * new root.
 */
export function interfaceReporter(windowId: string) {
  let engine: ReturnType<typeof connectEngine> | null = null;
  const client = () => (engine ??= connectEngine(windowId));
  return {
    report(state: 'ready' | 'failed', message?: string, stack?: string) {
      try {
        void client().call('shell.report', { state, ...(message ? { message: message.slice(0, 4096) } : {}),
          ...(stack ? { stack: stack.slice(0, 32 * 1024) } : {}) }).catch(() => undefined);
      } catch { /* No engine: nothing to tell. */ }
    },
    async reloadWindow(): Promise<boolean> {
      try { await client().call('shell.reloadWindow', {}); return true; } catch { return false; }
    },
    version: releaseVersion,
    async copy(text: string): Promise<boolean> {
      try { await copyText(text); return true; } catch { return false; }
    },
  };
}

/** Connects one window to Chromium. A missing engine is shown, never papered over. */
export function useWindowConnection(windowId: string) {
  const [connection] = useState(() => {
    const store = createBrowserStore(windowId);
    try {
      const engine = connectEngine(windowId, tracing
        ? (ms, bytes) => traceTiming('event-parse', ms, { bytes, window: windowId }) : undefined);
      return { store, actions: createActions(store, engine), engine };
    } catch (e) {
      store.setState({ connectionError: e instanceof Error ? e.message : String(e) });
      return { store, actions: null, engine: null };
    }
  });
  useEffect(() => {
    const { engine, store, actions } = connection;
    if (!engine || !actions) return undefined;
    // WebKit first: Chromium's first snapshot already shows its WebKit tabs.
    const detachWebKit = attachWebKit(store, engine, url => void actions.newTab(url));
    const detachEngine = attachEngine(store, engine);
    const window = { store, actions };
    open.push(window);
    followUpdates();
    return () => { detachEngine(); detachWebKit(); open.splice(open.indexOf(window), 1); };
  }, [connection]);
  return connection;
}

export function WindowProvider({ store, actions, children }: React.PropsWithChildren<Window>) {
  const value = React.useMemo(() => ({ store, actions }), [store, actions]);
  return <WindowContext.Provider value={value}>{children}</WindowContext.Provider>;
}

function useWindow() {
  const window = useContext(WindowContext);
  if (!window) throw new Error('Window components need a WindowProvider');
  return window;
}

/**
 * With tracing on, a "snapshot-commit" line for each snapshot this window
 * draws: from its arrival to React's commit (checking it, the WebKit overlay,
 * rendering and committing).
 */
export function useCommitTrace() {
  const { store } = useWindow();
  const revision = useStore(store, s => s.snapshot?.revision);
  useLayoutEffect(() => {
    const accepted = tracing ? snapshotAccepted.get(store) : undefined;
    if (accepted && accepted.revision === revision) {
      traceTiming('snapshot-commit', traceNow() - accepted.at, { tabs: accepted.tabs, rev: accepted.revision });
    }
  }, [store, revision]);
}

export function useBrowser<T>(select: (state: BrowserState) => T): T {
  return useStore(useWindow().store, select);
}
export function useActions(): Actions {
  return useWindow().actions;
}
/** The window's snapshot; only mounted once one has arrived. */
export function useSnapshot() {
  const snapshot = useBrowser(s => s.snapshot);
  if (!snapshot) throw new Error('The browser snapshot has not arrived');
  return snapshot;
}
export function useActiveTab() {
  return useBrowser(s => s.snapshot?.tabs.find(t => t.id === s.snapshot?.activeTabId));
}
export function useOverlays() {
  const snapshot = useSnapshot();
  const panel = useBrowser(s => s.panel);
  const popover = useBrowser(s => s.popover);
  const revealed = useBrowser(s => s.revealedPromptId);
  return overlays(snapshot, panel, popover, revealed);
}

export type Loaded<T> = { data: T | null; error: string | null; loading: boolean; reload(): void; set(value: T): void };

/**
 * Loads one browser request and reloads it on demand. A response that arrives
 * after the component closed, or after a newer load, is ignored.
 */
export function useRequest<R extends Request>(method: R, args: Requests[R]['args'], deps: unknown[] = []): Loaded<Requests[R]['result']> {
  const actions = useActions();
  const [data, setData] = useState<Requests[R]['result'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    actions.request(method, args).then(value => {
      if (alive.current && mine === generation.current) { setData(value); setError(null); setLoading(false); }
    }, e => {
      if (alive.current && mine === generation.current) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, method, ...deps]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load, set: value => { generation.current++; setData(value); setLoading(false); } };
}

export type { ActionResult };

/**
 * Runs a browser request from a control, reporting failure in place. `run`
 * resolves to the request's own outcome, so a caller acts on that, not on
 * `error`, which still holds the state from before the request.
 */
export function useAction() {
  const actions = useActions();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback(async <R extends Request>(method: R, args: Requests[R]['args'],
    timeoutMs?: number): Promise<ActionResult<Requests[R]['result']>> => {
    setBusy(true); setError(null);
    const result = await settle(() => actions.request(method, args, timeoutMs));
    if (alive.current) { if (!result.ok) setError(result.error); setBusy(false); }
    return result;
  }, [actions]);
  return { run, error, busy, clearError: () => setError(null) };
}

/**
 * Merlin's items in the menu bar's View menu (tabs in the sidebar or on top,
 * hide tabs, split view, the address in the toolbar): this window keeps
 * their checkmarks while it is in front and carries out the ones chosen
 * while it is, or while it is the only window.
 */
export function useViewMenu() {
  const { store, actions } = useWindow();
  const key = useStore(store, s => s.windowKey);
  const top = useStore(store, s => s.snapshot?.modal.tabLayout === 'top');
  const hidden = useStore(store, s => !!s.snapshot?.modal.sidebarHidden);
  const split = useStore(store, s => !!s.snapshot?.tabs.find(t => t.id === s.snapshot?.activeTabId)?.split);
  const partner = useStore(store, s => s.recentTabs.find(id => id !== s.snapshot?.activeTabId && s.snapshot?.tabs.some(t => t.id === id)) ?? null);
  const addressInToolbar = useShellPrefs(p => p.addressBar === 'toolbar');
  const front = () => store.getState().windowKey || open.length === 1;
  useEffect(() => {
    if (key || open.length === 1) setMenuState({ window: true, top, hidden, split, canSplit: !!partner, addressInToolbar });
  }, [key, top, hidden, split, partner, addressInToolbar]);
  useEffect(() => {
    const listener = onMenuCommand(id => {
      if (!front()) return;
      const s = store.getState().snapshot;
      const active = s?.tabs.find(t => t.id === s.activeTabId);
      switch (id) {
        case 'tabs.side': case 'tabs.top':
          void actions.request('settings.set', { key: 'tabs', value: id === 'tabs.top' ? 'top' : 'side' }).catch(() => undefined);
          break;
        case 'tabs.hide': void actions.command('sidebar'); break;
        case 'split': {
          if (!active) break;
          if (active.split) { void actions.unsplitTab(active.id); break; }
          const other = store.getState().recentTabs.find(t => t !== active.id && s?.tabs.some(x => x.id === t));
          if (other) void actions.splitTab(other);
          break;
        }
        case 'address.toolbar':
          void setShellPref('addressBar', shellPrefs.getState().addressBar === 'toolbar' ? 'sidebar' : 'toolbar');
          break;
        default: break;
      }
    });
    return () => listener.remove();
  }, [store, actions]);  // eslint-disable-line react-hooks/exhaustive-deps
}
