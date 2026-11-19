import { useRef, useState } from 'react';
import { currentSuggestions } from '../../state/store';
import type { Suggestion } from '../../state/types';
import { useActions, useBrowser } from '../../state/window';
import { duration, useHeld } from '../ui';

/**
 * A search-or-address field with Chromium's suggestions, as the toolbar's
 * address field has them: the start page's field and the new-tab pop-up.
 * Their suggestions show in place, never under the toolbar.
 */
export function useSearch(initial = '') {
  const actions = useActions();
  const omnibox = useBrowser(s => s.omnibox);
  const [text, setText] = useState(initial);
  const deleting = useRef(false);
  const typing = !!text.trim();
  const edited = text !== initial;
  const mine = typing && omnibox?.owner === 'search' && omnibox.text === text ? omnibox : null;
  const suggestions: Suggestion[] = mine?.items ?? [];
  // Rows of an older query stay until this text's arrive; they can't be chosen.
  const pending = !!mine && !currentSuggestions(mine).length;
  // They look as they did unless the answer is slow, when they grey out:
  // greying them at once flashed the list on every keystroke.
  const stale = useHeld(pending, duration.staleRows);
  // -1 is what was typed; Enter then opens the top suggestion when it is Chromium's default, as the address field does.
  const chosen = mine && !pending ? (mine.selected >= 0 ? mine.selected : suggestions[0]?.default ? 0 : -1) : -1;
  // While the older rows still look current, so does their highlight.
  const selected = pending && !stale ? (suggestions[0]?.default ? 0 : -1) : chosen;
  return {
    text, typing, edited, suggestions, stale, selected,
    change(next: string) {
      deleting.current = next.length < text.length;
      setText(next);
      if (next.trim()) actions.suggest(next, deleting.current, 'search'); else actions.stopSuggesting();
    },
    move(step: 1 | -1) { actions.moveSuggestion(step); },
    /**
     * Opens the highlighted suggestion, or what was typed. The highlighted row
     * is opened by index: this field shows no inline completion, so sending
     * the text would never match Chromium's default and would search "youtu"
     * instead of opening youtube.com.
     */
    submit(newTab: boolean) {
      if (!typing) return false;
      if (chosen >= 0) void actions.openSuggestion(chosen, newTab);
      else void actions.submitAddress(text, newTab);
      return true;
    },
    /** Opens row `index`; false for a row of an older query, which opens nothing. */
    open(index: number, newTab: boolean) {
      if (pending) return false;
      void actions.openSuggestion(index, newTab);
      return true;
    },
    reset() { setText(''); actions.stopSuggesting(); },
  };
}

export const suggestionIcons = { search: 'magnifyingglass', url: 'globe', tab: 'square.on.square' } as const;

/** What choosing a suggestion does, for its row. */
export function suggestionDetail(item: Suggestion, host: string) {
  return item.kind === 'tab' ? 'Switch to tab' : item.kind === 'search' ? 'Search' : item.detail || host || undefined;
}
