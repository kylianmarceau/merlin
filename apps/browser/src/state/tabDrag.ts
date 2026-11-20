// Where a tab dragged out of the tabs would go, as in Ardia. Over the page,
// every pane on screen except the dragged tab's own shows two drop zones,
// one by each edge; letting go on one shows the tab on that side of the pane
// in a split view. When the dragged tab is the only page on screen (a strip
// tab comes forward as soon as it is pressed), its own pane offers a split
// with the tab used most recently before it. Anywhere else on the page, or
// outside the window, the tab leaves for a window of its own. Pure rules, so
// they are tested without a window.
import type { Split } from '../platform/protocol';
import type { Rect } from './store';

export type SplitSide = 'left' | 'right';
/** The pane a dragged tab would go beside, and on which side of it. */
export type DropTarget = { tabId: string; side: SplitSide };
/**
 * A tab being dragged, with the pointer in window coordinates. `out` is set
 * once it has left the tabs; `target` is the drop zone under it, if any.
 */
export type TabDrag = { tabId: string; x: number; y: number; out: boolean; target: DropTarget | null };
/** What letting go does: show the tab in a split view, give it a window of its own, or nothing. */
export type DropOutcome = { kind: 'split'; target: DropTarget } | { kind: 'window' } | null;

/**
 * A zone's size as shares of its pane: small as the tab leaves the tabs,
 * grown a moment later, and a little larger under the pointer.
 */
const stages = {
  rest: { width: 0.1324, height: 0.383, inset: 0.025 },
  grown: { width: 0.215, height: 0.611, inset: 0.02 },
  active: { width: 0.241, height: 0.69, inset: 0.02 },
} as const;
export type ZoneStage = keyof typeof stages;
/** How far the zone under the pointer leans towards it. */
const lean = 0.43;
/** The dragged tab's footprint for hitting a zone, centred on the pointer: a zone is hit once this overlaps it. */
export const dropFootprint = { width: 209, height: 110 } as const;

