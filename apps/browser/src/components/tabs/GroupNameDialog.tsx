import React, { useEffect, useState } from 'react';
import { folderTitle } from '../../state/favouriteFolders';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { CenteredPopup, PopupField, PopupFooter, useRefusal } from '../ui';
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
  const [name, setName] = useState('');
  const refused = useRefusal(null);
  const key = !dialog ? '' : dialog.kind === 'rename' ? `rename:${dialog.groupId}`
    : dialog.kind === 'renameFolder' ? `folder:${dialog.folderId}` : `${dialog.kind}:${dialog.tabId}`;
  // Each opening starts from the group's, tab's or folder's name (or nothing, for a new group).
  useEffect(() => { setName(current?.title ?? tab?.name ?? folder?.name ?? ''); }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  // A group, tab or folder that goes away (closed, or ungrouped elsewhere) takes its dialog with it.
  const gone = (dialog?.kind === 'rename' && !current) || (dialog?.kind === 'renameTab' && !tab) || (dialog?.kind === 'renameFolder' && !folder);
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
