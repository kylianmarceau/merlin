import React from 'react';
import { View } from 'react-native';
import { useActions, useSnapshot } from '../../state/window';
import { Panel, radius, space, useTheme } from '../ui';
import { Sidebar } from '../sidebar/Sidebar';
import { Overlays } from './Overlays';
import { PageArea } from './PageArea';
import { StatusLine } from './StatusLine';
import { Toolbar } from './Toolbar';

/**
 * A browser window: the vibrant sidebar on the left, and the page in a raised
 * card with its toolbar. Overlays sit above both.
 */
export function BrowserWindow() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const { colors } = useTheme();
  const sidebar = !snapshot.modal.sidebarHidden;
  return <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors[sidebar ? 'sidebarFallback' : 'windowBackground'] }}
    onLayout={e => actions.setWindowSize(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}>
    {sidebar && <Sidebar />}
    <View style={{ flex: 1, padding: sidebar ? space.sm : 0, paddingLeft: 0 }}>
      <Panel fill="contentBackground" radius={sidebar ? 'window' : 'none'} border={sidebar ? 'contentBorder' : null}
        elevation={sidebar ? 'card' : 'none'} style={{ flex: 1 }}>
        <View style={{ flex: 1, overflow: 'hidden', borderRadius: sidebar ? radius.window : 0 }}>
          <Toolbar />
          <View style={{ flex: 1 }}><PageArea /></View>
          <StatusLine />
        </View>
      </Panel>
    </View>
    <Overlays />
  </View>;
}
