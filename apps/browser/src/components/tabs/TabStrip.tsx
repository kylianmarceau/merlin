import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions, useSnapshot } from '../../state/window';
import { ContextMenu, DragRegion, IconButton, Icon, Panel, Text, useInteraction, useTheme, geometry, radius, space } from '../ui';
import { Favicon } from '../favicon/Favicon';
import { DownloadsButton, LibraryButtons, ProfilesButton } from './WindowButtons';

const gap = space.hair;
const pinnedWidth = geometry.button;

/**
 * Tabs across the top of the window, on the tinted shell beside the traffic
 * lights. Pinned tabs sit together in a soft group; open tabs are pills that
 * share the width, and drop their titles when crowded. Empty space moves the window.
 */
export function TabStrip() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const { colors } = useTheme();
  const [room, setRoom] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const pinned = snapshot.tabs.filter(t => t.pinned);
  const open = snapshot.tabs.filter(t => !t.pinned);
  const fixed = geometry.control + gap;
  const share = open.length ? (room - fixed) / open.length - gap : geometry.stripTab;
  const width = Math.floor(Math.max(pinnedWidth, Math.min(geometry.stripTab, share)));
  const quiet = (t: Tab | undefined) => !!t && t.id !== snapshot.activeTabId && t.id !== hoveredId;
  return <View style={{ height: geometry.strip, flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair,
    paddingLeft: geometry.sidebarCollapsedInset, paddingRight: space.sm + space.hair }}>
    <DragRegion style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    {snapshot.private && <Icon name="eye.slash" tone="iconSecondary" size="small" />}
    {!!pinned.length && <View style={{ flexDirection: 'row', gap: geometry.hairline, padding: space.hair + geometry.hairline,
      borderRadius: radius.field + geometry.hairline, backgroundColor: colors.fillShellGroup }}>
      {pinned.map(tab => <PinnedTab key={tab.id} tab={tab} active={tab.id === snapshot.activeTabId} />)}
    </View>}
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap, overflow: 'hidden' }} pointerEvents="box-none"
      onLayout={e => setRoom(e.nativeEvent.layout.width)}>
      {open.map((tab, i) => <React.Fragment key={tab.id}>
        {i > 0 && <View style={{ width: geometry.hairline, height: geometry.iconSmall + space.xs,
          backgroundColor: colors[quiet(open[i - 1]) && quiet(tab) ? 'sidebarRule' : 'fillTransparent'] }} />}
        <StripTab tab={tab} width={width} active={tab.id === snapshot.activeTabId}
          onHover={on => setHoveredId(current => (on ? tab.id : current === tab.id ? null : current))} />
      </React.Fragment>)}
      <IconButton label="New tab" icon="plus" onPress={() => void actions.openNewTab()} />
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.hair }}>
      <DownloadsButton />
      <LibraryButtons />
      <ProfilesButton />
      <IconButton label="Hide tabs" icon="rectangle.topthird.inset.filled" onPress={() => void actions.command('sidebar')} />
    </View>
  </View>;
}

function StripTab({ tab, active, width, onHover }: { tab: Tab; active: boolean; width: number; onHover(on: boolean): void }) {
  const actions = useActions();
  const { colors } = useTheme();
  const [hovered, setHovered] = useState(false);
  const title = isStartUrl(tab.url) ? 'New Tab' : tab.title || tab.url || 'New Tab';
  const compact = width < geometry.stripTabMin;
  const hover = (on: boolean) => { setHovered(on); onHover(on); };
  const body = <ContextMenu onOpen={() => void actions.tabMenu(tab.id)}>
    <View onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}
      style={{ width, height: geometry.stripTabHeight, flexDirection: 'row', alignItems: 'center', borderRadius: radius.field,
        backgroundColor: colors[!active && hovered ? 'tabHover' : 'fillTransparent'] }}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: active }}
        accessibilityLabel={`${title}${tab.loading ? ', loading' : ''}${tab.audible ? ', playing audio' : ''}`}
        onPress={() => void actions.activateTab(tab.id)}
        style={{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.sm,
          paddingLeft: compact ? 0 : space.md, justifyContent: compact ? 'center' : 'flex-start' }}>
        <Favicon tab={tab} />
        {!compact && <Text lines={1} flex={1} tone={active ? 'tabTextActive' : 'tabText'} weight={active ? 'medium' : undefined}>{title}</Text>}
      </Pressable>
      {!compact && (hovered || active) && <IconButton label={`Close ${title}`} icon="xmark" size="small" onPress={() => void actions.closeTab(tab.id)} />}
    </View>
  </ContextMenu>;
  return active ? <Panel fill="tabActive" radius="field" elevation="tab" border="tabActiveBorder">{body}</Panel> : body;
}

function PinnedTab({ tab, active }: { tab: Tab; active: boolean }) {
  const { colors } = useTheme();
  const actions = useActions();
  const { hovered, handlers } = useInteraction();
  const title = tab.title || tab.url || 'Pinned tab';
  return <ContextMenu onOpen={() => void actions.tabMenu(tab.id)}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Pinned: ${title}`} accessibilityState={{ selected: active }}
      onPress={() => void actions.activateTab(tab.id)} {...handlers}
      style={{ width: pinnedWidth, height: geometry.control, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center',
        backgroundColor: colors[active ? 'tilePinnedActive' : hovered ? 'fillShellControl' : 'fillTransparent'] }}>
      <Favicon tab={tab} />
    </Pressable>
  </ContextMenu>;
}
