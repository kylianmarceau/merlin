import React, { useState } from 'react';
import { Animated, View } from 'react-native';
import { PAGE_FRAME, useShellPrefs } from '../../state/shellPrefs';
import { useActions, useSnapshot } from '../../state/window';
import { DragRegion, FullScreenWatch, Glass, Panel, geometry, radius, shellTintFor, useColorFade, useTheme } from '../ui';
import { BookmarksBar } from '../bookmarks/BookmarksBar';
import { useSiteChrome } from '../tabs/siteChrome';
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
 * top (the card gets one quiet toolbar row, joined by the active tab, both in
 * the site's colour). Command-S hides the tabs either way. A page in
 * fullscreen (a video, a PDF) fills the window alone, with no tabs, toolbar or
 * status line, as in Chrome. Overlays sit above everything.
 */
export function BrowserWindow() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const { colors } = useTheme();
  const chrome = useSiteChrome();
  const fullscreen = !!snapshot.fullscreen;
  const tabs = !snapshot.modal.sidebarHidden && !fullscreen;
  const top = snapshot.modal.tabLayout === 'top';
  const side = tabs && !top;
  const { glass } = useTheme();
  const [macFullScreen, setMacFullScreen] = useState(false);
  const borderless = useShellPrefs(p => p.borderlessMode);
  const frameSetting = useShellPrefs(p => p.pageFrame);
  const zeroInFullScreen = useShellPrefs(p => p.pageFrameZeroInFullScreen);
  const zeroWhenHidden = useShellPrefs(p => p.pageFrameZeroWhenTabsHidden);
  const addressInToolbar = useShellPrefs(p => p.addressBar === 'toolbar');
  const bookmarksBar = useShellPrefs(p => p.showBookmarks && p.bookmarksBar);
  // Settings › Appearance › Page frame: the room around the page card. At 0
  // the page goes edge to edge with square corners.
  const frame = !tabs || borderless || (macFullScreen && (zeroInFullScreen || (zeroWhenHidden && !!snapshot.modal.sidebarHidden)))
    ? 0 : Math.max(PAGE_FRAME.min, Math.min(PAGE_FRAME.max, frameSetting));
  const framed = frame > 0;
  // With tabs in the sidebar the card has a toolbar only when the address is
  // set to be in it (Settings › Appearance › Address bar).
  const toolbar = !fullscreen && (!side || addressInToolbar);
  // With tabs on top the strip is drawn after the card, so the active tab can
  // overlap the card's top edge and join its toolbar.
  const card = <View style={{ flex: 1, padding: frame, paddingLeft: side ? 0 : undefined,
    paddingTop: tabs && top ? geometry.strip : undefined }}>
    <Panel fill="contentBackground" radius={framed ? 'window' : 'none'} border={framed ? 'contentBorder' : null}
      elevation={framed ? 'card' : 'none'} style={{ flex: 1 }}>
      <View style={{ flex: 1, overflow: 'hidden', borderRadius: framed ? radius.window : 0 }}>
        {toolbar && <View style={{ borderBottomWidth: geometry.hairline,
          // A toolbar in the page's own colour runs straight on into it.
          borderBottomColor: chrome.seamless ? chrome.bar : colors.toolbarDivider }}><Toolbar /></View>}
        {toolbar && bookmarksBar && <BookmarksBar />}
        <View style={{ flex: 1 }}><PageArea /></View>
        {!fullscreen && <StatusLine />}
      </View>
    </Panel>
  </View>;
  // One tree for every layout, so the page is never remounted when the tabs move or hide.
  return <View style={{ flex: 1, flexDirection: top ? 'column' : 'row',
    backgroundColor: colors[tabs ? 'sidebarFallback' : 'contentBackground'] }}
    onLayout={e => actions.setWindowSize(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}>
    <FullScreenWatch onChange={setMacFullScreen} />
    {/* Glass lets the desktop through the shell; Classic is solid. */}
    {tabs && glass.translucent && <Glass material="sidebar" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />}
    {tabs && <ShellTint followSite={top} />}
    {tabs && <DragRegion style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />}
    {side && <Sidebar />}
    {card}
    {tabs && top && <TabStrip />}
    <Overlays />
  </View>;
}

/**
 * The tint over the shell's vibrancy: the workspace colour, or the site's
 * when chosen in Settings (tabs on top). Its strength follows the glass
 * transparency; with Classic it is opaque.
 */
function ShellTint({ followSite }: { followSite: boolean }) {
  const { colors, reduceMotion, glass } = useTheme();
  const chrome = useSiteChrome();
  const tint = useColorFade(shellTintFor((followSite ? chrome.shell : null) ?? colors.shellTint, glass), reduceMotion);
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: tint }} />;
}
