import React from 'react';
import { View } from 'react-native';
import type { Tab } from '@merlin/engine/protocol';
import { Button, Dialog, Label } from './components';
import { space } from './tokens';

export function TabActions({ tab, tabs, onClose, onPin, onMove, onDuplicate, onCloseTab }: {
  tab: Tab | undefined; tabs: Tab[]; onClose(): void; onPin(pinned: boolean): void;
  onMove(beforeId: string | null): void; onDuplicate(url: string): void; onCloseTab(): void;
}) {
  if (!tab) return <Dialog title="Tab closed" onClose={onClose}><Label muted>This tab is no longer open.</Label></Dialog>;
  const index = tabs.findIndex(t => t.id === tab.id);
  const previous = tabs[index - 1];
  const next = tabs[index + 1];
  return <Dialog title={tab.title || 'New tab'} subtitle={tab.url || 'A fresh tab'} onClose={onClose}>
    <Button title={tab.pinned ? 'Unpin tab' : 'Pin tab'} icon={tab.pinned ? 'pin.fill' : 'pin'} onPress={() => onPin(!tab.pinned)} />
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <Button title="Move up" icon="arrow.up" disabled={!previous || previous.pinned !== tab.pinned} onPress={() => onMove(previous.id)} />
      <Button title="Move down" icon="arrow.down" disabled={!next || next.pinned !== tab.pinned} onPress={() => onMove(tabs[index + 2]?.id ?? null)} />
    </View>
    <Button title="Open another copy" icon="plus" onPress={() => onDuplicate(tab.url || 'about:blank')} />
    <Button title="Close tab" icon="xmark" emphasis="danger" onPress={onCloseTab} />
  </Dialog>;
}
