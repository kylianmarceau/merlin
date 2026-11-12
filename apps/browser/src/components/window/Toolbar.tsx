import React from 'react';
import { Animated, View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import { useActions, useActiveTab, useBrowser, useSnapshot } from '../../state/window';
import { DragRegion, IconButton, PaletteScope, geometry, space, useColorFade, useTheme } from '../ui';
import { useSiteChrome } from '../tabs/siteChrome';
import { AddressField } from '../omnibox/AddressField';

/**
 * The page card's one quiet row, used with tabs across the top or with the
 * tabs hidden: navigation, the address and page actions. With tabs in the
 * sidebar the sidebar carries all of this and the card has no toolbar.
 * With tabs on top it takes the site's colour, like the active tab joined to
 * it. Empty space drags the window.
 */
export function Toolbar() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const tab = useActiveTab();
  const popover = useBrowser(s => s.popover);
  const hidden = !!snapshot.modal.sidebarHidden;
  const page = !!tab && !isStartUrl(tab.url);
  const { reduceMotion } = useTheme();
  const chrome = useSiteChrome();
  const fill = useColorFade(chrome.bar, reduceMotion);
  const top = snapshot.modal.tabLayout === 'top';
  return <PaletteScope roles={chrome.roles}><Animated.View style={{ height: geometry.toolbar, flexDirection: 'row', alignItems: 'center',
    gap: space.hair, paddingHorizontal: space.sm, paddingLeft: hidden ? geometry.sidebarCollapsedInset : space.sm, backgroundColor: fill }}>
    <DragRegion style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    {top
      ? <IconButton label={hidden ? 'Show tabs' : 'Hide tabs'} icon="rectangle.topthird.inset.filled" onPress={() => void actions.command('sidebar')} />
      : hidden && <IconButton label="Show sidebar" icon="sidebar.left" onPress={() => void actions.command('sidebar')} />}
    <NavigationButtons />
    <View style={{ flex: 1, flexDirection: 'row', marginHorizontal: space.sm }}><AddressField /></View>
    <IconButton label="Bookmark this page" icon="bookmark" disabled={!page}
      onPress={() => { if (tab) void actions.bookmarkTab(tab.id); }} />
    <IconButton label="Extensions" icon="shippingbox" disabled={!tab}
      selected={popover === 'extensions' || !!snapshot.extensionPopup}
      onFrame={frame => actions.setAnchor('extensions', frame)} onPress={() => actions.togglePopover('extensions')} />
  </Animated.View></PaletteScope>;
}

/** Back, forward and reload (stop while loading). */
export function NavigationButtons() {
  const actions = useActions();
  const tab = useActiveTab();
  return <>
    <IconButton label="Back" icon="chevron.left" disabled={!tab?.canGoBack} onPress={() => void actions.back()} />
    <IconButton label="Forward" icon="chevron.right" disabled={!tab?.canGoForward} onPress={() => void actions.forward()} />
    <IconButton label={tab?.loading ? 'Stop loading' : 'Reload'} icon={tab?.loading ? 'xmark' : 'arrow.clockwise'}
      disabled={!tab} onPress={() => void actions.reloadOrStop()} />
  </>;
}
