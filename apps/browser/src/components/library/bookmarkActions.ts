import type { BookmarkItem } from '../../state/types';
import type { RowAction, RowKey } from '../ui';

/** The keys a focused bookmark row answers to. */
export const bookmarkKeys: Record<'up' | 'down' | 'remove', RowKey> = {
  up: { key: 'ArrowUp', altKey: true }, down: { key: 'ArrowDown', altKey: true }, remove: { key: 'Backspace', metaKey: true },
};

/**
 * What can be done to a bookmark row without a pointer, in the order its
 * buttons show: move up and down (not in search results, which have no
 * order to change, and not past either end), edit and delete. A row Chromium
 * won't let anyone change (the bar and other managed folders) has none.
 */
export function bookmarkRowActions(item: BookmarkItem, place: { index: number; count: number; searching: boolean }, run: {
  move(delta: -1 | 1): void; edit(): void; remove(): void;
}): RowAction[] {
  if (!item.editable) return [];
  const name = item.title || item.url || 'Untitled';
  const actions: RowAction[] = [];
  if (!place.searching && place.index > 0) {
    actions.push({ name: 'moveUp', label: 'Move Up', key: bookmarkKeys.up, run: () => run.move(-1) });
  }
  if (!place.searching && place.index < place.count - 1) {
    actions.push({ name: 'moveDown', label: 'Move Down', key: bookmarkKeys.down, run: () => run.move(1) });
  }
  actions.push({ name: 'edit', label: item.folder ? `Rename ${name}` : `Edit ${name}`, run: run.edit });
  actions.push({ name: 'delete', label: `Delete ${name}`, key: bookmarkKeys.remove, run: run.remove });
  return actions;
}

