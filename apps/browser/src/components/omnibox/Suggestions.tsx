import React from 'react';
import type { Suggestion } from '../../state/types';
import { currentSuggestions } from '../../state/store';
import { useActions, useBrowser } from '../../state/window';
import { MenuRow, Popover, duration, geometry, useHeld } from '../ui';

const icons = { search: 'magnifyingglass', url: 'globe', tab: 'square.on.square' } as const;

/** Chromium's suggestions for what is typed in the address field. */
export function Suggestions() {
  const actions = useActions();
  const omnibox = useBrowser(s => s.omnibox);
  const anchor = useBrowser(s => s.anchors.address);
  const bounds = useBrowser(s => s.windowSize);
  // The start page and the new-tab pop-up show their own suggestions.
  const elsewhere = useBrowser(s => s.panel === 'newTab') || omnibox?.owner !== 'address';
  const items = elsewhere ? [] : omnibox?.items ?? [];
  // Rows of an older query stay until the new ones arrive and can't be chosen:
  // they answer other text. They grey out only if the answer is slow, or
  // the list would flash on every keystroke.
  const pending = !currentSuggestions(omnibox ?? null).length;
  const stale = useHeld(pending && items.length > 0, duration.staleRows);
  const selected = (index: number, item: Suggestion) => pending
    ? !stale && index === 0 && item.default
    : omnibox?.selected === index || (omnibox?.selected === -1 && index === 0 && item.default);
  return <Popover open={items.length > 0} anchor={anchor} bounds={bounds} kind="menu" label="Suggestions" instant arrow={false}
    width={Math.max(anchor?.width ?? 0, geometry.dialogWide)} onClose={actions.stopSuggesting}>
    {items.map((item: Suggestion, index) => <MenuRow key={index} icon={icons[item.kind]}
      label={item.title || item.url} detail={item.kind === 'tab' ? 'Switch to this tab' : item.detail || undefined}
      disabled={stale} selected={!!selected(index, item)}
      onPress={() => { if (!pending) void actions.openSuggestion(index, false); }} />)}
  </Popover>;
}
