import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions } from '../../state/window';
import { ContextMenu, IconButton, Panel, Text, useInteraction, useTheme, geometry, radius, space } from '../ui';
import { Favicon } from '../favicon/Favicon';

const cover = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

/**
 * A tab in the sidebar list. The active tab is lifted off the shell as a white
 * card; the others wash white on hover. Right-click opens its native menu.
 */
export const TabRow = React.memo(function TabRow({ tab, active }: { tab: Tab; active: boolean }) {
  const actions = useActions();
  const { colors } = useTheme();
  const [hovered, setHovered] = useState(false);
  const title = isStartUrl(tab.url) ? 'New Tab' : tab.title || tab.url || 'New Tab';
  const row = <ContextMenu onOpen={() => void actions.tabMenu(tab.id)}>
    <View onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: geometry.tabRow, borderRadius: radius.row,
      backgroundColor: colors[!active && hovered ? 'tabHover' : 'fillTransparent'] }}>
      {active && <Panel fill="tabActive" radius="row" elevation="tab" border="tabActiveBorder" style={cover} />}
      <Pressable accessibilityRole="button" accessibilityState={{ selected: active }}
        accessibilityLabel={`${title}${tab.loading ? ', loading' : ''}${tab.audible ? ', playing audio' : ''}`}
        onPress={() => void actions.activateTab(tab.id)}
        style={{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.sm + space.hair,
          paddingLeft: space.sm + space.hair }}>
        <Favicon tab={tab} />
        <Text lines={1} flex={1} tone={active ? 'tabTextActive' : 'tabText'} weight={active ? 'medium' : undefined}>{title}</Text>
        {tab.audible && <Text variant="caption" tone="textTertiary">♪</Text>}
      </Pressable>
      <View style={{ width: geometry.control, alignItems: 'center', opacity: hovered || active ? 1 : 0 }}>
        <IconButton label={`Close ${title}`} icon="xmark" size="small" onPress={() => void actions.closeTab(tab.id)} />
      </View>
    </View>
  </ContextMenu>;
  // The active card sits behind the row rather than around it, so a tab
  // becoming active or not keeps its views.
  return row;
});

/** A pinned tab, shown as a favourite tile above the tab list. */
export const FavouriteTile = React.memo(function FavouriteTile({ tab, active, width }: { tab: Tab; active: boolean; width: number }) {
  const { colors } = useTheme();
  const actions = useActions();
  const { hovered, handlers } = useInteraction();
  const title = tab.title || tab.url || 'Pinned tab';
  const tile = <Pressable accessibilityRole="button" accessibilityLabel={`Pinned: ${title}`} accessibilityState={{ selected: active }}
    onPress={() => void actions.activateTab(tab.id)} {...handlers}
    style={{ width, height: geometry.favourite, borderRadius: radius.tile, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors[active ? 'fillTransparent' : hovered ? 'fillShellControl' : 'tilePinned'] }}>
    {active && <Panel fill="tilePinnedActive" radius="tile" elevation="tab" border="tabActiveBorder" style={cover} />}
    <Favicon tab={tab} large />
    {tab.audible && <View style={{ position: 'absolute', bottom: space.hair, right: space.xs }}>
      <Text variant="micro">♪</Text>
    </View>}
  </Pressable>;
  // As in TabRow, the active card is behind the tile, not around it.
  return <ContextMenu onOpen={() => void actions.tabMenu(tab.id)}>{tile}</ContextMenu>;
});
