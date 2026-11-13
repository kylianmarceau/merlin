import React from 'react';
import { View } from 'react-native';
import { displayHost } from '../../lib/format';
import { useActions, useActiveTab, useSnapshot } from '../../state/window';
import { Box, DragRegion, IconButton, Text, geometry, useTheme } from '../ui';
import { Page } from '../page/Page';
import { Overlays } from './Overlays';

/**
 * A pop-up a page opened (sign-in windows, payment pages). It shows who it
 * belongs to and the page, nothing else, so it cannot pass for a browser window.
 */
export function PopupWindow() {
  const tab = useActiveTab();
  const actions = useActions();
  const { colors } = useTheme();
  const secure = tab?.url.startsWith('https:');
  // A video in a pop-up can go fullscreen too: then only the page shows.
  const fullscreen = !!useSnapshot().fullscreen;
  return <View style={{ flex: 1, backgroundColor: colors.contentBackground }}
    onLayout={e => actions.setWindowSize(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}>
    {!fullscreen && <Box row align="center" gap="xs" height="titlebar" padRight="sm" fill="titlebarBackground" borderBottom="toolbarDivider">
      <DragRegion style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ width: geometry.sidebarCollapsedInset }} />
      <IconButton label="Show site information" icon={secure ? 'lock' : 'exclamationmark.triangle'} size="small"
        tone={secure ? 'siteSecure' : 'siteInsecure'} onFrame={f => actions.setAnchor('site', f)}
        onPress={() => void actions.siteInfo()} />
      <Text variant="label" lines={1} flex={1}>{tab ? displayHost(tab.url) : ''}</Text>
      {tab?.loading && <Text variant="caption">Loading…</Text>}
    </Box>}
    {tab && <Page tabId={tab.id} />}
    <Overlays />
  </View>;
}
