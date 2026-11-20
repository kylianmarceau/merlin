import React, { useState } from 'react';
import { Animated, View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import { PAGE_FRAME, useShellPrefs } from '../../state/shellPrefs';
import { useActions, useActiveTab, useBrowser, useCommitTrace, useSnapshot, useViewMenu } from '../../state/window';
import {
  DragRegion, FullScreenWatch, Glass, Panel, TooltipLayer, geometry, inactiveTabs, radius, shellTintFor, space, useColorFade, useEased,
  usePeekSpring, useSidebarSpring, useTheme,
} from '../ui';
import { BookmarksBar } from '../bookmarks/BookmarksBar';
import { useSiteChrome } from '../tabs/siteChrome';
import { Sidebar } from '../tabs/Sidebar';
import { TabStrip } from '../tabs/TabStrip';
import { tabTitle } from '../tabs/TabRow';
import { Overlays } from './Overlays';
import { PageArea } from './PageArea';
import { StatusLine } from './StatusLine';
import { Toolbar } from './Toolbar';

const cover = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

/**
 * A browser window in Tide: the page sits in a card on a light, tinted or
 * dark grey shell. Tabs run down a sidebar (which also
 * holds navigation and the address, so the card has no toolbar) or across the
 * top (the card gets one quiet toolbar row, joined by the active tab, both in
 * the site's colour). Command-S hides the tabs either way: the sidebar slides
 * away on Dia's spring and the traffic lights go with it; the pointer at the
 * window's left (or top) edge brings the tabs back over the page until it
 * leaves them. A page in fullscreen (a video, a PDF) fills the window alone,
 * with no tabs, toolbar or status line, as in Chrome. Overlays sit above
 * everything.
 */
export function BrowserWindow() {
  useCommitTrace();
  useViewMenu();
  const snapshot = useSnapshot();
  const actions = useActions();
  const active = useActiveTab();
  const { colors, reduceMotion } = useTheme();
  const chrome = useSiteChrome();
  const fullscreen = !!snapshot.fullscreen;
  const hidden = !!snapshot.modal.sidebarHidden;
  const tabs = !hidden && !fullscreen;
  const top = snapshot.modal.tabLayout === 'top';
  const side = tabs && !top;
  const { glass } = useTheme();
  const [macFullScreen, setMacFullScreen] = useState(false);
  // Where the page itself starts, below the toolbar and bookmarks bar, so a HUD sits on the page.
  const [pageTop, setPageTop] = useState(0);
  const borderless = useShellPrefs(p => p.borderlessMode);
  const frameSetting = useShellPrefs(p => p.pageFrame);
  const zeroInFullScreen = useShellPrefs(p => p.pageFrameZeroInFullScreen);
  const zeroWhenHidden = useShellPrefs(p => p.pageFrameZeroWhenTabsHidden);
  const addressInToolbar = useShellPrefs(p => p.addressBar === 'toolbar');
  const sidebarWidth = useShellPrefs(p => p.sidebarWidth);
  const barWhen = useShellPrefs(p => (p.showBookmarks ? p.bookmarksBar : 'never'));
  const peeking = useBrowser(s => s.peeking);
  const bounds = useBrowser(s => s.windowSize);
  const hoverCard = useBrowser(s => !!s.hoverCard);
  // While the window isn't in front its tabs fade back and the shell turns opaque, as macOS sidebars do.
  const inactive = useEased(!useBrowser(s => s.windowKey), reduceMotion);
  const tabsFade = inactive.interpolate({ inputRange: [0, 1], outputRange: [1, inactiveTabs] });
  // Where the pointer stops at the screen's edge a thin strip is enough to
  // reach; a window away from the edge gets a wider one (Ardia's 8 pt).
  const atEdge = useBrowser(s => (s.snapshot?.modal.tabLayout === 'top' ? s.screenEdges.top : s.screenEdges.left));
  const edgeStrip = atEdge ? geometry.edgeStrip : geometry.edgeStripWide;
  // Settings › Appearance › Bookmarks › Bookmarks bar: always, on new tabs and the start page only, or never.
  const onStart = !!active && (isStartUrl(active.url) || !!active.start);
  const bookmarksBar = !fullscreen && (barWhen === 'always' || (barWhen === 'newTab' && onStart));
  const slide = useSidebarSpring(side, sidebarWidth, reduceMotion);
  // The shell's glass stays while the sidebar slides away.
  const shell = tabs || (!top && !fullscreen && slide.shown);
  // Settings › Appearance › Page frame: the room around the page card. At 0
  // the page goes edge to edge with square corners.
  const frame = !tabs || borderless || (macFullScreen && (zeroInFullScreen || (zeroWhenHidden && hidden)))
    ? 0 : Math.max(PAGE_FRAME.min, Math.min(PAGE_FRAME.max, frameSetting));
  const framed = frame > 0;
  // With tabs in the sidebar the card has a toolbar only when the address is
  // set to be in it (Settings › Appearance › Address bar).
  const toolbar = !fullscreen && (!side || addressInToolbar);
  const peekable = hidden && !fullscreen;
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
        {bookmarksBar && <BookmarksBar />}
        <View style={{ flex: 1 }} onLayout={e => setPageTop(e.nativeEvent.layout.y + (tabs && top ? geometry.strip : frame))}><PageArea /></View>
        {!fullscreen && <StatusLine />}
      </View>
    </Panel>
  </View>;
  // One tree for every layout, so the page is never remounted when the tabs move or hide.
  return <TooltipLayer bounds={bounds} suppress={hoverCard}><View style={{ flex: 1, flexDirection: top ? 'column' : 'row',
    backgroundColor: colors[shell ? 'sidebarFallback' : 'contentBackground'] }}
    onLayout={e => actions.setWindowSize(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}>
    {/* The traffic lights hide with the tabs, as in Dia, and come back with them when they peek in. */}
    <FullScreenWatch onChange={setMacFullScreen} onState={actions.setWindowFacts} windowButtons={!peekable || peeking || macFullScreen}
      title={active ? tabTitle(active) : undefined} />
    {/* Glass lets the desktop through the shell; Classic is solid. */}
    {shell && glass.translucent && <Glass material="sidebar" style={cover} />}
    {shell && <ShellTint />}
    {/* A window not in front: an opaque, lighter shell, as in Dia. */}
    {shell && <Animated.View pointerEvents="none" style={[cover, { backgroundColor: colors.shellInactive, opacity: inactive }]} />}
    {shell && <DragRegion style={cover} />}
    {slide.shown && !top && !fullscreen && <Animated.View style={{ width: slide.width, overflow: 'hidden' }}>
      {/* Pinned to the right edge, so it slides out to the left as the column narrows. */}
      <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: sidebarWidth, flexDirection: 'row' }}>
        <Animated.View style={{ flexDirection: 'row', opacity: tabsFade }}><Sidebar width={sidebarWidth} /></Animated.View>
      </View>
    </Animated.View>}
    {card}
    {tabs && top && <Animated.View pointerEvents="box-none" style={[cover, { opacity: tabsFade }]}><TabStrip /></Animated.View>}
    {/* The hidden tabs come in from the edge the pointer reaches: a thin strip that lets clicks through. */}
    {peekable && !peeking && <View pointerEvents="none" onMouseEnter={actions.peek}
      style={top ? { position: 'absolute', top: 0, left: 0, right: 0, height: edgeStrip }
        : { position: 'absolute', top: 0, bottom: 0, left: 0, width: edgeStrip }} />}
    {peekable && (top ? <StripPeek /> : <SidebarPeek width={sidebarWidth} />)}
    <Overlays pageTop={pageTop} />
  </View></TooltipLayer>;
}

