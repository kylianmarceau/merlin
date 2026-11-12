import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions, useSnapshot } from '../../state/window';
import { Button, Icon, Panel, Text, font, geometry, opacity, radius, space, useInteraction, useTheme } from '../ui';
import { Favicon } from '../favicon/Favicon';
import { PaintMark } from './PaintMark';

/**
 * What a new tab shows: a mound of paint in the workspace colour, one search card and, under it, the
 * window's other pages. Quiet on purpose; the address is the point.
 */
export function StartPage({ tab }: { tab: Tab }) {
  const snapshot = useSnapshot();
  const actions = useActions();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const others = snapshot.tabs.filter(t => t.id !== tab.id && !isStartUrl(t.url)).slice(0, 3);
  const ready = !!query.trim();
  const go = () => { if (ready) void actions.openInTab(tab.id, query); };
  return <View style={{ flex: 1, backgroundColor: colors.startBackground }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingTop: geometry.newTabTop,
      paddingBottom: space.huge, paddingHorizontal: space.huge }}>
      <PaintMark />
      <View style={{ width: geometry.palette, maxWidth: '100%', marginTop: space.xl }}>
        <Panel fill="contentBackground" radius="popover" border="borderSubtle" elevation="card">
          <View style={{ paddingTop: space.sm, paddingHorizontal: space.sm + space.hair, paddingBottom: space.sm + space.hair }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, height: geometry.newTabInput, paddingHorizontal: space.sm }}>
              <Icon name="magnifyingglass" tone="iconSecondary" />
              <TextInput autoFocus enableFocusRing={false} accessibilityLabel="Search or enter an address" placeholder="Search or enter an address"
                placeholderTextColor={colors.textTertiary} selectionColor={colors.textSelection} value={query} onChangeText={setQuery}
                onSubmitEditing={go} style={{ flex: 1, color: colors.textPrimary, fontFamily: font.family, fontSize: font.size.input }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair }}>
              <Button label="Jump to a tab or file" icon="plus" size="small" onPress={() => void actions.command('palette menu')} />
              <View style={{ flex: 1 }} />
              <GoButton ready={ready} onPress={go} />
            </View>
          </View>
        </Panel>
      </View>
      {snapshot.private
        ? <View style={{ marginTop: space.lg + space.sm }}>
          <Text variant="label" weight="regular" tone="textSecondary" align="center">Private window. Nothing from it is kept after you close it.</Text>
        </View>
        : !!others.length && <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center',
          gap: space.md + space.hair, marginTop: space.lg + space.sm, maxWidth: geometry.palette }}>
          <Text variant="label" weight="regular" tone="textSecondary">Open in this window</Text>
          {others.map(t => <PageLink key={t.id} tab={t} onPress={() => void actions.activateTab(t.id)} />)}
        </View>}
    </ScrollView>
  </View>;
}

/** The round Go button: quiet until there is something to go to. */
export function GoButton({ ready, onPress }: { ready: boolean; onPress(): void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel="Go" accessibilityState={{ disabled: !ready }} disabled={!ready}
    onPress={onPress}
    style={({ pressed }) => ({ width: geometry.button + space.xs, height: geometry.button + space.xs, borderRadius: radius.pill,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors[ready ? 'buttonPrimary' : 'fillControl'],
      opacity: pressed ? opacity.pressed : 1 })}>
    <Icon name="arrow.up" tone={ready ? 'textOnPrimary' : 'iconSecondary'} size="small" weight="semibold" />
  </Pressable>;
}

function PageLink({ tab, onPress }: { tab: Tab; onPress(): void }) {
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel={tab.title || tab.url} onPress={onPress} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair, maxWidth: geometry.stripTab }}>
    <Favicon tab={tab} />
    <Text variant="label" weight="regular" tone={hovered ? 'textPrimary' : 'tabText'} lines={1}>{tab.title || tab.url}</Text>
  </Pressable>;
}
