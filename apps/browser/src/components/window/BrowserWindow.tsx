import React from 'react';
import { View } from 'react-native';
import { useActions, useSnapshot } from '../../state/window';
import { DragRegion, Glass, Panel, geometry, radius, space, useTheme } from '../ui';
import { Sidebar } from '../tabs/Sidebar';
import { TabStrip } from '../tabs/TabStrip';
import { Overlays } from './Overlays';
import { PageArea } from './PageArea';
import { StatusLine } from './StatusLine';
import { Toolbar } from './Toolbar';

/**
 * A browser window in Tide: the workspace colour tints the whole window, and
 * the page sits in one white card on it. Tabs run down a sidebar (which also
 * holds navigation and the address, so the card has no toolbar) or across the
 * top (the card gets one quiet toolbar row). Command-S hides the tabs either
 * way. Overlays sit above everything.
 */
export function BrowserWindow() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const { colors } = useTheme();
  const tabs = !snapshot.modal.sidebarHidden;
  const top = snapshot.modal.tabLayout === 'top';
  const side = tabs && !top;
  const card = <View style={{ flex: 1, padding: tabs ? space.sm : 0, paddingLeft: side ? 0 : undefined,
    paddingTop: tabs && top ? 0 : undefined }}>
    <Panel fill="contentBackground" radius={tabs ? 'window' : 'none'} border={tabs ? 'contentBorder' : null}
      elevation={tabs ? 'card' : 'none'} style={{ flex: 1 }}>
      <View style={{ flex: 1, overflow: 'hidden', borderRadius: tabs ? radius.window : 0 }}>
        {!side && <View style={{ borderBottomWidth: geometry.hairline, borderBottomColor: colors.toolbarDivider }}><Toolbar /></View>}
        <View style={{ flex: 1 }}><PageArea /></View>
        <StatusLine />
      </View>
    </Panel>
  </View>;
  // One tree for every layout, so the page is never remounted when the tabs move or hide.
  return <View style={{ flex: 1, flexDirection: top ? 'column' : 'row',
    backgroundColor: colors[tabs ? 'sidebarFallback' : 'contentBackground'] }}
    onLayout={e => actions.setWindowSize(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}>
    {tabs && <Glass material="sidebar" tint="shellTint" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />}
    {tabs && <DragRegion style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />}
    {tabs && (top ? <TabStrip /> : <Sidebar />)}
    {card}
    <Overlays />
  </View>;
}
