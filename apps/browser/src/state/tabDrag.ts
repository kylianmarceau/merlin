// Where a tab dragged out of the tabs would go. A pure rule, so it is tested
// without a window: the page's left or right half shows it beside the
// current tab (a split view); outside the window it becomes a window of its
// own. The current tab can't be split with itself, so over the page it too
// leaves for a new window.
import type { Rect } from './store';

export type TabDropZone = 'left' | 'right' | 'window';
/** A tab being dragged, with the pointer in window coordinates. `out` is set once it has left the tabs. */
export type TabDrag = { tabId: string; x: number; y: number; out: boolean; zone: TabDropZone | null };

export function tabDropZone(input: {
  x: number; y: number; window: { width: number; height: number }; page: Rect | undefined;
  /** The dragged tab is not the current one, so it can go beside it. */
  canSplit: boolean;
  /** The window has other tabs, so this one can leave it. */
  canDetach: boolean;
}): TabDropZone | null {
  const { x, y, window, page, canSplit, canDetach } = input;
  const outside = x < 0 || y < 0 || x > window.width || y > window.height;
  if (outside) return canDetach ? 'window' : null;
  if (!page || x < page.x || x > page.x + page.width || y < page.y || y > page.y + page.height) return null;
  if (canSplit) return x < page.x + page.width / 2 ? 'left' : 'right';
  return canDetach ? 'window' : null;
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
