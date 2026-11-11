import React from 'react';
import { Pressable, View } from 'react-native';
import type { Tab } from '../../state/types';
import { useActions } from '../../state/window';
import { ContextMenu, IconButton, ListRow, Panel, Text, useInteraction, useTheme, geometry, radius, space } from '../ui';
import { Favicon } from '../favicon/Favicon';

/** A tab in the sidebar list. Right-click or the hover button opens its native menu. */
export function TabRow({ tab, active }: { tab: Tab; active: boolean }) {
  const actions = useActions();
  const title = tab.title || (tab.url ? tab.url : 'New Tab');
  const row = <ListRow title={title} selected={active} selectedFill="fillTransparent" tone={active ? 'tabTextActive' : 'tabText'}
    accessibilityLabel={`${title}${tab.loading ? ', loading' : ''}${tab.audible ? ', playing audio' : ''}`}
    leading={<Favicon tab={tab} />} onPress={() => void actions.activateTab(tab.id)}
    onContextMenu={() => void actions.tabMenu(tab.id)}
    hoverTrailing={<View style={{ flexDirection: 'row', paddingRight: space.xs }}>
      <IconButton label={`More for ${title}`} icon="ellipsis" size="small" onPress={() => void actions.tabMenu(tab.id)} />
      <IconButton label={`Close ${title}`} icon="xmark" size="small" onPress={() => void actions.closeTab(tab.id)} />
    </View>} />;
  // The active tab is lifted off the sidebar like a card.
  return active ? <Panel fill="tabActive" radius="row" elevation="tab" border="tabActiveBorder">{row}</Panel> : row;
}

/** A pinned tab: a square tile with the site's icon. */
export function PinnedTile({ tab, active }: { tab: Tab; active: boolean }) {
  const { colors } = useTheme();
  const actions = useActions();
  const { hovered, handlers } = useInteraction();
  const title = tab.title || tab.url || 'Pinned tab';
  return <ContextMenu onOpen={() => void actions.tabMenu(tab.id)}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Pinned: ${title}`} accessibilityState={{ selected: active }}
      onPress={() => void actions.activateTab(tab.id)} {...handlers}
      style={{ height: geometry.rowTall, minWidth: geometry.rowTall + space.lg, flexGrow: 1, borderRadius: radius.card,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: colors[active ? 'tilePinnedActive' : hovered ? 'fillControlHover' : 'tilePinned'],
        borderWidth: geometry.hairline, borderColor: colors[active ? 'tabActiveBorder' : 'fillTransparent'] }}>
      <Favicon tab={tab} />
      {tab.audible && <View style={{ position: 'absolute', bottom: space.hair, right: space.xs }}>
        <Text variant="micro">♪</Text>
      </View>}
    </Pressable>
  </ContextMenu>;
}
