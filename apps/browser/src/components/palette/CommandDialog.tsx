import React, { useState } from 'react';
import { useActions } from '../../state/window';
import { Button, Dialog, Field } from '../ui';

/** Type one Merlin command, as from the app menu. */
export function CommandDialog({ open }: { open: boolean }) {
  const actions = useActions();
  const [command, setCommand] = useState('');
  const run = async () => {
    if (command.trim() && await actions.command(command)) { actions.closePanel(); setCommand(''); }
  };
  return <Dialog open={open} title="Run a Command" subtitle="For example: workspace open research" icon="command"
    onClose={actions.closePanel} dismissOnScrim place="top"
    actions={<Button label="Run" variant="primary" disabled={!command.trim()} onPress={() => void run()} />}>
    <Field autoFocus icon="command" accessibilityLabel="Merlin command" placeholder="Command" value={command}
      onChangeText={setCommand} onSubmitEditing={() => void run()} />
  </Dialog>;
}
