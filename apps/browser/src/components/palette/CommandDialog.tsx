import React, { useState } from 'react';
import { useActions } from '../../state/window';
import { CenteredPopup, PopupField, PopupFooter } from '../ui';

/** Type one Merlin command, as from the app menu; in the same place as the command menu. */
export function CommandDialog({ open }: { open: boolean }) {
  const actions = useActions();
  const [command, setCommand] = useState('');
  if (!open) return null;
  const close = () => { setCommand(''); actions.closePanel(); };
  const run = async () => {
    if (command.trim() && await actions.command(command)) close();
  };
  return <CenteredPopup label="Run a Command" onDismiss={close}>
    <PopupField icon="command" value={command} label="Merlin command" placeholder="Run a command, for example: workspace open research"
      onChangeText={setCommand} onSubmit={() => void run()} onEscape={close} />
    <PopupFooter accept="Run" />
  </CenteredPopup>;
}
