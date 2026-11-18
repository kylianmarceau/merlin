import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { displayHost } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions, useSnapshot } from '../../state/window';
import { Panel, Text, geometry, radius, space, useInteraction, useTheme } from '../ui';
import { Favicon } from '../favicon/Favicon';
import { perRow, shownCards, thumbnailsToRequest } from './switcherCards';

/**
 * Ctrl-Tab's cards, while Control is held: every tab of the window with the
 * page as it last looked, most recently used first. Tab and Shift-Tab (or
 * the arrows) move, releasing Control switches, Escape cancels. Chromium
 * keeps the order and the keyboard; this only draws them.
 */
export function TabSwitcher() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const { colors } = useTheme();
  const switcher = snapshot.switcher;
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  // Thumbnails asked for while these cards are open; closing them forgets.
  const asked = useRef(new Set<string>());
  // Long lists show a window of cards that keeps the highlighted one in view.
  const { first, shown } = shownCards(switcher?.tabs ?? [], switcher?.selected ?? 0);
  const shownIds = shown.join(',');
  useEffect(() => {
    if (!switcher) { asked.current = new Set(); setThumbs({}); return; }
    for (const id of thumbnailsToRequest(shown, asked.current)) {
      asked.current.add(id);
      const mine = asked.current;
      void actions.thumbnail(id).then(url => { if (mine === asked.current) setThumbs(t => ({ ...t, [id]: url })); });
    }
  }, [!!switcher, shownIds]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!switcher) return null;
  const byId = new Map(snapshot.tabs.map(t => [t.id, t]));
  const columns = Math.min(perRow, shown.length);
  return <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center',
    justifyContent: 'center' }}>
    <Pressable accessible={false} onPress={() => void actions.cancelSwitcher()}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim }} />
    <Panel glass fill="surfacePalette" radius="popover" elevation="dialog" accessibilityLabel={switcher.recent ? 'Recent tabs' : 'Tabs'}
      accessibilityViewIsModal style={{ maxWidth: '94%' }}>
      <View style={{ padding: space.md, gap: space.sm }}>
        <Text variant="label" weight="semibold" tone="textSecondary">{switcher.recent ? 'Recent tabs' : 'Tabs'}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm,
          width: columns * geometry.switcherCard + (columns - 1) * space.sm, maxWidth: '100%' }}>
          {shown.map((id, i) => {
            const tab = byId.get(id);
            return tab ? <Card key={id} tab={tab} thumbnail={thumbs[id] ?? null} selected={first + i === switcher.selected}
              onPress={() => void actions.chooseSwitcherTab(first + i)} /> : null;
          })}
        </View>
      </View>
    </Panel>
  </View>;
}

function Card({ tab, thumbnail, selected, onPress }: { tab: Tab; thumbnail: string | null; selected: boolean; onPress(): void }) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel={tab.title || tab.url} accessibilityState={{ selected }}
    onPress={onPress} {...handlers}
    style={{ width: geometry.switcherCard, padding: space.xs, gap: space.xs, borderRadius: radius.field,
      borderWidth: geometry.focusRing, borderColor: colors[selected ? 'paletteSelected' : 'fillTransparent'],
      backgroundColor: colors[hovered && !selected ? 'fillHover' : 'fillTransparent'] }}>
    <View style={{ height: geometry.switcherThumb, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.fillControl,
      alignItems: 'center', justifyContent: 'center' }}>
      {thumbnail
        ? <Image source={{ uri: thumbnail }} accessible={false} resizeMode="cover"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        : <Favicon tab={tab} large />}
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <Favicon tab={tab} />
      <Text variant="label" weight={selected ? 'semibold' : 'regular'} lines={1} style={{ flexShrink: 1 }}>
        {tab.title || displayHost(tab.url) || 'New Tab'}
      </Text>
    </View>
  </Pressable>;
}
