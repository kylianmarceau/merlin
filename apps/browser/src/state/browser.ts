import { createStore } from 'zustand/vanilla';
import { validateSnapshot, type Snapshot, type EngineClient, type PanelName } from '@merlin/engine/protocol';

export type Panel = PanelName | 'command' | 'tab' | null;
export type BrowserState = {
  snapshot: Snapshot | null; panel: Panel; error: string | null; addressFocus: number; addressRevert: number;
  setPanel(panel: Panel): void;
  accept(snapshot: Snapshot): void;
};

export function createBrowserStore(windowId: string) {
  return createStore<BrowserState>((set, get) => ({
    snapshot: null, panel: null, error: null, addressFocus: 0, addressRevert: 0,
    setPanel: panel => set({ panel }),
    accept: input => {
      const next = validateSnapshot(input, windowId);
      const current = get().snapshot;
      if (current && current.session === next.session && current.revision >= next.revision) return;
      // A download tick or title change must not dismiss an action error while
      // the user is reading it. Only initial connection recovery clears it.
      set({ snapshot: next, ...(current ? {} : { error: null }) });
    },
  }));
}
export type BrowserStore = ReturnType<typeof createBrowserStore>;

export function attachEngine(store: BrowserStore, engine: EngineClient) {
  let disposed = false;
  const fail = (e: unknown) => { if (!disposed) store.setState({ error: e instanceof Error ? e.message : String(e) }); };
  // Subscribe before reading, so a tab event cannot fall between snapshot and subscription.
  const unsubscribe = engine.subscribe(event => {
    if (disposed) return;
    try {
      if (event.type === 'snapshot') store.getState().accept(event.snapshot);
      else if (event.type === 'address.focus') store.setState(s => ({ addressFocus: s.addressFocus + 1 }));
      else if (event.type === 'address.revert') store.setState(s => ({ addressRevert: s.addressRevert + 1 }));
      else if (event.type === 'command.open') store.getState().setPanel('command');
      else if (event.type === 'panel.open') store.getState().setPanel(event.panel);
      else if (event.type === 'engine.error') store.setState({ error: event.message });
    } catch (e) { fail(e); }
  });
  void engine.call('window.snapshot', {}).then(snapshot => {
    if (!disposed) store.getState().accept(snapshot);
  }).catch(fail);
  return () => { disposed = true; unsubscribe(); };
}
