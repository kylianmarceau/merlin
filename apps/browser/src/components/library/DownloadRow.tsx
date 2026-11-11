import React from 'react';
import { View } from 'react-native';
import { percent } from '../../lib/format';
import type { Download, DownloadAction } from '../../state/types';
import { Box, IconButton, IconTile, ListRow, ProgressTrack } from '../ui';

export function downloadStatus(d: Download) {
  return d.status ?? (d.state === 'complete' ? 'done' : d.state === 'interrupted' ? 'failed' : d.state);
}

/** One download: open it when done, pause, resume or retry while it runs. */
export function DownloadRow({ download: d, onAction }: { download: Download; onAction(action: DownloadAction): void }) {
  const status = downloadStatus(d);
  const value = percent(d.received, d.total);
  const running = status === 'progress' || status === 'paused';
  const detail = d.detail || (status === 'progress' && value !== null ? `${value}%` : status);
  return <Box>
    <ListRow title={d.name || 'Download'} detail={detail} tall
      leading={<IconTile icon={status === 'dangerous' ? 'exclamationmark.triangle' : 'doc.text'}
        tone={status === 'dangerous' || status === 'failed' ? 'danger' : 'iconSecondary'} />}
      onPress={status === 'done' ? () => onAction('open') : undefined}
      trailing={<View style={{ flexDirection: 'row' }}>
        {running && <IconButton label={status === 'paused' ? 'Resume' : 'Pause'} icon={status === 'paused' ? 'play' : 'pause'}
          size="small" onPress={() => onAction('pause')} />}
        {running && <IconButton label="Cancel" icon="xmark" size="small" onPress={() => onAction('cancel')} />}
        {status === 'done' && <IconButton label="Show in Finder" icon="folder" size="small" onPress={() => onAction('show')} />}
        {(status === 'failed' || status === 'cancelled') && <IconButton label="Retry" icon="arrow.clockwise" size="small" onPress={() => onAction('retry')} />}
        {status === 'dangerous' && <IconButton label="Discard" icon="trash" size="small" tone="textDanger" onPress={() => onAction('discard')} />}
        {!running && status !== 'dangerous' && <IconButton label="Remove from list" icon="trash" size="small" onPress={() => onAction('forget')} />}
      </View>} />
    {running && <Box padX="sm" padBottom="xs"><ProgressTrack value={value} /></Box>}
  </Box>;
}
