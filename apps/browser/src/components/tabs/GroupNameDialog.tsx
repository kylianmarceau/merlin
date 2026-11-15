import React, { useEffect, useState } from 'react';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { CenteredPopup, PopupField, PopupFooter } from '../ui';

/** Names a new tab group, or renames one; in the same place as the command menu. */
export function GroupNameDialog() {
  const actions = useActions();
  const snapshot = useSnapshot();
  const dialog = useBrowser(s => s.groupDialog);
  const current = dialog?.kind === 'rename' ? snapshot.groups?.find(g => g.id === dialog.groupId) : undefined;
  const [name, setName] = useState('');
  const key = dialog ? (dialog.kind === 'new' ? `new:${dialog.tabId}` : `rename:${dialog.groupId}`) : '';
  // Each opening starts from the group's name (or nothing, for a new group).
  useEffect(() => { setName(current?.title ?? ''); }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  // A group renamed away (closed, or ungrouped elsewhere) takes its dialog with it.
  const gone = dialog?.kind === 'rename' && !current;
  useEffect(() => { if (gone) actions.closeGroupDialog(); }, [gone, actions]);
  if (!dialog || gone) return null;
  const label = dialog.kind === 'new' ? 'Name the New Group' : 'Rename Group';
  return <CenteredPopup label={label} onDismiss={actions.closeGroupDialog}>
    <PopupField icon="rectangle.stack" value={name} label={label} placeholder={dialog.kind === 'new' ? 'Group name (optional)' : 'Group name'}
      onChangeText={setName} onSubmit={() => void actions.submitGroupDialog(name)} onEscape={actions.closeGroupDialog} />
    <PopupFooter accept={dialog.kind === 'new' ? 'Create Group' : 'Rename'} />
  </CenteredPopup>;
}
