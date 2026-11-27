import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { folderTitle } from '../../state/favouriteFolders';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { nextName } from '../../state/spaces';
import { CenteredPopup, PopupField, PopupFooter, Pressable, Text, Toggle, space, useRefusal } from '../ui';
import { tabTitle } from './TabRow';

/**
 * Names a new tab group or renames one, gives a tab a name of its own
 * (Rename Tab, as in Ardia), or names a favourite folder; in the same place
 * as the command menu. A tab left without a name shows its page's title
 * again, and a folder its count.
 */
export function GroupNameDialog() {
  const actions = useActions();
  const snapshot = useSnapshot();
  const dialog = useBrowser(s => s.groupDialog);
  const current = dialog?.kind === 'rename' ? snapshot.groups?.find(g => g.id === dialog.groupId) : undefined;
  const tab = dialog?.kind === 'renameTab' ? snapshot.tabs.find(t => t.id === dialog.tabId) : undefined;
  const folders = useShellPrefs(p => p.favouriteFolders);
  const folder = dialog?.kind === 'renameFolder' ? folders.find(f => f.id === dialog.folderId) : undefined;
  const spaces = useShellPrefs(p => p.spaces);
  const renamed = dialog?.kind === 'renameSpace' ? spaces.find(s => s.id === dialog.spaceId) : undefined;
  const [name, setName] = useState('');
  const refused = useRefusal(null);
  const key = !dialog ? '' : dialog.kind === 'rename' ? `rename:${dialog.groupId}`
    : dialog.kind === 'renameFolder' ? `folder:${dialog.folderId}` : dialog.kind === 'renameSpace' ? `space:${dialog.spaceId}`
    : dialog.kind === 'newSpace' ? 'newSpace' : `${dialog.kind}:${dialog.tabId}`;
  // Each opening starts from the group's, tab's, folder's or space's name (or nothing, for a new group or space).
  useEffect(() => { setName(current?.title ?? tab?.name ?? folder?.name ?? renamed?.name ?? ''); }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  // A group, tab, folder or space that goes away (closed, or ungrouped elsewhere) takes its dialog with it.
  const gone = (dialog?.kind === 'rename' && !current) || (dialog?.kind === 'renameTab' && !tab) || (dialog?.kind === 'renameFolder' && !folder) ||
    (dialog?.kind === 'renameSpace' && !renamed);
  useEffect(() => { if (gone) actions.closeGroupDialog(); }, [gone, actions]);
  if (!dialog || gone) return null;
  if (dialog.kind === 'renameTab' && tab) {
    return <CenteredPopup label="Rename Tab" onDismiss={actions.closeGroupDialog} shake={refused.count}>
      <PopupField icon="pencil" value={name} label="Rename Tab" placeholder={tabTitle({ ...tab, name: undefined })}
        onChangeText={setName} onSubmit={() => void actions.submitGroupDialog(name)} onEscape={actions.closeGroupDialog} />
      <PopupFooter accept="Rename" />
    </CenteredPopup>;
  }
  if (dialog.kind === 'renameFolder' && folder) {
    return <CenteredPopup label="Rename Folder" onDismiss={actions.closeGroupDialog}>
      <PopupField icon="folder" value={name} label="Rename Folder" placeholder={folderTitle(folder, folder.members.length)}
        onChangeText={setName} onSubmit={() => void actions.submitGroupDialog(name)} onEscape={actions.closeGroupDialog} />
      <PopupFooter accept="Rename" />
    </CenteredPopup>;
  }
  if (dialog.kind === 'renameFolder') return null;
  if (dialog.kind === 'newSpace' || dialog.kind === 'renameSpace') {
    // A space needs a name: renaming to nothing is refused; a new one left unnamed takes the next "Space n".
    const label = dialog.kind === 'newSpace' ? 'New Space' : 'Rename Space';
    const submit = () => {
      if (dialog.kind === 'renameSpace' && !name.trim()) { refused.again(); return; }
      void actions.submitGroupDialog(name);
    };
    // A new space takes the data of the space showing, or keeps its own, as
    // Arc's New Space picks a profile; Tab changes which.
    const own = dialog.kind === 'newSpace' && !!dialog.ownData;
    const flip = () => { if (dialog.kind === 'newSpace') actions.nameGroup({ ...dialog, ownData: !dialog.ownData }); };
    return <CenteredPopup label={label} onDismiss={actions.closeGroupDialog} shake={refused.count}>
      <PopupField icon="square.stack" value={name} label={label} placeholder={renamed?.name ?? nextName(spaces)}
        onChangeText={setName} onSubmit={submit} onEscape={actions.closeGroupDialog}
        onKey={key => { if (key === 'tab') flip(); }} />
      {dialog.kind === 'newSpace' && <OwnDataChoice own={own} onChange={flip} />}
      <PopupFooter accept={dialog.kind === 'newSpace' ? 'Create Space' : 'Rename'}>
        {dialog.kind === 'newSpace' && <FooterHint keys="⇥" label="Own Data" />}
      </PopupFooter>
    </CenteredPopup>;
  }
  const label = dialog.kind === 'new' ? 'Name the New Group' : 'Rename Group';
  // A group renamed to nothing, or to another group's name, is refused: the pop-up shakes.
  const trimmed = name.trim();
  const taken = !!trimmed && (snapshot.groups ?? []).some(g => g.id !== current?.id && g.title.trim().toLowerCase() === trimmed.toLowerCase());
  const submit = () => {
    if (taken || (dialog.kind === 'rename' && !trimmed)) { refused.again(); return; }
    void actions.submitGroupDialog(name);
  };
  return <CenteredPopup label={label} onDismiss={actions.closeGroupDialog} shake={refused.count}>
    <PopupField icon="rectangle.stack" value={name} label={label} placeholder={dialog.kind === 'new' ? 'Group name (optional)' : 'Group name'}
      onChangeText={setName} onSubmit={submit} onEscape={actions.closeGroupDialog} />
    <PopupFooter accept={dialog.kind === 'new' ? 'Create Group' : 'Rename'} />
  </CenteredPopup>;
}

/**
 * Whether a new space keeps its own data: logged out everywhere, with its own
 * history, passwords, bookmarks, extensions and favourites, as a space can in
 * Arc. Off, it shares the space showing's.
 */
function OwnDataChoice({ own, onChange }: { own: boolean; onChange(): void }) {
  return <Pressable accessible={false} onPress={onChange}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg + space.xs, paddingVertical: space.sm }}>
    <View style={{ flex: 1, gap: space.hair }}>
      <Text variant="body" lines={1}>Keep its own data</Text>
      <Text variant="caption" tone="textSecondary" lines={2}>
        {own ? 'Logged out everywhere, with its own history, passwords, bookmarks and extensions.'
          : 'Shares logins, history and bookmarks with the space showing.'}
      </Text>
    </View>
    <Toggle label="Keep its own data" value={own} onChange={onChange} />
  </Pressable>;
}

function FooterHint({ keys, label }: { keys: string; label: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair }}>
    <Text variant="label" weight="semibold" tone="groupLabel">{keys}</Text>
    <Text variant="label" weight="regular" tone="textSecondary">{label}</Text>
  </View>;
}
