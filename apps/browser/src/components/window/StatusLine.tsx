import React from 'react';
import { useSnapshot } from '../../state/window';
import { Box, KeyCap, Text } from '../ui';

/**
 * Merlin's key mode, the keys typed so far and the last message. After a
 * pause mid-sequence it lists the keys that can follow, like which-key.
 */
export function StatusLine() {
  const { modal } = useSnapshot();
  const note = modal.pending || modal.message;
  const next = modal.whichKey ?? [];
  if (modal.mode === 'Normal' && !note && !next.length) return null;
  return <Box borderTop="toolbarDivider">
    {!!next.length && <Box row wrap gap="md" padX="md" padTop="xs">
      {next.map(k => <Box key={k.keys} row align="center" gap="xs">
        <KeyCap>{k.keys}</KeyCap>
        <Text variant="caption" tone="textSecondary">{k.description}</Text>
      </Box>)}
    </Box>}
    <Box row gap="md" padX="md" padY="xs">
      <Text variant="caption" weight="semibold" tone="textAccent">{modal.mode}</Text>
      {!!note && <Text variant="caption" lines={1} flex={1}
        tone={!modal.pending && modal.messageIsError ? 'textDanger' : undefined}>{note}</Text>}
    </Box>
  </Box>;
}
