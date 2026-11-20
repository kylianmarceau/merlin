import React from 'react';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { Box, KeyCap, Text, duration, useTimeout } from '../ui';

/**
 * Merlin's key mode and the keys typed so far. After a pause mid-sequence it
 * lists the keys that can follow, like which-key. Command results and
 * browser errors appear briefly in the same line.
 */
export function StatusLine() {
  const { modal } = useSnapshot();
  const actions = useActions();
  const message = useBrowser(s => s.statusMessage);
  const note = modal.pending;
  const next = modal.whichKey ?? [];
  const showMode = modal.mode !== 'Normal' || !!note || !!next.length;
  useTimeout(() => { if (message) actions.dismissStatusMessage(message); }, duration.statusMessage, [message]);
  if (!showMode && !message) return null;
  return <Box borderTop="toolbarDivider">
    {!!next.length && <Box row wrap gap="md" padX="md" padTop="xs">
      {next.map(k => <Box key={k.keys} row align="center" gap="xs">
        <KeyCap>{k.keys}</KeyCap>
        <Text variant="caption" tone="textSecondary">{k.description}</Text>
      </Box>)}
    </Box>}
    <Box row gap="md" padX="md" padY="xs">
      {showMode && <Text variant="caption" weight="semibold" tone="textAccent">{modal.mode}</Text>}
      {!!note && <Text variant="caption" lines={1} flex={1}>{note}</Text>}
      {message && <Text accessibilityLiveRegion="polite" variant="caption" flex={1} lines={2}
        tone={message.isError ? 'textDanger' : 'textSecondary'}>{message.text}</Text>}
    </Box>
  </Box>;
}
