import React, { useState } from 'react';
import { View } from 'react-native';
import { useAction, useActions, useRequest } from '../../state/window';
import {
  Box, Button, Field, Icon, MenuRow, MenuSection, MenuSeparator, Notice, PopoverBody, PopoverRow, Text, geometry, radius, useTheme,
} from '../ui';

/** A profile's initial in a circle; the active one takes the workspace colour. */
function Avatar({ name, active }: { name: string; active: boolean }) {
  const { colors } = useTheme();
  return <View style={{ width: geometry.avatar, height: geometry.avatar, borderRadius: radius.pill, alignItems: 'center',
    justifyContent: 'center', backgroundColor: colors[active ? 'accent' : 'fillControl'] }}>
    <Text weight="semibold" tone={active ? 'textOnAccent' : 'textPrimary'}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
  </View>;
}

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
  return <>
    <MenuSection title="Profiles" />
    {(list.error || action.error) && <PopoverBody><Notice tone="error">{list.error || action.error}</Notice></PopoverBody>}
    {list.data?.map(p => <PopoverRow key={p.id} title={p.name} selected={p.active}
      detail={p.active ? 'This window' : 'Opens in a new window'} leading={<Avatar name={p.name} active={p.active} />}
      trailing={p.active ? <Icon name="checkmark" tone="accent" size="small" weight="semibold" /> : undefined}
      onPress={async () => {
        if (p.active) actions.closePopover();
        else if ((await action.run('profiles.open', { id: p.id })) !== undefined) actions.closePopover();
      }} />)}
    <MenuSeparator />
    {adding ? <PopoverBody>
      <Field autoFocus accessibilityLabel="Profile name" placeholder="Profile name" value={name} maxLength={64}
        onChangeText={setName} onSubmitEditing={() => void create()} />
      <Box row gap="sm" justify="flex-end">
        <Button label="Cancel" variant="ghost" size="small" onPress={() => { setAdding(false); setName(''); }} />
        <Button label="Create" variant="primary" size="small" disabled={!name.trim() || action.busy} onPress={() => void create()} />
      </Box>
    </PopoverBody> : <MenuRow label="New profile…" onPress={() => setAdding(true)} />}
  </>;
}