/** Where a zone shows in its pane. The one under the pointer leans towards it, staying inside the pane. */
export function zoneRect(pane: Rect, side: SplitSide, stage: ZoneStage, pointerX = 0): Rect {
  const s = stages[stage];
  const width = pane.width * s.width;
  const height = pane.height * s.height;
  const inset = pane.width * s.inset;
  const y = pane.y + (pane.height - height) / 2;
  if (stage !== 'active') return { x: side === 'left' ? pane.x + inset : pane.x + pane.width - inset - width, y, width, height };
  const home = zoneRect(pane, side, 'grown');
  const centre = home.x + home.width / 2;
  const x = Math.max(pane.x + inset, Math.min(pane.x + pane.width - inset - width, centre + (pointerX - centre) * lean - width / 2));
  return { x, y, width, height };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
export const contains = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/**
 * The zone a tab dragged to (px, py) would drop into: of the zones its
 * footprint overlaps, the one whose centre is nearest. The current zone
 * keeps the pointer until the footprint leaves it, so the choice doesn't
 * flicker between neighbours.
 */
export function zoneHit(candidates: [string, Rect][], px: number, py: number, current: DropTarget | null): DropTarget | null {
  const card = { x: px - dropFootprint.width / 2, y: py - dropFootprint.height / 2, ...dropFootprint };
  let best: (DropTarget & { distance: number }) | null = null;
  for (const [tabId, pane] of candidates) {
    for (const side of ['left', 'right'] as const) {
      const keep = current?.tabId === tabId && current.side === side;
      const r = zoneRect(pane, side, keep ? 'active' : 'grown', px);
      if (!overlaps(card, r)) continue;
      const distance = keep ? -1 : Math.abs(r.x + r.width / 2 - px);
      if (!best || distance < best.distance) best = { tabId, side, distance };
    }
  }
  return best && { tabId: best.tabId, side: best.side };
}

/**
 * The panes a dragged tab can go beside, each with where its zones show: the
 * panes on screen other than its own. Alone on screen, it offers its own
 * pane for a split with `partner`.
 */
export function dropCandidates(panes: Record<string, Rect>, dragged: string, partner: string | null): [string, Rect][] {
  const others = Object.entries(panes).filter(([id]) => id !== dragged);
  if (others.length) return others;
  const own = panes[dragged];
  return own && partner && partner !== dragged ? [[partner, own]] : [];
}

/** The tab a dragged tab shown alone would split with: the one used most recently before it, else its neighbour in the tabs. */
export function splitPartner(dragged: string, tabIds: string[], recent: string[]): string | null {
  const open = new Set(tabIds);
  const used = recent.find(id => id !== dragged && open.has(id));
  if (used) return used;
  const at = tabIds.indexOf(dragged);
  return at < 0 ? null : tabIds[at - 1] ?? tabIds[at + 1] ?? null;
}

/** How many recently used tabs are remembered for splitting with. */
const recentLimit = 32;

/** Tabs most recently active first, once `activeId` is: closed tabs leave the list. Unchanged lists are returned as they were. */
export function rememberActive(recent: string[], activeId: string | null, tabIds: string[]): string[] {
  const open = new Set(tabIds);
  const kept = recent.filter(id => id !== activeId && open.has(id));
  const next = (activeId && open.has(activeId) ? [activeId, ...kept] : kept).slice(0, recentLimit);
  return next.length === recent.length && next.every((id, i) => id === recent[i]) ? recent : next;
}

/**
 * Where each page on screen is, within the page area: both sides of a split
 * view (sharing the area by its ratio, as the page area lays them out, with
 * `gap` between them), else the active tab's page.
 */
export function paneRects(page: Rect, split: Split | null | undefined, activeId: string | null, gap: number): Record<string, Rect> {
  if (!activeId) return {};
  if (!split || !split.tabs.includes(activeId)) return { [activeId]: page };
  const stacked = split.layout === 'stacked';
  const shares = split.tabs.map((_, i) => Math.min(Math.max(i === 0 ? split.ratio : 1 - split.ratio, 0.1), 0.9));
  const sum = shares.reduce((a, b) => a + b, 0);
  const room = (stacked ? page.height : page.width) - gap * (split.tabs.length - 1);
  const rects: Record<string, Rect> = {};
  let at = stacked ? page.y : page.x;
  split.tabs.forEach((id, i) => {
    const size = room * shares[i] / sum;
    rects[id] = stacked ? { x: page.x, y: at, width: page.width, height: size } : { x: at, y: page.y, width: size, height: page.height };
    at += size + gap;
  });
  return rects;
}

/**
 * What letting go of a tab dragged out of the tabs at (x, y) does: on a drop
 * zone, a split view; elsewhere on the page or outside the window, a window
 * of its own (when it isn't the window's only tab); over the window's
 * controls, nothing.
 */
export function dropOutcome(input: {
  x: number; y: number; window: { width: number; height: number }; page: Rect | undefined; target: DropTarget | null;
  /** The window has other tabs, so this one can leave it. */
  canDetach: boolean;
}): DropOutcome {
  const { x, y, window, page, target, canDetach } = input;
  const outside = x < 0 || y < 0 || x > window.width || y > window.height;
  if (outside) return canDetach ? { kind: 'window' } : null;
  if (target) return { kind: 'split', target };
  return page && contains(page, x, y) && canDetach ? { kind: 'window' } : null;
}

/** The tab's new place among `ids` (the tabs it is reordered within) after moving `steps` rows: the ID it goes before, or null for the end. */
export function reorderTarget(ids: string[], id: string, steps: number): { index: number; beforeId: string | null } | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  const index = Math.max(0, Math.min(ids.length - 1, from + steps));
  if (index === from) return null;
  const rest = ids.filter(other => other !== id);
  return { index, beforeId: rest[index] ?? null };
}

/** A row being dragged within the sidebar's list: where it started among the rows and how many places it has moved. */
export type ListDrag = { tabId: string; from: number; steps: number };

/**
 * How many rows the row at `place` slides while another is dragged, as in
 * Ardia: the rows between the dragged row's start and where it would land
 * move one place towards its start, making room; the rest hold still.
 */
export function rowShift(drag: ListDrag | null, place: number): number {
  if (!drag || place < 0 || place === drag.from) return 0;
  const to = drag.from + drag.steps;
  if (drag.steps > 0 && place > drag.from && place <= to) return -1;
  if (drag.steps < 0 && place >= to && place < drag.from) return 1;
  return 0;
}

/**
 * The row a dragged row rests on, for grouping on contact, as in Ardia: the
 * dragged row, `rows` places from where it started (a fraction while it
 * moves), sits squarely over another row. Its index among `count` rows, or
 * null between rows or over its own place. `held` widens the band once
 * contact is made, so it doesn't flicker at its edge.
 */
export function contactRow(from: number, rows: number, count: number, held = false): number | null {
  const near = Math.round(rows);
  const index = from + near;
  if (near === 0 || index < 0 || index >= count) return null;
  return Math.abs(rows - near) <= (held ? contactBand.held : contactBand.enter) ? index : null;
}
/** How far off a row's centre, in rows, the dragged row may be to make contact, and to keep it. */
export const contactBand = { enter: 0.22, held: 0.36 } as const;
