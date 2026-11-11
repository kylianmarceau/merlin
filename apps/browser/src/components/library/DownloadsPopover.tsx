import React from 'react';
import { useActions, useSnapshot } from '../../state/window';
import { Box, Button, EmptyState, MenuSeparator, Text } from '../ui';
import { DownloadRow } from './DownloadRow';

/** Recent downloads under the sidebar button; the Library has the rest. */
export function DownloadsPopover() {
  const actions = useActions();
  const { downloads } = useSnapshot();
  const recent = downloads.slice(0, 5);
  return <Box gap="xs">
    <Box padX="sm" padTop="xs" padBottom="xs"><Text variant="bodyStrong">Downloads</Text></Box>
    {!recent.length && <EmptyState icon="arrow.down.circle" title="No downloads" detail="Files you download appear here." />}
    {recent.map(d => <DownloadRow key={d.id} download={d} onAction={a => void actions.downloadAction(d.id, a)} />)}
    <MenuSeparator />
    <Box row justify="space-between" padX="xs" padBottom="xs">
      <Button label="Open Folder" icon="folder" variant="ghost" size="small" onPress={() => void actions.openDownloadsFolder()} />
      <Button label="Show All" variant="ghost" size="small" trailingIcon="chevron.right" onPress={() => actions.openPanel('downloads')} />
    </Box>
  </Box>;
}
