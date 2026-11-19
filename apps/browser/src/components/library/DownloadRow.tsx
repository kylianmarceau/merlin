import React from 'react';
import { Image, View } from 'react-native';
import { downloadLine, percent } from '../../lib/format';
import { useFileIcon } from '../../state/fileIcons';
import type { Download, DownloadAction } from '../../state/types';
import { FileDragArea, Icon, MenuTextButton, PopoverRow, ProgressTrack, RowFill, geometry, opacity, rowState, space, useInteraction, type SymbolName, Pressable } from '../ui';

export function downloadStatus(d: Download) {
  return d.status ?? (d.state === 'complete' ? 'done' : d.state === 'interrupted' ? 'failed' : d.state);
}

/** The file's own Finder icon, by its type. */
export function FileIcon({ name, faded = false }: { name: string; faded?: boolean }) {
  const uri = useFileIcon(name, geometry.fileIcon);
  const side = { width: geometry.fileIcon, height: geometry.fileIcon };
  return <View style={[side, { alignItems: 'center', justifyContent: 'center', opacity: faded ? opacity.disabled : 1 }]}>
    {uri ? <Image source={{ uri }} style={side} /> : <Icon name="doc" tone="iconSecondary" size="regular" />}
  </View>;
}

/** A row's round action, drawn as Ardia draws them: a filled SF Symbol circle. */
function RowButton({ icon, label, onPress }: { icon: SymbolName; label: string; onPress(): void }) {
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} {...handlers}>
    {({ pressed }) => <View style={{ width: geometry.rowButton, height: geometry.rowButton, alignItems: 'center', justifyContent: 'center',
      opacity: pressed ? opacity.pressed : 1 }}>
      <RowFill state={rowState(hovered, false)} />
      <Icon name={icon} tone="iconPrimary" size="small" />
    </View>}
  </Pressable>;
}

/**
 * One download, as in Ardia's downloads panel: the file's icon, its name and
 * one quiet line (its size once done), a thin progress bar while it arrives.
 * Show in Finder appears on hover; everything else is in the right-click menu.
 * A finished file drags out of the row like a file in Finder.
 */
export const DownloadRow = React.memo(function DownloadRow({ download: d, onAction, onMenu }: {
  download: Download; onAction(action: DownloadAction): void; onMenu(): void;
}) {
  const status = downloadStatus(d);
  const value = percent(d.received, d.total);
  const running = status === 'progress' || status === 'paused';
  const removed = status === 'removed';
  const dangerous = status === 'dangerous';
  // A finished file can be dragged out to Finder, Mail or a page, as from Finder.
  return <FileDragArea path={status === 'done' ? d.path : undefined}><PopoverRow title={d.name || 'Preparing…'} detail={downloadLine(d)} strike={removed}
    titleTone={removed ? 'textSecondary' : status === 'failed' ? 'textDanger' : 'textPrimary'}
    detailTone={dangerous || status === 'failed' ? 'textDanger' : 'textSecondary'}
    leading={<FileIcon name={d.name} faded={removed} />}
    onPress={status === 'done' ? () => onAction('open') : undefined} onContextMenu={onMenu}
    accessibilityLabel={status === 'done' ? `Open ${d.name}` : d.name}
    trailing={dangerous ? <View style={{ marginRight: -space.sm }}>
      <MenuTextButton label="Discard" onPress={() => onAction('discard')} />
    </View> : running ? <View style={{ flexDirection: 'row' }}>
      <RowButton icon={status === 'paused' ? 'play.circle.fill' : 'pause.circle.fill'} label={status === 'paused' ? 'Resume' : 'Pause'}
        onPress={() => onAction('pause')} />
      <RowButton icon="xmark.circle.fill" label="Cancel" onPress={() => onAction('cancel')} />
    </View> : undefined}
    hoverTrailing={status === 'done' ? <RowButton icon="magnifyingglass.circle.fill" label="Show in Finder" onPress={() => onAction('show')} />
      : undefined}>
    {running && <View style={{ marginTop: space.xs, marginBottom: space.hair }}><ProgressTrack value={value} thin muted={status === 'paused'} /></View>}
  </PopoverRow></FileDragArea>;
});
