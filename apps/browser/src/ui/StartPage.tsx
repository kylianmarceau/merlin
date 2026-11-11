import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { Snapshot } from '@merlin/engine/protocol';
import { Button, Field, Label, Row } from './components';
import { useTheme } from './Theme';
import { radius, space } from './tokens';

export function StartPage({ snapshot, onOpen, onCommand, onPanel, onSelectTab }: {
  snapshot: Snapshot; onOpen(text: string): void; onCommand(command: string): void;
  onPanel(panel: 'history' | 'bookmarks'): void; onSelectTab(id: string): void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const tabs = snapshot.tabs.filter(tab => tab.id !== snapshot.activeTabId && tab.url !== 'about:blank').slice(0, 5);
  return <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 40, justifyContent: 'center', alignItems: 'center' }}>
    <View style={{ maxWidth: 600, width: '100%', gap: space.xl }}>
      <View style={{ gap: space.md }}>
        <Label muted size="caption">{snapshot.private ? 'PRIVATE BROWSING' : 'A LITTLE SPACE TO THINK'}</Label>
        <Label size="display" style={{ fontWeight: '600', letterSpacing: -0.8 }}>Where to next?</Label>
        <Label muted>{snapshot.private ? 'A fresh window, just for this session.' : 'Follow a thought. Find something new. Pick up where you left off.'}</Label>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Field style={{ flex: 1, minHeight: 44 }} accessibilityLabel="Search the web" placeholder="Search or enter an address"
          value={query} onChangeText={setQuery} onSubmitEditing={() => { if (query.trim()) onOpen(query); }} />
        <Button title="Go" icon="arrow.right" emphasis="primary" disabled={!query.trim()} onPress={() => onOpen(query)} />
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        <Button title="Bookmarks" icon="bookmark" onPress={() => onPanel('bookmarks')} />
        <Button title="History" icon="clock" onPress={() => onPanel('history')} />
        <Button title="Workspaces" icon="rectangle.stack" onPress={() => onCommand('palette workspaces')} />
      </View>
      {!!tabs.length && <View style={{ backgroundColor: t.inset, borderRadius: radius.panel, padding: space.lg, gap: space.sm }}>
        <Label muted size="caption">OPEN IN THIS WINDOW</Label>
        {tabs.map(tab => <Row key={tab.id} title={tab.title || tab.url} detail={tab.url} onPress={() => onSelectTab(tab.id)} />)}
      </View>}
      <Label muted size="caption">⌘ L to search · ⌘ T for a new tab</Label>
    </View>
  </ScrollView>;
}
