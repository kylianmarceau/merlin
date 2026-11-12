import React from 'react';
import { View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import { useActions, useActiveTab, useBrowser, useSnapshot } from '../../state/window';
import { DragRegion, IconButton, geometry, space } from '../ui';
import { AddressField } from '../omnibox/AddressField';

/**
 * The page card's one quiet row, used with tabs across the top or with the
 * tabs hidden: navigation, the address and page actions. With tabs in the
 * sidebar the sidebar carries all of this and the card has no toolbar.
 * Empty space drags the window.
 */
export function Toolbar() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const tab = useActiveTab();
  const popover = useBrowser(s => s.popover);
  const hidden = !!snapshot.modal.sidebarHidden;
  const page = !!tab && !isStartUrl(tab.url);
  return <View style={{ height: geometry.toolbar, flexDirection: 'row', alignItems: 'center', gap: space.hair,
    paddingHorizontal: space.sm, paddingLeft: hidden ? geometry.sidebarCollapsedInset : space.sm }}>
    <DragRegion style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    {hidden && (snapshot.modal.tabLayout === 'top'
      ? <IconButton label="Show tabs" icon="rectangle.topthird.inset.filled" onPress={() => void actions.command('sidebar')} />
      : <IconButton label="Show sidebar" icon="sidebar.left" onPress={() => void actions.command('sidebar')} />)}
    <NavigationButtons />
    <View style={{ flex: 1, flexDirection: 'row', marginHorizontal: space.sm }}><AddressField /></View>
    <IconButton label="Bookmark this page" icon="bookmark" disabled={!page}
      onPress={() => { if (tab) void actions.bookmarkTab(tab.id); }} />
    <IconButton label="Extensions" icon="shippingbox" disabled={!tab}
      selected={popover === 'extensions' || !!snapshot.extensionPopup}
      onFrame={frame => actions.setAnchor('extensions', frame)} onPress={() => actions.togglePopover('extensions')} />
  </View>;
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
