import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { displayHost } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions, useSnapshot } from '../../state/window';
import { Box, Button, Field, KeyCap, ListRow, Text, geometry, space } from '../ui';
import { Favicon } from '../favicon/Favicon';

/** What a new tab shows: a search field, shortcuts and the window's other tabs. */
export function StartPage({ tab }: { tab: Tab }) {
  const snapshot = useSnapshot();
  const actions = useActions();
  const [query, setQuery] = useState('');
  const others = snapshot.tabs.filter(t => t.id !== tab.id && t.url && t.url !== 'about:blank').slice(0, 6);
  const go = () => { if (query.trim()) void actions.openInTab(tab.id, query); };
  return <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space.huge, justifyContent: 'center', alignItems: 'center' }}>
    <View style={{ maxWidth: geometry.startColumn, width: '100%', gap: space.xl }}>
      <Box gap="sm">
        <Text variant="section">{snapshot.private ? 'Private browsing' : 'New tab'}</Text>
        <Text variant="display">Where to next?</Text>
        <Text tone="textSecondary">{snapshot.private ? 'Nothing from this window is saved after you close it.'
          : 'Search, open an address, or pick up a tab you left.'}</Text>
      </Box>
      <Field size="large" icon="magnifyingglass" autoFocus accessibilityLabel="Search or enter an address"
        placeholder="Search or enter an address" value={query} onChangeText={setQuery} onSubmitEditing={go}
        trailing={<KeyCap>↩</KeyCap>} />
      <Box row wrap gap="sm">
        <Button label="Bookmarks" icon="bookmark" onPress={() => actions.openPanel('bookmarks')} />
        <Button label="History" icon="clock" onPress={() => actions.openPanel('history')} />
        <Button label="Workspaces" icon="rectangle.stack" onPress={() => void actions.command('palette workspaces')} />
      </Box>
      {!!others.length && <Box gap="xs">
        <Box padX="sm"><Text variant="section">Open in this window</Text></Box>
        {others.map(t => <ListRow key={t.id} title={t.title || t.url} detail={displayHost(t.url)} leading={<Favicon tab={t} />}
          onPress={() => void actions.activateTab(t.id)} />)}
      </Box>}
      <Box row gap="md" align="center">
        <Box row gap="xs" align="center"><KeyCap>⌘L</KeyCap><Text variant="caption">Address</Text></Box>
        <Box row gap="xs" align="center"><KeyCap>⌘T</KeyCap><Text variant="caption">New tab</Text></Box>
      </Box>
    </View>
  </ScrollView>;
}
