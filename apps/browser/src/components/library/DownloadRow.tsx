import React from 'react';
import { View } from 'react-native';
import { percent } from '../../lib/format';
import type { Download, DownloadAction } from '../../state/types';
import { Icon, PopoverRow, ProgressTrack, RoundButton, Text, geometry, radius, space, useTheme } from '../ui';

export function downloadStatus(d: Download) {
  return d.status ?? (d.state === 'complete' ? 'done' : d.state === 'interrupted' ? 'failed' : d.state);
}

/** A document with its type on it, like the file's own icon in Finder. */
export function FileIcon({ name, warning = false }: { name: string; warning?: boolean }) {
  const { colors } = useTheme();
  const ext = (/\.([a-z0-9]{1,4})$/i.exec(name)?.[1] ?? '').toUpperCase();
  return <View style={{ width: geometry.fileWidth, height: geometry.fileHeight, borderRadius: radius.xs, alignItems: 'center',
    justifyContent: 'flex-end', paddingBottom: space.xs, backgroundColor: colors.contentBackground,
    borderWidth: geometry.hairline, borderColor: colors.borderDefault }}>
    <View style={{ position: 'absolute', top: -geometry.hairline, right: -geometry.hairline, width: geometry.fileFold,
      height: geometry.fileFold, borderBottomLeftRadius: radius.xs, backgroundColor: colors.fillField,
      borderLeftWidth: geometry.hairline, borderBottomWidth: geometry.hairline, borderColor: colors.borderDefault }} />
    {warning ? <Icon name="exclamationmark.triangle" tone="danger" size="small" />
      : !!ext && <Text variant="micro" weight="bold" tone={ext === 'PDF' ? 'textDanger' : 'textTertiary'}>{ext}</Text>}
  </View>;
}

/**
 * One download, as in the downloads panel: the file, a progress bar while it
 * arrives, what is happening, and round buttons for what can be done.
 */
export function DownloadRow({ download: d, onAction }: { download: Download; onAction(action: DownloadAction): void }) {
  const status = downloadStatus(d);
  const value = percent(d.received, d.total);
  const running = status === 'progress' || status === 'paused';
  const detail = d.detail || (status === 'progress' && value !== null ? `${value}%` : status === 'done' ? 'Done' : status);
  return <PopoverRow title={d.name || 'Download'} detail={detail}
    titleTone={status === 'failed' || status === 'dangerous' ? 'textDanger' : 'textPrimary'}
    leading={<FileIcon name={d.name} warning={status === 'dangerous'} />}
    onPress={status === 'done' ? () => onAction('open') : undefined}
    accessibilityLabel={status === 'done' ? `Open ${d.name}` : d.name}
    trailing={<View style={{ flexDirection: 'row', gap: space.xs + space.hair }}>
      {running && <RoundButton label={status === 'paused' ? 'Resume' : 'Pause'} icon={status === 'paused' ? 'play' : 'pause'}
        onPress={() => onAction('pause')} />}
      {running && <RoundButton label="Cancel" icon="xmark" onPress={() => onAction('cancel')} />}
      {status === 'done' && <RoundButton label="Show in Finder" icon="magnifyingglass" onPress={() => onAction('show')} />}
      {(status === 'failed' || status === 'cancelled') && <RoundButton label="Retry" icon="arrow.clockwise" onPress={() => onAction('retry')} />}
      {status === 'dangerous' && <RoundButton label="Discard" icon="trash" onPress={() => onAction('discard')} />}
      {!running && status !== 'dangerous' && <RoundButton label="Remove from list" icon="xmark" soft onPress={() => onAction('forget')} />}
    </View>}>
    {running && <View style={{ marginTop: space.xs + space.hair, marginBottom: space.hair }}><ProgressTrack value={value} /></View>}
  </PopoverRow>;
}
