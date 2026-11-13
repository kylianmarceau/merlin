// The window context: its store and actions. Components read state through
// useBrowser and act through useActions; neither exposes the engine.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { connectEngine } from '../platform/engine';
import type { Request, Requests } from '../platform/protocol';
import { createActions, type Actions } from './actions';
import { attachEngine, createBrowserStore, type BrowserState, type BrowserStore } from './store';
import { overlays } from './surfaces';
import { attachWebKit } from './webkit';

type Window = { store: BrowserStore; actions: Actions };
const WindowContext = createContext<Window | null>(null);

/** Connects one window to Chromium. A missing engine is shown, never papered over. */
export function useWindowConnection(windowId: string) {
  const [connection] = useState(() => {
    const store = createBrowserStore(windowId);
    try {
      const engine = connectEngine(windowId);
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
    return () => { detachEngine(); detachWebKit(); };
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

/** Runs a browser request from a control, reporting failure in place. */
export function useAction() {
  const actions = useActions();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback(async <R extends Request>(method: R, args: Requests[R]['args'], timeoutMs?: number) => {
    setBusy(true); setError(null);
    try { return await actions.request(method, args, timeoutMs); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); return undefined; }
    finally { if (alive.current) setBusy(false); }
  }, [actions]);
  return { run, error, busy, clearError: () => setError(null) };
}
