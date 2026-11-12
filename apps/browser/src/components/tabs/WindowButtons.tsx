import React from 'react';
import { View } from 'react-native';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { Badge, IconButton, space } from '../ui';

/** The profile switcher. Private windows have no profile to switch. */
export function ProfilesButton() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const popover = useBrowser(s => s.popover);
  if (snapshot.private) return null;
  return <IconButton label="Profiles" icon="person.crop.circle" selected={popover === 'profiles'} selectedFill="fillShellControl"
    onFrame={frame => actions.setAnchor('profiles', frame)} onPress={() => actions.togglePopover('profiles')} />;
}

/** Recent downloads, with a count while files are arriving. */
export function DownloadsButton() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const popover = useBrowser(s => s.popover);
  const downloading = snapshot.downloads.filter(d => d.state === 'progress').length;
  return <View>
    <IconButton label={downloading ? `Downloads, ${downloading} in progress` : 'Downloads'} icon="arrow.down.to.line"
      selected={popover === 'downloads'} selectedFill="fillShellControl" onFrame={frame => actions.setAnchor('downloads', frame)}
      onPress={() => actions.togglePopover('downloads')} />
    {!!downloading && <View pointerEvents="none" style={{ position: 'absolute', top: -space.hair, right: -space.hair }}>
      <Badge>{String(downloading)}</Badge>
    </View>}
  </View>;
}

/** The command menu, the Library and Settings, wherever the tabs are. */
export function LibraryButtons() {
  const actions = useActions();
  return <>
    <IconButton label="Command menu" icon="command" onPress={() => void actions.command('palette menu')} />
    <IconButton label="Library" icon="books.vertical" onPress={() => actions.openPanel('history')} />
    <IconButton label="Settings" icon="gearshape" onPress={() => actions.openPanel('settings')} />
  </>;
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

/** The bottom of the sidebar: profile and downloads on the left, the rest on the right. */
export function SidebarFooter() {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.hair }}>
    <ProfilesButton />
    <DownloadsButton />
    <View style={{ flex: 1 }} />
    <ExtensionsButton />
    <LibraryButtons />
  </View>;
}
