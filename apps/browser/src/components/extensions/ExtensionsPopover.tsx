import React from 'react';
import { ScrollView, View } from 'react-native';
import { useAction, useActions, useRequest } from '../../state/window';
import { Box, Button, EmptyState, IconTile, ListRow, MenuSeparator, Notice, Spinner, Text, Toggle, geometry } from '../ui';

/** Extensions for this page: run one, or switch it off. */
export function ExtensionsPopover() {
  const actions = useActions();
  const list = useRequest('extensions.list', {});
  const action = useAction();
  return <Box gap="xs">
    <Box row align="center" padX="sm" padTop="xs" padBottom="xs">
      <Text variant="bodyStrong" flex={1}>Extensions</Text>
      {list.loading && <Spinner />}
    </Box>
    {(list.error || action.error) && <Notice tone="error">{list.error || action.error}</Notice>}
    {list.data && !list.data.length && <EmptyState icon="puzzlepiece.extension" title="No extensions yet"
      detail="Add extensions from the Chrome Web Store; they appear here." />}
    <ScrollView style={{ maxHeight: geometry.sheetHeight / 2 }}>
      {list.data?.map(ext => <ListRow key={ext.id} title={ext.name}
        detail={!ext.enabled ? 'Off' : ext.hasAction ? (ext.actionTitle || 'Run on this page') : 'Runs on its own'}
        leading={<IconTile icon="puzzlepiece.extension" tone={ext.enabled ? 'accent' : 'iconDisabled'} />}
        onPress={ext.enabled && ext.hasAction ? () => void actions.runExtension(ext.id) : undefined}
        trailing={<View style={{ paddingRight: geometry.splitGap }}>
          <Toggle label={`${ext.name} enabled`} value={ext.enabled} disabled={!ext.canToggle || action.busy} onChange={async enabled => {
            if ((await action.run('extensions.setEnabled', { id: ext.id, enabled })) !== undefined) list.reload();
          }} />
        </View>} />)}
    </ScrollView>
    <MenuSeparator />
    <Box row justify="flex-end" padX="xs" padBottom="xs">
      <Button label="Manage Extensions" variant="ghost" size="small" icon="gearshape"
        onPress={() => void action.run('extensions.manage', {}).then(v => { if (v !== undefined) actions.closePopover(); })} />
    </Box>
  </Box>;
}
