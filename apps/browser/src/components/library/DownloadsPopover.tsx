import React from 'react';
import { Pressable } from 'react-native';
import { useActions, useSnapshot } from '../../state/window';
import { MenuFooter, MenuSection, MenuSeparator, PopoverBody, Text } from '../ui';
import { DownloadRow } from './DownloadRow';

/** Recent downloads under their button; the Library has the rest. */
export function DownloadsPopover() {
  const actions = useActions();
  const { downloads } = useSnapshot();
  const recent = downloads.slice(0, 5);
  return <>
    <MenuSection title="Recent downloads" trailing={<Pressable accessibilityRole="button" accessibilityLabel="Open the downloads folder"
      onPress={() => void actions.openDownloadsFolder()}>
      <Text variant="label" tone="textSecondary">Open folder</Text>
    </Pressable>} />
    {!recent.length && <PopoverBody><Text tone="textSecondary">Files you download appear here.</Text></PopoverBody>}
    {recent.map(d => <DownloadRow key={d.id} download={d} onAction={a => void actions.downloadAction(d.id, a)} />)}
    <MenuSeparator />
    <MenuFooter label="View all downloads" onPress={() => actions.openPanel('downloads')} />
  </>;
}