/**
 * The hidden sidebar over the page, as in Dia and Arc: a floating card with
 * the shell's glass, sliding in from the left on the sidebar's spring. It
 * stays while the pointer is on it or within a little of it, and slides away
 * a moment after it leaves; Hide sidebar's button keeps it open instead.
 */
function SidebarPeek({ width }: { width: number }) {
  const actions = useActions();
  const peeking = useBrowser(s => s.peeking);
  const { reduceMotion } = useTheme();
  const { progress, mounted } = usePeekSpring(peeking, reduceMotion);
  if (!mounted) return null;
  const inset = space.xs + space.hair;
  return <Animated.View pointerEvents="box-none" onMouseEnter={actions.peek} onMouseLeave={actions.unpeek}
    style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: width + inset + geometry.peekSlack,
      transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-(width + inset * 2), 0] }) }] }}>
    <FloatingShell style={{ position: 'absolute', top: inset, bottom: inset, left: inset, width }}>
      <Sidebar width={width} floating />
    </FloatingShell>
  </Animated.View>;
}

/** Hidden tabs across the top, sliding down over the toolbar and page while the pointer is at the top edge. */
function StripPeek() {
  const actions = useActions();
  const peeking = useBrowser(s => s.peeking);
  const { reduceMotion } = useTheme();
  const { progress, mounted } = usePeekSpring(peeking, reduceMotion);
  if (!mounted) return null;
  const inset = space.xs + space.hair;
  return <Animated.View pointerEvents="box-none" onMouseEnter={actions.peek} onMouseLeave={actions.unpeek}
    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: geometry.strip + inset + geometry.peekSlack,
      transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-(geometry.strip + inset * 2), 0] }) }] }}>
    <FloatingShell style={{ position: 'absolute', top: inset, left: inset, right: inset, height: geometry.strip }}>
      <TabStrip floating />
    </FloatingShell>
  </Animated.View>;
}

/** A floating card in the shell's glass and colour, with a shadow, for tabs peeking in over the page. */
function FloatingShell({ style, children }: React.PropsWithChildren<{ style: object }>) {
  const { colors, glass } = useTheme();
  return <View style={style}>
    <Panel fill="sidebarFallback" radius="window" elevation="popover" border="contentBorder" style={cover} />
    <View style={[cover, { borderRadius: radius.window, overflow: 'hidden' }]}>
      {glass.translucent && <Glass material="sidebar" blending="within" style={cover} />}
      <View style={[cover, { backgroundColor: shellTintFor(colors.shellTint, glass) }]} />
    </View>
    <View style={{ flex: 1, flexDirection: 'row' }}>{children}</View>
  </View>;
}

/**
 * The base colour over the shell's vibrancy, with an optional site tint in
 * either layout. Its strength follows the glass transparency. Classic is opaque.
 */
function ShellTint() {
  const { colors, reduceMotion, glass } = useTheme();
  const chrome = useSiteChrome();
  const tint = useColorFade(shellTintFor(chrome.shell ?? colors.shellTint, glass), reduceMotion);
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: tint }} />;
}
