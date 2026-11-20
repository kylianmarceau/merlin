import React, { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { overallProgress } from '../../lib/format';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { Badge, IconButton, ProgressRing, duration, geometry, space, useNudge, useTheme, useTimeout } from '../ui';

/**
 * Recent downloads. While files arrive a ring around the arrow fills with
 * their progress (circling until their size is known), with a count when
 * there are several; it fills completely as the last one finishes. A new
 * download's icon flies into the button, which nudges as it lands.
 */
export function DownloadsButton() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const popover = useBrowser(s => s.popover);
  const landings = useBrowser(s => s.downloadLandings);
  const { reduceMotion } = useTheme();
  const nudge = useNudge(landings, reduceMotion);
  const running = snapshot.downloads.filter(d => d.state === 'progress');
  const count = running.length;
  const progress = overallProgress(running);
  const paused = count > 0 && running.every(d => d.status === 'paused');
  const [finishing, setFinishing] = useState(false);
  const before = useRef(count);
  useEffect(() => { if (before.current > 0 && count === 0) setFinishing(true); before.current = count; }, [count]);
  useTimeout(() => setFinishing(false), duration.ringHold, [finishing]);
  const ring = count > 0 || finishing;
  const label = count
    ? `Downloads, ${count} in progress${progress === null ? '' : `, ${Math.round(progress * 100)}%`}`
    : 'Downloads';
  return <Animated.View style={{ transform: [{ scale: nudge }] }}>
    <IconButton label={label} tip="Downloads" keys={['⌥', '⌘', 'L']} icon={ring ? 'arrow.down' : 'arrow.down.to.line'}
      selected={popover === 'downloads'} selectedFill="fillShellControl" onFrame={frame => actions.setAnchor('downloads', frame)}
      onPress={() => actions.togglePopover('downloads')} />
    {ring && <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center',
      justifyContent: 'center' }}>
      <ProgressRing value={count ? progress : 1} size={geometry.control - space.xs} muted={paused} />
    </View>}
    {count > 1 && <View pointerEvents="none" style={{ position: 'absolute', top: -space.hair, right: -space.hair }}>
      <Badge>{String(count)}</Badge>
    </View>}
  </Animated.View>;
}

/** The command menu, the Library and Settings, wherever the tabs are. */
export function LibraryButtons() {
  const actions = useActions();
  const modal = useSnapshot().modal.modalBrowsing !== false;
  return <>
    <IconButton label="Command menu" tipDetail={modal ? 'Normal mode: M' : undefined} icon="command"
      onPress={() => void actions.command('palette menu')} />
    <IconButton label="Library" tip="History, bookmarks and downloads" keys={['⌘', 'Y']} icon="books.vertical"
      onPress={() => actions.openPanel('history')} />
    <IconButton label="Settings" keys={['⌘', ',']} icon="gearshape" onPress={() => actions.openPanel('settings')} />
  </>;
}

/** Merlin's workspaces (saved sets of tabs), from the sidebar as Arc's spaces are. */
function WorkspacesButton() {
  const actions = useActions();
  const modal = useSnapshot().modal.modalBrowsing !== false;
  return <IconButton label="Workspaces" tipDetail={modal ? 'Normal mode: gw' : undefined} icon="rectangle.stack"
    onPress={() => void actions.command('workspace')} />;
}

/** The extensions button; in the sidebar layout it lives here, as the card has no toolbar. */
export function ExtensionsButton() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const popover = useBrowser(s => s.popover);
  return <IconButton label="Extensions" icon="shippingbox" selected={popover === 'extensions' || !!snapshot.extensionPopup}
    selectedFill="fillShellControl" onFrame={frame => actions.setAnchor('extensions', frame)}
    onPress={() => actions.togglePopover('extensions')} />;
}

/** Downloads on the left, with the other sidebar controls on the right. */
export function SidebarFooter() {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.hair }}>
    <DownloadsButton />
    <View style={{ flex: 1 }} />
    <WorkspacesButton />
    <ExtensionsButton />
    <LibraryButtons />
  </View>;
}
