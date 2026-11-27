// Spaces: sets of tabs a window shows one at a time, as in Zen and Arc.
//
// The design follows Zen's (src/zen/spaces/ZenSpaceManager.mjs): the window's
// interface owns the spaces and decides which tabs show, and each tab carries
// the ID of the space it belongs to, which Chromium keeps with the session
// (overlay/.../merlin_tab_space.cc), as Zen's session store keeps a tab's
// `zen-workspace-id`. The favourites (pinned tabs) are Zen's Essentials:
// every space shows them. A tab without a space yet, or whose space is gone,
// joins the one showing. Selecting a tab of another space shows that space.
// Picking a space shows the tab last selected there, else its last tab.
//
// The spaces themselves (name, icon, colour) are the same in every window,
// like Zen's; each window shows its own tabs in them. A space saved with
// :space save keeps its tabs in a file too (`saved`, the file's name).
//
// A space can keep its own data, as Arc's spaces have profiles: cookies,
// logins, passwords, history, bookmarks, extensions and favourites
// (`data`; several spaces can share it). Chromium keeps each data's tabs in
// a window of their own, so a Merlin window is a group of them in one place
// (overlay/.../merlin_space_windows.h): each places tabs only in its own
// data's spaces (`ownSpaces`), and going to a space with other data shows
// the window holding it. The interface calls this a space's data, never a
// profile.
//
// Pure rules, so they are tested without a window.
import type { SymbolName } from '../platform/shell';
import { isSpaceData, type Tab } from '../platform/protocol';
import { parseWorkspaceTheme, type WorkspaceTheme } from './workspaceTheme';

export type Space = {
  id: string;
  name: string;
  /** An SF Symbol from `spaceIcons`, or a single emoji. */
  icon: string;
  /** Its colour over the window, as Arc's and Zen's spaces have; null uses Appearance's. */
  theme: WorkspaceTheme | null;
  /** The name it is saved under on disk (:space save), when it is. */
  saved?: string;
  /** Its data (Snapshot.data); absent for Home's ("Default"). */
  data?: string;
};

/** The data Merlin started with: Home's, and every space's that doesn't keep its own. */
export const homeData = 'Default';

/** The data a space uses. */
export function dataOf(space: Pick<Space, 'data'>) {
  return space.data ?? homeData;
}

/**
 * The spaces whose tabs a window holding `data` keeps: those with that data.
 * All of them without data to go by (an engine that doesn't say).
 */
export function ownSpaces(spaces: readonly Space[], data: string | undefined): Space[] {
  if (!data) return [...spaces];
  return spaces.filter(s => dataOf(s) === data);
}

/** Whether deleting space `id` leaves its data unused, so the data goes too; never Home's. */
export function dataLeftUnused(spaces: readonly Space[], id: string) {
  const space = spaces.find(s => s.id === id);
  if (!space || dataOf(space) === homeData) return false;
  return !spaces.some(s => s.id !== id && dataOf(s) === dataOf(space));
}

