// Folders of favourites, as Ardia's Top Apps have: one tile that holds
// several pinned sites and opens to show them. Pinned tabs come and go with
// windows and sessions, so a folder names its members by their pinned home
// page (`homeKey`), saved with the shell's preferences. Pure rules, tested
// without a window.
import type { Tab } from './types';

export type FavouriteFolder = { id: string; name: string; members: string[] };
/** A slot of the favourite grid: one pinned tab, or a folder with the pinned tabs in it. */
export type GridItem = { kind: 'tab'; id: string; tab: Tab } | { kind: 'folder'; id: string; folder: FavouriteFolder; tabs: Tab[] };

/** A pinned page as a folder remembers it: its origin and path, without the query or fragment. */
export function homeKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}`;
  } catch {
    return url;
  }
}

/**
 * The grid's slots for the pinned tabs in their order: a folder takes the
 * place of its first member present, and gathers the rest. A folder with
 * only one member here shows as that tab.
 */
export function gridItems(pinned: Tab[], keyOf: (tab: Tab) => string, folders: FavouriteFolder[]): GridItem[] {
  const items: GridItem[] = [];
  const open = new Map<string, Extract<GridItem, { kind: 'folder' }>>();
  for (const tab of pinned) {
    const key = keyOf(tab);
    const folder = folders.find(f => f.members.includes(key));
    if (!folder) { items.push({ kind: 'tab', id: tab.id, tab }); continue; }
    const there = open.get(folder.id);
    if (there) { there.tabs.push(tab); continue; }
    const item = { kind: 'folder' as const, id: folderItemId(folder.id), folder, tabs: [tab] };
    open.set(folder.id, item);
    items.push(item);
  }
  return items.map(item => (item.kind === 'folder' && item.tabs.length < 2 ? { kind: 'tab', id: item.tabs[0].id, tab: item.tabs[0] } : item));
}

export const folderItemId = (folderId: string) => `folder:${folderId}`;

/** Folders that still hold two or more members; a folder of one is no folder. */
const pruned = (folders: FavouriteFolder[]) => folders.filter(f => f.members.length >= 2);

/**
 * `key` dropped onto `target`: it joins the target's folder, or the two make
 * a new one (`newId`). It leaves any folder it was in first.
 */
export function foldInto(folders: FavouriteFolder[], key: string, target: string, newId: string): FavouriteFolder[] {
  if (key === target) return folders;
  const rest = folders.map(f => ({ ...f, members: f.members.filter(m => m !== key) }));
  const home = rest.find(f => f.members.includes(target));
  const next = home
    ? rest.map(f => (f === home ? { ...f, members: [...f.members, key] } : f))
    : [...rest, { id: newId, name: '', members: [target, key] }];
  return pruned(next);
}

/** `key` taken out of its folder; the folder goes once it holds only one. */
export function leaveFolder(folders: FavouriteFolder[], key: string): FavouriteFolder[] {
  return pruned(folders.map(f => ({ ...f, members: f.members.filter(m => m !== key) })));
}

export function renameFolder(folders: FavouriteFolder[], id: string, name: string): FavouriteFolder[] {
  return folders.map(f => (f.id === id ? { ...f, name: name.trim() } : f));
}

export function ungroupFolder(folders: FavouriteFolder[], id: string): FavouriteFolder[] {
  return folders.filter(f => f.id !== id);
}

/** The folders as saved; anything malformed is dropped rather than trusted. */
export function parseFolders(raw: string | null): FavouriteFolder[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return pruned(value.filter((f): f is FavouriteFolder => !!f && typeof f === 'object' && typeof f.id === 'string' && !!f.id &&
      typeof f.name === 'string' && Array.isArray(f.members) && f.members.every((m: unknown) => typeof m === 'string'))
      .map(f => ({ id: f.id, name: f.name, members: [...new Set(f.members)] })));
  } catch {
    return [];
  }
}

/** A folder's name as shown: its own, or its members' count. */
export function folderTitle(folder: FavouriteFolder, count: number): string {
  return folder.name || `${count} Favourites`;
}
