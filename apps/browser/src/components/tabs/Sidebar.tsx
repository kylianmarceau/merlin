import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { DragRegion, Icon, IconButton, Text, useInteraction, useTheme, geometry, radius, space } from '../ui';
import { AddressField } from '../omnibox/AddressField';
import { NavigationButtons } from '../window/Toolbar';
import { FavouriteTile, TabRow } from './TabRow';
import { SidebarFooter } from './WindowButtons';

const columns = 4;
const tileGap = space.xs + space.hair;

/**
 * Tabs down the left of the window, on the tinted shell. The top row holds
 * the window controls and navigation and moves the window when dragged; then
 * the address, pinned tabs as favourite tiles, and the open tabs.
 */
export function Sidebar() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const pending = useBrowser(s => s.panel === 'newTab');
  const [inner, setInner] = useState(geometry.sidebar - space.md - space.sm - space.hair);
  const pinned = snapshot.tabs.filter(t => t.pinned);
  const open = snapshot.tabs.filter(t => !t.pinned);
  const tile = Math.floor((inner - tileGap * (columns - 1)) / columns);
  // Settings › Appearance › Address bar: in the toolbar, the page card carries navigation and the address.
  const addressHere = useShellPrefs(p => p.addressBar !== 'toolbar');
  return <View style={{ width: geometry.sidebar, paddingLeft: space.md, paddingRight: space.sm + space.hair,
    paddingBottom: space.sm + space.hair, gap: space.sm + space.hair }}>
    <View style={{ height: geometry.titlebar, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.hair }}>
      <DragRegion style={{ position: 'absolute', top: 0, left: -space.md, right: -space.sm, bottom: 0 }} />
      <IconButton label="Hide sidebar" icon="sidebar.left" onPress={() => void actions.command('sidebar')} />
      {addressHere && <NavigationButtons />}
    </View>
    <View onLayout={e => setInner(e.nativeEvent.layout.width)}>{addressHere && <AddressField variant="shell" />}</View>
    {snapshot.private && <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair, paddingHorizontal: space.sm + space.hair }}>
      <Icon name="eye.slash" tone="iconSecondary" size="small" />
      <Text variant="label" tone="textSecondary">Private window</Text>
    </View>}
    {!!pinned.length && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tileGap }}>
      {pinned.map(tab => <FavouriteTile key={tab.id} tab={tab} width={tile} active={tab.id === snapshot.activeTabId} />)}
    </View>}
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm + space.hair, paddingTop: space.xs,
        paddingBottom: space.xs }}>
        <View style={{ flex: 1 }}><Text variant="group">Tabs</Text></View>
        {open.length > 1 && <Text variant="caption" tone="textTertiary">{String(open.length)}</Text>}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: geometry.hairline, paddingBottom: space.md }}>
        <NewTabRow pending={pending} onPress={actions.openNewTab} />
        {open.map(tab => <TabRow key={tab.id} tab={tab} active={tab.id === snapshot.activeTabId} />)}
      </ScrollView>
    </View>
    <SidebarFooter />
  </View>;
}

/** New Tab; while the new-tab pop-up is open it stands for the tab about to open. */
function NewTabRow({ onPress, pending }: { onPress(): void; pending: boolean }) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel="New tab" onPress={onPress} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + space.hair, minHeight: geometry.tabRow,
      paddingLeft: space.sm + space.hair, paddingRight: space.sm, borderRadius: radius.row,
      borderWidth: geometry.hairline, borderColor: colors[pending ? 'focusRing' : 'fillTransparent'],
      backgroundColor: colors[pending ? 'tabHover' : hovered ? 'tabHover' : 'fillTransparent'] }}>
    <Icon name="plus" tone={pending ? 'accentSoftText' : 'iconSecondary'} size="small" />
    <Text tone={pending ? 'accentSoftText' : 'textSecondary'} flex={1}>{pending ? 'New tab…' : 'New Tab'}</Text>
    {hovered && <Text variant="caption" tone="textTertiary">⌘T</Text>}
  </Pressable>;
}
