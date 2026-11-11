import React from 'react';
import { View } from 'react-native';
import { promptChipLabel, promptIcon } from '../../lib/prompts';
import { isStartUrl } from '../../lib/format';
import { useActions, useActiveTab, useBrowser, useSnapshot } from '../../state/window';
import { Button, DragRegion, IconButton, geometry, space } from '../ui';
import { AddressField } from '../omnibox/AddressField';

/** Navigation, the address field and page actions. Empty space drags the window. */
export function Toolbar() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const tab = useActiveTab();
  const popover = useBrowser(s => s.popover);
  const revealed = useBrowser(s => s.revealedPromptId);
  const hidden = !!snapshot.modal.sidebarHidden;
  const waiting = snapshot.prompt?.quiet && snapshot.prompt.id !== revealed ? snapshot.prompt : null;
  const page = !!tab && !isStartUrl(tab.url);
  return <View style={{ height: geometry.toolbar, flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, paddingLeft: hidden ? geometry.sidebarCollapsedInset : space.sm }}>
    <DragRegion style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    {hidden && <IconButton label="Show sidebar" icon="sidebar.left" onPress={() => void actions.command('sidebar')} />}
    <IconButton label="Back" icon="arrow.left" disabled={!tab?.canGoBack} onPress={() => void actions.back()} />
    <IconButton label="Forward" icon="arrow.right" disabled={!tab?.canGoForward} onPress={() => void actions.forward()} />
    <IconButton label={tab?.loading ? 'Stop loading' : 'Reload'} icon={tab?.loading ? 'xmark' : 'arrow.clockwise'}
      disabled={!tab} onPress={() => void actions.reloadOrStop()} />
    <AddressField />
    {waiting && <Button label={promptChipLabel(waiting)} icon={promptIcon(waiting)} size="small" variant="secondary"
      accessibilityHint="Shows a request this page is waiting on" onPress={() => actions.revealPrompt(waiting.id)} />}
    <IconButton label="Bookmark this page" icon="bookmark" disabled={!page}
      onPress={() => { if (tab) void actions.bookmarkTab(tab.id); }} />
    <IconButton label="Extensions" icon="puzzlepiece.extension" disabled={!tab}
      selected={popover === 'extensions' || !!snapshot.extensionPopup}
      onFrame={frame => actions.setAnchor('extensions', frame)} onPress={() => actions.togglePopover('extensions')} />
  </View>;
}
