import React, { useState } from 'react';
import { useAction, useActions, useRequest } from '../../state/window';
import { Box, Button, Field, IconTile, ListRow, MenuRow, MenuSeparator, Notice, Text } from '../ui';

/** Switch profiles; each keeps its own tabs, history and saved passwords. */
export function ProfilesPopover() {
  const actions = useActions();
  const list = useRequest('profiles.list', {});
  const action = useAction();
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const create = async () => {
    if (name.trim() && (await action.run('profiles.create', { name: name.trim() })) !== undefined) actions.closePopover();
  };
  return <Box gap="xs">
    <Box padX="sm" padTop="xs" padBottom="xs" gap="hair">
      <Text variant="bodyStrong">Profiles</Text>
      <Text variant="caption">Each profile has its own window, history and sign-ins.</Text>
    </Box>
    {(list.error || action.error) && <Notice tone="error">{list.error || action.error}</Notice>}
    {list.data?.map(p => <ListRow key={p.id} title={p.name} selected={p.active}
      detail={p.active ? 'This window' : 'Opens in a new window'} leading={<IconTile icon="person.crop.circle" tone={p.active ? 'accent' : 'iconSecondary'} />}
      onPress={async () => {
        if (p.active) actions.closePopover();
        else if ((await action.run('profiles.open', { id: p.id })) !== undefined) actions.closePopover();
      }} />)}
    <MenuSeparator />
    {adding ? <Box gap="sm" pad="xs">
      <Field autoFocus accessibilityLabel="Profile name" placeholder="Profile name" value={name} maxLength={64}
        onChangeText={setName} onSubmitEditing={() => void create()} />
      <Box row gap="sm" justify="flex-end">
        <Button label="Cancel" variant="ghost" size="small" onPress={() => { setAdding(false); setName(''); }} />
        <Button label="Create" variant="primary" size="small" disabled={!name.trim() || action.busy} onPress={() => void create()} />
      </Box>
    </Box> : <MenuRow label="Add Profile…" icon="plus" onPress={() => setAdding(true)} />}
  </Box>;
}
