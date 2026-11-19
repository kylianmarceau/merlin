import React from 'react';
import { useActions, useSnapshot } from '../../state/window';
import { MenuFooter, MenuSection, MenuSeparator, MenuTextButton, PopoverBody, Text } from '../ui';
import { DownloadRow } from './DownloadRow';

/**
 * Recent downloads under their button, as Ardia draws them: "Recent
 * downloads" with Clear, the files, and "View all downloads" for the rest.
 */
export function DownloadsPopover() {
  const actions = useActions();
  const { downloads } = useSnapshot();
  const recent = downloads.slice(0, 8);
  const clearable = downloads.some(d => d.state !== 'progress');
  return <>
    <MenuSection title="Recent downloads" trailing={clearable ? <MenuTextButton label="Clear" onPress={() => void actions.clearDownloads()} /> : undefined} />
    {!recent.length && <PopoverBody><Text variant="row" tone="textSecondary">No recent downloads</Text></PopoverBody>}
    {recent.map(d => <DownloadRow key={d.id} download={d} onAction={a => void actions.downloadAction(d.id, a)}
      onMenu={() => void actions.downloadMenu(d.id)} />)}
    <MenuSeparator />
    <MenuFooter label="View all downloads" onPress={() => actions.openPanel('downloads')} />
  </>;
}
