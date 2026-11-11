import React from 'react';
import { useSnapshot } from '../../state/window';
import { Box, Text } from '../ui';

/** Merlin's key mode and pending keys; hidden in the ordinary mode with nothing to say. */
export function StatusLine() {
  const { modal } = useSnapshot();
  const note = modal.pending || modal.message;
  if (modal.mode === 'Normal' && !note) return null;
  return <Box row gap="md" padX="md" padY="xs" borderTop="toolbarDivider">
    <Text variant="caption" weight="semibold" tone="textAccent">{modal.mode}</Text>
    {!!note && <Text variant="caption" lines={1} flex={1}>{note}</Text>}
  </Box>;
}
