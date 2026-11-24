import React from 'react';
import { Animated, View } from 'react-native';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActions, useActiveTab, useBrowser, useSnapshot } from '../../state/window';
import { ContextMenu, DragRegion, IconButton, PaletteScope, duration, geometry, isDarkSurface, space, useColorFade, useTheme } from '../ui';
import { useSiteChrome } from '../tabs/siteChrome';
import { AddressField } from '../omnibox/AddressField';
import { useShortcut } from './shortcuts';

/**
 * The page card's one quiet row, used with tabs across the top or with the
 * tabs hidden: navigation, the address and extensions, as calm as Dia's.
 * The bookmark star and the page's other actions are in the address field,
 * shown as the pointer comes to it. With tabs in the sidebar the sidebar
 * carries all of this and the card has no toolbar. With tabs on top it takes
 * the site's colour, like the active tab joined to it. Empty space drags the
 * window.
 */
export function Toolbar() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const tab = useActiveTab();
  const popover = useBrowser(s => s.popover);
  const hidden = !!snapshot.modal.sidebarHidden;
  const { reduceMotion } = useTheme();
  const chrome = useSiteChrome();
  const fill = useColorFade(chrome.bar, reduceMotion);
  const top = snapshot.modal.tabLayout === 'top';
  const compact = useShellPrefs(p => p.compactToolbar);
  const size = compact ? 'compact' : 'regular';
  const toggle = useShortcut(top ? (hidden ? 'Show tabs' : 'Hide tabs') : 'Show sidebar', ['⌘', 'S'], 'gs');
  // With the tabs hidden the traffic lights hide too (as in Dia), so the row starts at the edge.
  return <PaletteScope roles={chrome.roles}><Animated.View style={{ height: compact ? geometry.toolbarCompact : geometry.toolbar, flexDirection: 'row', alignItems: 'center',
    gap: space.hair, paddingHorizontal: space.sm, backgroundColor: fill }}>
    <DragRegion style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    {top
      ? <IconButton label={toggle.tip} tip={toggle.tip} keys={toggle.keys} tipDetail={toggle.detail} icon="rectangle.topthird.inset.filled" size={size}
        onPress={() => { actions.endPeek(); void actions.command('sidebar'); }} />
      : hidden && <IconButton label="Show sidebar" tip={toggle.tip} keys={toggle.keys} tipDetail={toggle.detail} icon="sidebar.left" size={size}
        onPress={() => { actions.endPeek(); void actions.command('sidebar'); }} />}
    <NavigationButtons size={size} />
    <View style={{ flex: 1, flexDirection: 'row', marginHorizontal: space.sm }}>
      <AddressField compact={compact} glassDark={isDarkSurface(chrome.bar)} />
    </View>
    <IconButton label="Extensions" icon="shippingbox" disabled={!tab} size={size}
      selected={popover === 'extensions' || !!snapshot.extensionPopup}
      onFrame={frame => actions.setAnchor('extensions', frame)} onPress={() => actions.togglePopover('extensions')} />
  </Animated.View></PaletteScope>;
}

/**
 * Back, forward and reload (stop while loading). Holding Back or Forward,
 * or right-clicking it, lists the pages that way, as in Safari and Dia.
 */
export function NavigationButtons({ size = 'regular' }: { size?: 'regular' | 'compact' }) {
  const actions = useActions();
  const tab = useActiveTab();
  const back = useShortcut('Back', ['⌘', '['], 'H');
  const forward = useShortcut('Forward', ['⌘', ']'], 'L');
  const reload = useShortcut(tab?.loading ? 'Stop loading' : 'Reload', tab?.loading ? ['⌘', '.'] : ['⌘', 'R'], tab?.loading ? undefined : 'r');
  const history = tab?.engine !== 'webkit';
  return <>
    <HistoryButton direction="back" label="Back" icon="chevron.left" size={size} disabled={!tab?.canGoBack} history={history}
      keys={back.keys} detail={history ? 'Hold to see history' : back.detail} onPress={() => void actions.back()} />
    <HistoryButton direction="forward" label="Forward" icon="chevron.right" size={size} disabled={!tab?.canGoForward} history={history}
      keys={forward.keys} detail={history ? 'Hold to see history' : forward.detail} onPress={() => void actions.forward()} />
    <IconButton label={reload.tip} keys={reload.keys} tipDetail={reload.detail} icon={tab?.loading ? 'xmark' : 'arrow.clockwise'} size={size}
      disabled={!tab} onPress={() => void actions.reloadOrStop()} />
  </>;
}

function HistoryButton({ direction, label, icon, size, disabled, history, keys, detail, onPress }: {
  direction: 'back' | 'forward'; label: string; icon: 'chevron.left' | 'chevron.right'; size: 'regular' | 'compact';
  disabled: boolean; history: boolean; keys: string[]; detail?: string; onPress(): void;
}) {
  const actions = useActions();
  // A long press opens the menu instead of going back (Pressable then sends no press).
  const button = <IconButton label={label} keys={keys} tipDetail={detail} icon={icon} size={size} disabled={disabled}
    delayLongPress={duration.holdMenu} onLongPress={history ? () => void actions.historyMenu(direction) : undefined} onPress={onPress} />;
  return history && !disabled ? <ContextMenu onOpen={() => void actions.historyMenu(direction)}>{button}</ContextMenu> : button;
}
