// The address field's suggestions: which rows answer which query, and what
// choosing one opens. Pure, so the unit tests can replay replies in any
// order; actions.ts and store.ts apply it.
import type { Suggestion } from '../platform/protocol';

/**
 * `queryId` and `text` are the latest query; `items` are the rows of query
 * `itemsQueryId`. Until the latest query's rows arrive the older ones stay
 * on screen, greyed, and can't be chosen: choosing one would open a match
 * for other text. `selected` is the highlighted suggestion; -1 means what
 * was typed. `owner` is the field that asked: the toolbar's address field
 * shows its list under itself; the start page and the new-tab pop-up show
 * theirs in place.
 */
export type SearchOwner = 'address' | 'search';
export type Omnibox = {
  queryId: string; text: string; items: Suggestion[]; itemsQueryId: string | null; selected: number; owner: SearchOwner;
};

/** The rows that answer the latest query, which are the only ones that can be chosen. */
export function currentSuggestions(omnibox: Omnibox | null): Suggestion[] {
  return omnibox && omnibox.itemsQueryId === omnibox.queryId ? omnibox.items : [];
}

/** A new query; the field's last rows stay, greyed, until its own arrive. */
export function startQuery(current: Omnibox | null, queryId: string, text: string, owner: SearchOwner): Omnibox {
  const kept = current?.owner === owner ? current : null;
  return { queryId, text, items: kept?.items ?? [], itemsQueryId: kept?.itemsQueryId ?? null, selected: -1, owner };
}

/** Rows from Chromium. Those of an older query never replace newer ones (null: unchanged). */
export function acceptResults(current: Omnibox | null, queryId: string, items: Suggestion[]): Omnibox | null {
  if (!current || current.queryId !== queryId) return null;
  return { ...current, items, itemsQueryId: queryId, selected: Math.min(current.selected, items.length - 1) };
}

/** Moves the highlight among the current rows; greyed rows can't be highlighted (null: unchanged). */
export function moveSelection(omnibox: Omnibox | null, delta: number): Omnibox | null {
  const items = currentSuggestions(omnibox);
  if (!omnibox || !items.length) return null;
  // A default top suggestion already shows as highlighted while nothing
  // is chosen, so moving starts from it and never goes above it.
  const top = items[0]?.default ? 0 : -1;
  const from = Math.max(top, omnibox.selected);
  return { ...omnibox, selected: Math.max(top, Math.min(items.length - 1, from + delta)) };
}

/**
 * What `omnibox.open` is sent for row `index`: the query the row came from,
 * its index and its address, which Chromium checks against its own list
 * before opening. Null for a greyed row or one that isn't there.
 */
export function suggestionChoice(omnibox: Omnibox | null, index: number): { queryId: string; index: number; url: string } | null {
  const item = currentSuggestions(omnibox)[index];
  return omnibox && item ? { queryId: omnibox.queryId, index, url: item.url } : null;
}
