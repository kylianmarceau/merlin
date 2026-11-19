// What the user changed about a tab's look in Merlin itself: a name of their
// own (Rename Tab) and a symbol in place of the page's icon (Change Icon), as
// in Ardia. Chromium knows nothing of these, so they are laid over each
// snapshot and last as long as the window. Pure, so it is tested alone.
import type { Snapshot, Tab } from '../platform/protocol';

export type TabLook = { name?: string; symbol?: string };
export type TabLooks = Record<string, TabLook>;

const dressedTabs = new WeakMap<Tab, { look: TabLook; tab: Tab }>();
const dressedSnapshots = new WeakMap<Snapshot, { looks: TabLooks; snapshot: Snapshot }>();

/**
 * The snapshot with each tab's name and symbol on it. The same objects come
 * back while nothing changed, so memoized rows skip rendering.
 */
export function dressSnapshot(snapshot: Snapshot, looks: TabLooks): Snapshot {
  if (!Object.keys(looks).length) return snapshot;
  const hit = dressedSnapshots.get(snapshot);
  if (hit && hit.looks === looks) return hit.snapshot;
  let changed = false;
  const tabs = snapshot.tabs.map(tab => {
    const look = looks[tab.id];
    if (!look) return tab;
    changed = true;
    const known = dressedTabs.get(tab);
    if (known && known.look === look) return known.tab;
    const next = { ...tab, name: look.name, symbol: look.symbol };
    dressedTabs.set(tab, { look, tab: next });
    return next;
  });
  const out = changed ? { ...snapshot, tabs } : snapshot;
  dressedSnapshots.set(snapshot, { looks, snapshot: out });
  return out;
}

/** `looks` with one tab's look changed; a look with nothing left in it goes, and closed tabs are forgotten. */
export function withLook(looks: TabLooks, tabId: string, change: TabLook, open: string[]): TabLooks {
  const next: TabLooks = {};
  for (const id of open) if (looks[id] && id !== tabId) next[id] = looks[id];
  const look = { ...looks[tabId], ...change };
  if (!look.name) delete look.name;
  if (!look.symbol) delete look.symbol;
  if (look.name || look.symbol) next[tabId] = look;
  return next;
}
