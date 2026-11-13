import { useRef, useState } from 'react';
import type { Suggestion } from '../../state/types';
import { useActions, useBrowser } from '../../state/window';

/**
 * A search-or-address field with Chromium's suggestions, as the toolbar's
 * address field has them: the start page's field and the new-tab pop-up.
 * Their suggestions show in place, never under the toolbar.
 */
export function useSearch() {
  const actions = useActions();
  const omnibox = useBrowser(s => s.omnibox);
  const [text, setText] = useState('');
  const deleting = useRef(false);
  const typing = !!text.trim();
  const mine = typing && omnibox?.owner === 'search' && omnibox.text === text ? omnibox : null;
  const suggestions: Suggestion[] = mine?.items ?? [];
  // -1 is what was typed; Enter then opens the top suggestion when it is Chromium's default, as the address field does.
  const selected = mine ? (mine.selected >= 0 ? mine.selected : suggestions[0]?.default ? 0 : -1) : -1;
  return {
    text, typing, suggestions, selected,
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
      if (selected >= 0) void actions.openSuggestion(selected, newTab);
      else void actions.submitAddress(text, newTab);
      return true;
    },
    open(index: number, newTab: boolean) { void actions.openSuggestion(index, newTab); },
    reset() { setText(''); actions.stopSuggesting(); },
  };
}

export const suggestionIcons = { search: 'magnifyingglass', url: 'globe', tab: 'square.on.square' } as const;

/** What choosing a suggestion does, for its row. */
export function suggestionDetail(item: Suggestion, host: string) {
  return item.kind === 'tab' ? 'Switch to tab' : item.kind === 'search' ? 'Search' : item.detail || host || undefined;
}