/** Names as a sentence lists them: "Home", "Home and Work", "Home, Work and Study". */
export function listNames(names: readonly string[]) {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The other spaces that use the same data as space `id`, by name. */
export function sharingWith(spaces: readonly Space[], id: string) {
  const space = spaces.find(s => s.id === id);
  return space ? spaces.filter(s => s.id !== id && dataOf(s) === dataOf(space)).map(s => s.name) : [];
}

/** The icons a space can take (Change Icon). */
export const spaceIcons: readonly SymbolName[] = [
  'circle.fill', 'house', 'briefcase', 'book', 'graduationcap', 'paintpalette', 'chevron.left.forwardslash.chevron.right',
  'leaf', 'heart', 'star', 'flame', 'bolt', 'sparkles', 'atom', 'cup.and.saucer', 'music.note', 'film', 'gamecontroller',
  'camera', 'cart', 'airplane', 'dumbbell', 'pawprint', 'moon', 'sun.max', 'globe', 'flag', 'calendar',
];

/** The most spaces Merlin keeps, as Arc caps them: each needs a place in the switcher. */
export const maxSpaces = 12;
const maxName = 64;
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
/** A saved space's file name: letters, digits, '-', '_' and '.', starting with a letter or digit (workspace.rs). */
const savedPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

let counter = 0;
/** A new space's ID: unique among the spaces any window will see. */
export function newSpaceId(now = Date.now(), random = Math.random()) {
  counter = (counter + 1) % 1296;
  return `s${now.toString(36)}${counter.toString(36)}${Math.floor(random * 46656).toString(36)}`;
}

/** The first space, for a window that has none yet: every tab is in it, with Appearance's colour. */
export function firstSpace(id = newSpaceId()): Space {
  return { id, name: 'Home', icon: 'house', theme: null };
}

/** A name for a new space nobody named: "Space 2", "Space 3"… whichever is free. */
export function nextName(spaces: Space[]) {
  const taken = new Set(spaces.map(s => s.name.toLowerCase()));
  for (let n = spaces.length + 1; ; n++) if (!taken.has(`space ${n}`)) return `Space ${n}`;
}

/** A space name as typed: trimmed, one line, at most 64 characters. */
export function cleanName(name: string) {
  return [...name.replace(/\s+/g, ' ').trim()].slice(0, maxName).join('');
}

/** The file name a space would be saved under: its name with the characters files can't take dropped. */
export function savedNameFor(name: string) {
  const plain = name.normalize('NFKD').replace(/[^A-Za-z0-9._ -]/g, '').trim().replace(/\s+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  const cut = plain.slice(0, 64);
  return savedPattern.test(cut) ? cut : '';
}

/** Spaces read back from the preference, keeping only well-formed ones (and no two with one ID). */
export function parseSpaces(raw: string | null): Space[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Space[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Partial<Space>;
    if (typeof s.id !== 'string' || !idPattern.test(s.id) || seen.has(s.id) || typeof s.name !== 'string' ||
        typeof s.icon !== 'string' || !s.icon || s.icon.length > 64) continue;
    const name = cleanName(s.name);
    if (!name) continue;
    seen.add(s.id);
    const space: Space = { id: s.id, name, icon: s.icon, theme: parseWorkspaceTheme(s.theme) };
    if (typeof s.saved === 'string' && savedPattern.test(s.saved)) space.saved = s.saved;
    if (typeof s.data === 'string' && s.data !== homeData && isSpaceData(s.data)) space.data = s.data;
    out.push(space);
    if (out.length >= maxSpaces) break;
  }
  return out;
}

/**
 * The space a tab shows in, as Zen's `_shouldShowTab` decides: none for a
 * favourite (every space shows it); its own space while that exists; else,
 * like a tab that has none yet, the one showing.
 */
export function spaceOf(tab: Tab, spaces: readonly Space[], active: string): string | null {
  if (tab.pinned) return null;
  return tab.space && spaces.some(s => s.id === tab.space) ? tab.space : active;
}

/** The tabs a space shows of its own (not the favourites), in strip order. */
export function tabsOf(tabs: readonly Tab[], space: string, spaces: readonly Space[], active: string) {
  return tabs.filter(t => spaceOf(t, spaces, active) === space);
}

/** The tabs Chromium should hear are in the space showing: those without a space, or in one that's gone. */
export function strays(tabs: readonly Tab[], spaces: readonly Space[]) {
  return tabs.filter(t => !t.pinned && (!t.space || !spaces.some(s => s.id === t.space)));
}

/**
 * Which space a window shows when its interface starts, or after the space
 * it showed went: the active tab's, else the one it showed last, else the first.
 */
export function startingSpace(spaces: readonly Space[], activeTab: Tab | undefined, remembered: string | null) {
  if (activeTab && !activeTab.pinned && activeTab.space && spaces.some(s => s.id === activeTab.space)) return activeTab.space;
  if (remembered && spaces.some(s => s.id === remembered)) return remembered;
  return spaces[0]?.id ?? null;
}

/** The space `step` places along from `id` (1 next, -1 previous), round the ends when `wrap`; null when there is none. */
export function neighbour(spaces: readonly Space[], id: string, step: number, wrap = true): Space | null {
  const at = spaces.findIndex(s => s.id === id);
  if (at < 0 || !spaces.length) return spaces[0] ?? null;
  const to = at + step;
  if (to >= 0 && to < spaces.length) return spaces[to];
  if (!wrap || spaces.length < 2) return null;
  return spaces[((to % spaces.length) + spaces.length) % spaces.length];
}

/** `:space go` names a space by its number (from 1) or its name (any case). */
export function findSpace(spaces: readonly Space[], query: string): Space | null {
  const q = query.trim();
  if (/^\d+$/.test(q)) return spaces[Number(q) - 1] ?? null;
  const lower = q.toLowerCase();
  return spaces.find(s => s.name.toLowerCase() === lower) ?? spaces.find(s => s.name.toLowerCase().startsWith(lower)) ?? null;
}

/**
 * The tab to show on arriving in a space: the one last selected there while it
 * is still in it, else its last tab (as Zen does), else none: the window
 * then opens a new tab there, or keeps showing a favourite.
 */
export function arrivalTab(tabs: readonly Tab[], space: string, spaces: readonly Space[], active: string, last: string | undefined) {
  const own = tabsOf(tabs, space, spaces, active);
  return own.find(t => t.id === last) ?? own[own.length - 1] ?? null;
}

/** The saved spaces a window has, by saved name, for :space open to show one instead of opening it twice. */
export function savedSpaces(spaces: readonly Space[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of spaces) if (s.saved) out[s.saved] = s.id;
  return out;
}

/** How far a swipe must go, as a share of the area's width, to change space (Zen's success threshold). */
export const swipeThreshold = 0.25;
/** How much of the fingers' speed counts toward it (Zen's velocity contribution), per point per second. */
const swipeVelocityShare = 0.5 / 1000;

/**
 * What a two-finger swipe does when let go, as in Zen: past a quarter of the
 * width (the fingers' speed helps), the next or previous space; left past the
 * last space, a new one; otherwise nothing. `dx` is the fingers' movement:
 * leftward shows the space to the right, as pages turn.
 */
export function swipeOutcome(dx: number, velocity: number, width: number, index: number, count: number):
  { kind: 'switch'; to: number } | { kind: 'create' } | { kind: 'stay' } {
  if (width <= 0) return { kind: 'stay' };
  const progress = -dx / width - velocity * swipeVelocityShare;
  if (Math.abs(progress) < swipeThreshold) return { kind: 'stay' };
  const to = index + (progress > 0 ? 1 : -1);
  if (to >= count) return count < maxSpaces ? { kind: 'create' } : { kind: 'stay' };
  if (to < 0) return { kind: 'stay' };
  return { kind: 'switch', to };
}

/** How far the space follows the fingers: freely toward a neighbour, with growing resistance past the ends. */
export function swipeOffset(dx: number, index: number, count: number, width: number) {
  const towardEnd = (dx > 0 && index === 0) || (dx < 0 && index === count - 1);
  if (!towardEnd || width <= 0) return dx;
  // Past the last space the fingers pull a new one in, so that way gives a little more.
  const reach = dx < 0 ? width * 0.35 : width * 0.12;
  return Math.sign(dx) * reach * (1 - 1 / (Math.abs(dx) / reach + 1));
}

/**
 * What the window shows of a snapshot with `active` showing, as Zen hides
 * other spaces' tabs: the favourites and the space's own tabs, and always
 * the active tab (and the split beside it) while the window catches up with
 * a tab chosen in another space. Groups with nothing left go too. The same
 * object comes back when nothing is hidden.
 */
export function spaceView<S extends { tabs: Tab[]; activeTabId: string | null; groups?: { id: string }[] }>(
  snapshot: S, spaces: readonly Space[], active: string | null): S {
  if (!active || !spaces.length) return snapshot;
  const current = snapshot.tabs.find(t => t.id === snapshot.activeTabId);
  const split = current?.split;
  const tabs = snapshot.tabs.filter(t => t.pinned || t.id === snapshot.activeTabId || (!!split && t.split === split) ||
    spaceOf(t, spaces, active) === active);
  if (tabs.length === snapshot.tabs.length) return snapshot;
  const used = new Set(tabs.map(t => t.group).filter(Boolean));
  return { ...snapshot, tabs, ...(snapshot.groups ? { groups: snapshot.groups.filter(g => used.has(g.id)) } : {}) };
}
