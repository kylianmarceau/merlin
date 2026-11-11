import React from 'react';
import { ScrollView, View } from 'react-native';
import { Symbol } from '@merlin/shell';
import type { PanelName, Snapshot, Tab } from '@merlin/engine/protocol';
import { Button, Label, Row } from './components';
import { useTheme } from './Theme';
import { geometry, space } from './tokens';

export function TabSidebar({ snapshot, onNew, onSelect, onClose, onActions, onCommands, onPanel }: {
  snapshot: Snapshot; onNew(): void; onSelect(id: string): void; onClose(id: string): void;
  onActions(id: string): void; onCommands(): void; onPanel(panel: PanelName): void;
}) {
  const downloading = snapshot.downloads.filter(d => d.state === 'progress').length;
  const t = useTheme();
  const pinned = snapshot.tabs.filter(tab => tab.pinned);
  const open = snapshot.tabs.filter(tab => !tab.pinned);
  const row = (tab: Tab) => <View key={tab.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
    <Symbol name={tab.audible ? 'speaker.wave.2' : tab.pinned ? 'pin.fill' : 'globe'} color={t.muted} size={13} />
    <View style={{ flex: 1 }}><Row title={tab.title || 'New tab'} selected={tab.id === snapshot.activeTabId}
      detail={tab.loading ? 'Loading…' : undefined} onPress={() => onSelect(tab.id)}
      trailing={<Button title={`Actions for ${tab.title || 'tab'}`} icon="ellipsis" iconOnly quiet compact onPress={() => onActions(tab.id)} />} /></View>
    {!tab.pinned && tab.id === snapshot.activeTabId && <Button title={`Close ${tab.title || 'tab'}`} icon="xmark" iconOnly quiet compact onPress={() => onClose(tab.id)} />}
  </View>;
  return <View style={{ width: geometry.sidebar, paddingHorizontal: space.md, paddingTop: 48, paddingBottom: space.md, gap: space.lg }}>
    <View style={{ paddingHorizontal: space.sm, paddingTop: space.md, gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Label size="title" style={{ flex: 1 }}>Merlin</Label>
        {!snapshot.private && <Button title="Profiles" icon="person.crop.circle" iconOnly quiet compact onPress={() => onPanel('profiles')} />}
      </View>
      <Label muted size="caption">{snapshot.private ? 'Private window' : 'Your workspace'}</Label>
    </View>
    <Button title="New tab" icon="plus" onPress={onNew} />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.xs }}>
      {!!pinned.length && <><Label muted size="caption">PINNED</Label>{pinned.map(row)}</>}
      <View style={{ paddingTop: pinned.length ? space.lg : 0, paddingBottom: space.xs }}>
        <Label muted size="caption">TABS · {open.length}</Label>
      </View>
      {open.map(row)}
    </ScrollView>
    <View style={{ gap: space.sm }}>
      <Button title="Commands" icon="command" onPress={onCommands} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button title="Library" icon="books.vertical" onPress={() => onPanel('history')} />
        <Button title={downloading ? `Downloads, ${downloading} in progress` : 'Downloads'} icon="arrow.down.circle" iconOnly
          emphasis={downloading ? 'primary' : 'normal'} onPress={() => onPanel('downloads')} />
        <Button title="Settings" icon="gearshape" iconOnly onPress={() => onPanel('settings')} />
      </View>
    </View>
  </View>;
}
