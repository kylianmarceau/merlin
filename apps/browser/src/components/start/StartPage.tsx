import React, { useEffect, useRef } from 'react';
import { Image, Animated, ScrollView, TextInput, View } from 'react-native';
import { displayHost, isStartUrl } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { Button, Icon, Panel, PopupRow, Text, font, geometry, opacity, radius, space, AreaLight, useEscape, useInteraction, useSettle, useTheme, Pressable } from '../ui';
import { Favicon } from '../favicon/Favicon';
import { suggestionDetail, suggestionIcons, useSearch } from '../omnibox/useSearch';

/**
 * The falcon is centered above the search card. Its terminal prompt is the Go button.
 */
export function StartPage({ tab }: { tab: Tab }) {
  const snapshot = useSnapshot();
  const actions = useActions();
  const { colors, dark, reduceMotion } = useTheme();
  // As in Dia, the search card settles in on a soft spring over a slowly breathing light in the workspace colour.
  const settle = useSettle(reduceMotion);
  const search = useSearch();
  const input = useRef<TextInput>(null);
  // Chromium asks for the address to be focused as a new tab opens; on the
  // start page that is this field.
  const focusRequest = useBrowser(s => s.addressFocus);
  useEffect(() => { input.current?.focus(); }, [focusRequest]);
  const others = snapshot.tabs.filter(t => t.id !== tab.id && !isStartUrl(t.url)).slice(0, 3);
  const ready = search.typing;
  const go = () => { search.submit(false); };
  const escape = useEscape(() => { if (actions.escapePopover()) return; search.reset(); input.current?.blur(); });
  return <View style={{ flex: 1, backgroundColor: colors.startBackground }}>
    <AreaLight style={{ position: 'absolute', top: geometry.newTabTop, left: 0, right: 0, height: geometry.areaLight }} />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingTop: geometry.newTabTop,
      paddingBottom: space.huge, paddingHorizontal: space.huge }}>
      <Image source={dark ? require('./merlin-logo-light.png') : require('./merlin-logo.png')} accessible={false} resizeMode="contain"
        style={{ width: geometry.startFalcon, height: geometry.startFalcon, marginBottom: space.md }} />
      <View style={{ width: geometry.palette, maxWidth: '100%' }}>
        <Animated.View style={{ opacity: settle.opacity, transform: [{ scale: settle.scale }] }}>
        <Panel fill="contentBackground" radius="popover" border="borderSubtle" elevation="card">
          <View style={{ paddingTop: space.sm, paddingHorizontal: space.sm + space.hair, paddingBottom: space.sm + space.hair }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, height: geometry.newTabInput, paddingHorizontal: space.sm }}>
              <Icon name="magnifyingglass" tone="iconSecondary" />
              <TextInput ref={input} autoFocus blurOnSubmit={false} enableFocusRing={false} accessibilityLabel="Search or enter an address"
                placeholder="Search or enter an address" placeholderTextColor={colors.textTertiary} selectionColor={colors.textSelection} cursorColor={colors.textPrimary}
                value={search.text} onChangeText={search.change} onSubmitEditing={go}
                keyDownEvents={[{ key: 'ArrowDown' }, { key: 'ArrowUp' }, { key: 'Escape' }]}
                onKeyDown={e => {
                  const key = e.nativeEvent.key;
                  if (key === 'ArrowDown') search.move(1);
                  else if (key === 'ArrowUp') search.move(-1);
                  else if (key === 'Escape') escape();
                }}
                onKeyPress={e => { if (e.nativeEvent.key === 'Escape') escape(); }}
                style={{ flex: 1, color: colors.textPrimary, fontFamily: font.family, fontSize: font.size.input }} />
            </View>
            {search.suggestions.length > 0 && <View style={{ gap: space.hair, paddingBottom: space.sm }}>
              {search.suggestions.map((item, index) => <PopupRow key={index} title={item.title || item.url}
                detail={suggestionDetail(item, displayHost(item.url))}
                leading={<Icon name={suggestionIcons[item.kind]} tone={search.selected === index ? 'paletteSelectedText' : 'iconSecondary'} size="small" />}
                selected={search.selected === index} disabled={search.stale} onPress={() => search.open(index, false)} />)}
            </View>}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair }}>
              <Button label="Jump to a tab or file" icon="plus" size="small" onPress={() => void actions.command('palette menu')} />
              <View style={{ flex: 1 }} />
              <GoButton ready={ready} onPress={go} />
            </View>
          </View>
        </Panel>
        </Animated.View>
      </View>
      {snapshot.private
        ? <View style={{ marginTop: space.lg + space.sm }}>
          <Text variant="label" weight="regular" tone="textSecondary" align="center">
            Private window. Its history, cookies and site data go when you close the last private window.
            Downloads and bookmarks you save stay.
          </Text>
        </View>
        : !!others.length && <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center',
          columnGap: space.xs, rowGap: space.xs, marginTop: space.lg + space.sm, maxWidth: geometry.palette }}>
          <Text variant="label" weight="regular" tone="textSecondary" style={{ marginRight: space.xs }}>Open in this window</Text>
          {others.map(t => <PageLink key={t.id} tab={t} onPress={() => void actions.activateTab(t.id)} />)}
        </View>}
    </ScrollView>
  </View>;
}

/** The round Go button: quiet until there is something to go to. */
export function GoButton({ ready, onPress }: { ready: boolean; onPress(): void }) {
  const { colors, dark } = useTheme();
  const lightPrompt = ready ? !dark : dark;
  return <Pressable accessibilityRole="button" accessibilityLabel="Go" accessibilityState={{ disabled: !ready }} disabled={!ready}
    onPress={onPress}
    style={({ pressed }) => ({ width: geometry.button + space.xs, height: geometry.button + space.xs, borderRadius: radius.pill,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors[ready ? 'buttonPrimary' : 'fillControl'],
      opacity: pressed ? opacity.pressed : 1 })}>
    <Image source={lightPrompt ? require('./merlin-prompt-light.png') : require('./merlin-prompt.png')} accessible={false} resizeMode="contain"
      style={{ width: geometry.startPrompt, height: geometry.startPrompt, opacity: ready ? 1 : opacity.dim }} />
  </Pressable>;
}

/**
 * One of the window's other pages: its icon and title on a soft pill of its
 * own, so neighbours never run together; a long title shrinks to fit the
 * pill and ends in an ellipsis.
 */
function PageLink({ tab, onPress }: { tab: Tab; onPress(): void }) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel={tab.title || tab.url} onPress={onPress} {...handlers}
    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair, maxWidth: geometry.pageLinkMax,
      height: geometry.control, paddingHorizontal: space.sm + space.hair, borderRadius: radius.pill,
      backgroundColor: colors[pressed ? 'fillPressed' : hovered ? 'fillHover' : 'fillTransparent'] })}>
    <Favicon tab={tab} />
    <Text variant="label" weight="regular" tone={hovered ? 'textPrimary' : 'tabText'} lines={1} style={{ flexShrink: 1 }}>
      {tab.title || tab.url}</Text>
  </Pressable>;
}
