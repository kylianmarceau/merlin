import React from 'react';
import { ScrollView, View } from 'react-native';
import { useAction, useActions, useRequest } from '../../state/window';
import { MenuFooter, MenuSection, MenuSeparator, Notice, PopoverBody, PopoverRow, Spinner, Text, Toggle, geometry } from '../ui';

/** Extensions for this page: run one, or switch it off. */
export function ExtensionsPopover() {
  const actions = useActions();
  const list = useRequest('extensions.list', {});
  const action = useAction();
  return <>
    <MenuSection title="Extensions" trailing={list.loading ? <Spinner /> : undefined} />
    {(list.error || action.error) && <PopoverBody><Notice tone="error">{list.error || action.error}</Notice></PopoverBody>}
    {list.data && !list.data.length && <PopoverBody>
      <Text tone="textSecondary">No extensions yet. Add them from the Chrome Web Store and they appear here.</Text>
    </PopoverBody>}
    <ScrollView style={{ maxHeight: geometry.sheetHeight / 2 }}>
      {list.data?.map(ext => <PopoverRow key={ext.id} title={ext.name}
        titleTone={ext.enabled ? 'textPrimary' : 'textSecondary'}
        detail={!ext.enabled ? 'Off' : ext.hasAction ? (ext.actionTitle || 'Run on this page') : 'Runs on its own'}
        onPress={ext.enabled && ext.hasAction ? () => void actions.runExtension(ext.id) : undefined}
        trailing={<View>
          <Toggle label={`${ext.name} enabled`} value={ext.enabled} disabled={!ext.canToggle || action.busy} onChange={async enabled => {
            if ((await action.run('extensions.setEnabled', { id: ext.id, enabled })) !== undefined) list.reload();
          }} />
        </View>} />)}
    </ScrollView>
    <MenuSeparator />
    <MenuFooter label="Manage extensions"
      onPress={() => void action.run('extensions.manage', {}).then(v => { if (v !== undefined) actions.closePopover(); })} />
  </>;
}
