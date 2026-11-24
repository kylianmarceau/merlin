import React, { useState } from 'react';
import { Animated, View } from 'react-native';
import type { Suggestion } from '../../state/types';
import { currentSuggestions } from '../../state/store';
import { useActions } from '../../state/window';
import { GlassScope, MenuRow, PaletteScope, Popover, duration, radius, useHeld, useTheme, useUnfold } from '../ui';
import { useAddressDropdown } from './useAddressDropdown';

const icons = { search: 'magnifyingglass', url: 'globe', tab: 'square.on.square' } as const;

/**
 * Chromium's suggestions for what is typed in the address field. They
 * unfold out of the field over 130 ms, as Dia's command bar grows out of it,
 * while the field and its text hold still.
 */
export function Suggestions() {
  const actions = useActions();
  const { glass, reduceMotion } = useTheme();
  const [natural, setNatural] = useState(0);
  const dropdown = useAddressDropdown();
  const { omnibox } = dropdown;
  const items = dropdown.items ?? [];
  // Rows of an older query stay until the new ones arrive and can't be chosen:
  // they answer other text. They grey out only if the answer is slow, or
  // the list would flash on every keystroke.
  const pending = !currentSuggestions(omnibox ?? null).length;
  const stale = useHeld(pending && items.length > 0, duration.staleRows);
  const selected = (index: number, item: Suggestion) => pending
    ? !stale && index === 0 && item.default
    : omnibox?.selected === index || (omnibox?.selected === -1 && index === 0 && item.default);
  const height = useUnfold(items.length ? natural : 0, reduceMotion);
  return <PaletteScope roles={dropdown.colors}>
    <GlassScope look={{ ...glass, on: false }}>
      <Popover open={!!dropdown.joined} anchor={dropdown.anchor} bounds={dropdown.bounds} kind="menu" label="Suggestions" instant arrow={false}
        joined={dropdown.joined} cornerRadius={radius.popover} width={dropdown.width} onClose={actions.stopSuggesting}>
        <Animated.View style={{ height: natural ? height : 0, overflow: 'hidden' }}>
          {/* Laid out apart from the clip, so it measures at its full height while the clip grows to it. */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0 }} onLayout={e => setNatural(e.nativeEvent.layout.height)}>
            {items.map((item: Suggestion, index) => <MenuRow key={index} icon={icons[item.kind]}
              label={item.title || item.url} detail={item.kind === 'tab' ? 'Switch to this tab' : item.detail || undefined}
              disabled={stale} selected={!!selected(index, item)}
              onPress={() => { if (!pending) void actions.openSuggestion(index, false); }} />)}
          </View>
        </Animated.View>
      </Popover>
    </GlassScope>
  </PaletteScope>;
}
