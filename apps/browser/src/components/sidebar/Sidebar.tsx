import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { Badge, Box, Button, DragRegion, Glass, Icon, IconButton, KeyCap, Text, useInteraction, useTheme, geometry, radius, space } from '../ui';
import { PinnedTile, TabRow } from './TabRow';

/**
 * Tabs down the left of the window, over macOS vibrancy. Its top strip holds
 * the window controls and moves the window when dragged.
 */
export function Sidebar() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const popover = useBrowser(s => s.popover);
  const pinned = snapshot.tabs.filter(t => t.pinned);
  const open = snapshot.tabs.filter(t => !t.pinned);
  const downloading = snapshot.downloads.filter(d => d.state === 'progress').length;
  return <Glass material="sidebar" tint="sidebarTint" style={{ width: geometry.sidebar }}>
    <View style={{ height: geometry.titlebar, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
      paddingHorizontal: space.sm, gap: space.xs }}>
      <DragRegion style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      {!snapshot.private && <IconButton label="Profiles" icon="person.crop.circle" selected={popover === 'profiles'}
        onFrame={frame => actions.setAnchor('profiles', frame)} onPress={() => actions.togglePopover('profiles')} />}
      <IconButton label="Hide sidebar" icon="sidebar.left" onPress={() => void actions.command('sidebar')} />
    </View>
    <Box padX="sm" gap="sm" flex={1}>
      {snapshot.private && <Box row align="center" gap="xs" padX="sm">
        <Icon name="eye.slash" tone="iconSecondary" size="small" />
        <Text variant="caption">Private window</Text>
      </Box>}
      <NewTabRow onPress={() => void actions.newTab()} />
      {!!pinned.length && <Box row wrap gap="xs">
        {pinned.map(tab => <PinnedTile key={tab.id} tab={tab} active={tab.id === snapshot.activeTabId} />)}
      </Box>}
      <Box padX="sm" padTop="xs"><Text variant="section">{`Tabs · ${open.length}`}</Text></Box>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.hair, paddingBottom: space.md }}>
        {open.map(tab => <TabRow key={tab.id} tab={tab} active={tab.id === snapshot.activeTabId} />)}
      </ScrollView>
    </Box>
    <Box row align="center" gap="xs" pad="sm" borderTop="borderSubtle">
      <Button label="Commands" icon="command" variant="ghost" size="small" onPress={() => void actions.command('palette menu')} />
      <View style={{ flex: 1 }} />
      <IconButton label="Library" icon="books.vertical" onPress={() => actions.openPanel('history')} />
      <View>
        <IconButton label={downloading ? `Downloads, ${downloading} in progress` : 'Downloads'} icon="arrow.down.circle"
          selected={popover === 'downloads'} onFrame={frame => actions.setAnchor('downloads', frame)}
          onPress={() => actions.togglePopover('downloads')} />
        {!!downloading && <View pointerEvents="none" style={{ position: 'absolute', top: -space.hair, right: -space.hair }}>
          <Badge>{String(downloading)}</Badge>
        </View>}
      </View>
      <IconButton label="Settings" icon="gearshape" onPress={() => actions.openPanel('settings')} />
    </Box>
  </Glass>;
}

function NewTabRow({ onPress }: { onPress(): void }) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel="New tab" onPress={onPress} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: geometry.row, paddingHorizontal: space.sm,
      borderRadius: radius.row, backgroundColor: colors[hovered ? 'fillHover' : 'fillTransparent'] }}>
    <Icon name="plus" tone="iconSecondary" size="small" />
    <Text tone="textSecondary" flex={1}>New Tab</Text>
    <KeyCap>⌘T</KeyCap>
  </Pressable>;
}
