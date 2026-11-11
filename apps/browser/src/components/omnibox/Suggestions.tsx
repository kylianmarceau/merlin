import React from 'react';
import type { Suggestion } from '../../state/types';
import { useActions, useBrowser } from '../../state/window';
import { MenuRow, Popover } from '../ui';

const icons = { search: 'magnifyingglass', url: 'globe', tab: 'square.on.square' } as const;

/** Chromium's suggestions for what is typed in the address field. */
export function Suggestions() {
  const actions = useActions();
  const omnibox = useBrowser(s => s.omnibox);
  const anchor = useBrowser(s => s.anchors.address);
  const bounds = useBrowser(s => s.windowSize);
  const items = omnibox?.items ?? [];
  return <Popover open={items.length > 0} anchor={anchor} bounds={bounds} kind="menu" fill="surfaceMenu" label="Suggestions"
    width={anchor?.width ?? 'popoverWide'} onClose={actions.stopSuggesting}>
    {items.map((item: Suggestion, index) => <MenuRow key={`${index}:${item.url}`} icon={icons[item.kind]}
      label={item.title || item.url} detail={item.kind === 'tab' ? 'Switch to this tab' : item.detail || undefined}
      selected={omnibox?.selected === index || (omnibox?.selected === -1 && index === 0 && item.default)}
      onPress={() => void actions.openSuggestion(index, false)} />)}
  </Popover>;
}
