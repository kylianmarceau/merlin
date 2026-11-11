import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { EngineClient } from '@merlin/engine/protocol';
import { Button, Dialog, Field, Label, Row } from './components';
import { Notice, Toggle, useAction, useRequest } from './controls';
import { space } from './tokens';

/** Extension actions for the current page, and quick on/off switches. */
export function Extensions({ engine, onClose }: { engine: EngineClient; onClose(): void }) {
  const list = useRequest(engine, 'extensions.list', {});
  const action = useAction(engine);
  const run = async (id: string) => { if ((await action.run('extensions.run', { id })) !== undefined) onClose(); };
  return <Dialog title="Extensions" subtitle="Run an extension on this page, or turn one off." onClose={onClose} width={480}
    actions={<Button title="Manage extensions" onPress={() => void action.run('extensions.manage', {}).then(v => { if (v !== undefined) onClose(); })} />}>
    {(list.error || action.error) && <Notice tone="error">{list.error || action.error}</Notice>}
    {list.loading && !list.data && <Label muted>Loading extensions…</Label>}
    {list.data && !list.data.length && <Label muted>No extensions are installed. Add them from the Chrome Web Store.</Label>}
    <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: space.xs }}>
      {list.data?.map(ext => <Row key={ext.id} title={ext.name}
        detail={!ext.enabled ? 'Off' : ext.hasAction ? (ext.actionTitle || 'Run on this page') : 'Runs automatically'}
        onPress={() => { if (ext.enabled && ext.hasAction) void run(ext.id); }}
        trailing={<View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingRight: space.sm }}>
          <Button title={`Settings for ${ext.name}`} icon="gearshape" iconOnly quiet compact
            onPress={() => void action.run('extensions.manage', { id: ext.id }).then(v => { if (v !== undefined) onClose(); })} />
          <Toggle label={`${ext.name} enabled`} value={ext.enabled} disabled={!ext.canToggle || action.busy} onChange={async enabled => {
            if ((await action.run('extensions.setEnabled', { id: ext.id, enabled })) !== undefined) list.reload();
          }} />
        </View>} />)}
    </ScrollView>
  </Dialog>;
}

/** Switch between profiles, each with its own window, history and sign-ins. */
export function Profiles({ engine, onClose }: { engine: EngineClient; onClose(): void }) {
  const list = useRequest(engine, 'profiles.list', {});
  const action = useAction(engine);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  return <Dialog title="Profiles" subtitle="Each profile keeps its own tabs, history and saved passwords." onClose={onClose}
    actions={adding ? <>
      <Button title="Cancel" onPress={() => { setAdding(false); setName(''); }} />
      <Button title="Create profile" emphasis="primary" disabled={!name.trim() || action.busy} onPress={async () => {
        if ((await action.run('profiles.create', { name: name.trim() })) !== undefined) onClose();
      }} /></> : <Button title="Add profile" icon="plus" onPress={() => setAdding(true)} />}>
    {(list.error || action.error) && <Notice tone="error">{list.error || action.error}</Notice>}
    {list.data?.map(p => <Row key={p.id} title={p.name} selected={p.active} detail={p.active ? 'This window' : 'Open in a new window'}
      onPress={async () => { if (p.active) onClose(); else if ((await action.run('profiles.open', { id: p.id })) !== undefined) onClose(); }} />)}
    {adding && <Field autoFocus accessibilityLabel="Profile name" placeholder="Profile name" value={name} maxLength={64}
      onChangeText={setName} onSubmitEditing={async () => {
        if (name.trim() && (await action.run('profiles.create', { name: name.trim() })) !== undefined) onClose();
      }} />}
  </Dialog>;
}
