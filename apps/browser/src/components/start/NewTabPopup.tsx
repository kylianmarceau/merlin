import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, TextInput, View } from 'react-native';
import { displayHost, isStartUrl } from '../../lib/format';
import type { Suggestion, Tab } from '../../state/types';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import {
  Button, Icon, Panel, Text, font, geometry, presenceStyle, radius, space, useEscape, useInteraction, useLatest, usePresence, useTheme,
} from '../ui';
import { Favicon } from '../favicon/Favicon';

const icons = { search: 'magnifyingglass', url: 'globe', tab: 'square.on.square' } as const;

/**
 * A new tab as a pop-up (Settings > Appearance). It opens over the current
 * page, which stays visible under a light veil; the tab itself only opens
 * once there is somewhere to go. Before typing, it offers the window's other
 * pages; while typing, Chromium's suggestions.
 */
export function NewTabPopup({ open }: { open: boolean }) {
  const { colors, reduceMotion } = useTheme();
  const actions = useActions();
  const snapshot = useSnapshot();
  const { mounted, progress } = usePresence(open, 'popover', reduceMotion);
  const body = useLatest(open ? true : null);
  if (!mounted || !body) return null;
  const close = () => { if (open) { actions.stopSuggesting(); actions.closePanel(); } };
  // The veil and the pop-up cover the page card only; the tabs stay clear,
  // so the sidebar's "New tab…" row shows what is about to open.
  const tabs = !snapshot.modal.sidebarHidden;
  const side = tabs && snapshot.modal.tabLayout !== 'top';
  const page = !tabs ? { top: 0, left: 0, right: 0, bottom: 0 }
    : side ? { top: space.sm, left: geometry.sidebar, right: space.sm, bottom: space.sm }
    : { top: geometry.strip, left: space.sm, right: space.sm, bottom: space.sm };
  return <View pointerEvents="box-none" style={{ position: 'absolute', ...page, alignItems: 'center',
    paddingTop: geometry.toolbar + space.huge + space.lg }}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: progress,
      borderRadius: tabs ? radius.window : 0, overflow: 'hidden' }}>
      <Pressable accessible={false} style={{ flex: 1, backgroundColor: colors.newTabVeil }} onPress={close} />
    </Animated.View>
    <Animated.View style={[{ width: geometry.palette, maxWidth: '90%' }, presenceStyle(progress, 'popover')]}>
      <Panel fill="surfacePalette" radius="popover" elevation="dialog" accessibilityLabel="New tab" accessibilityViewIsModal>
        <View style={{ borderRadius: radius.popover, overflow: 'hidden' }}><Body onClose={close} /></View>
      </Panel>
    </Animated.View>
  </View>;
}

function Body({ onClose }: { onClose(): void }) {
  const { colors } = useTheme();
  const actions = useActions();
  const snapshot = useSnapshot();
  const omnibox = useBrowser(s => s.omnibox);
  const focusRequest = useBrowser(s => s.addressFocus);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState(0);
  const input = useRef<TextInput>(null);
  const deleting = useRef(false);
  // Chromium may also ask for the address to be focused as the tab opens.
  useEffect(() => { input.current?.focus(); }, [focusRequest]);

  const typing = !!text.trim();
  const pages = snapshot.tabs.filter(t => t.id !== snapshot.activeTabId && !isStartUrl(t.url)).slice(0, 4);
  const suggestions = typing && omnibox && omnibox.text === text ? omnibox.items : [];
  const selected = typing ? (omnibox?.selected ?? -1) : picked;
  const count = typing ? suggestions.length : pages.length;

  const finish = () => { actions.stopSuggesting(); actions.closePanel(); };
  const openPage = (tab: Tab) => { finish(); void actions.activateTab(tab.id); };
  // Each request reads the current suggestions, so it goes before they are cleared.
  const openSuggestion = (index: number) => { void actions.openSuggestion(index, true); actions.closePanel(); };
  const submit = () => {
    if (!typing) { if (pages[picked]) openPage(pages[picked]); return; }
    if (omnibox && omnibox.text === text && omnibox.selected >= 0) void actions.openSuggestion(omnibox.selected, true);
    else void actions.submitAddress(text, true);
    actions.closePanel();
  };
  const move = (step: 1 | -1) => {
    if (typing) actions.moveSuggestion(step);
    else if (count) setPicked(p => (p + step + count) % count);
  };
  const escape = useEscape(onClose);

  return <>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, height: geometry.newTabInput,
      paddingLeft: space.lg + space.xs, paddingRight: space.md }}>
      <Icon name="magnifyingglass" tone="iconSecondary" />
      <TextInput ref={input} autoFocus blurOnSubmit={false} enableFocusRing={false} accessibilityLabel="Search or enter an address"
        placeholder="Search or enter an address" placeholderTextColor={colors.textTertiary} selectionColor={colors.textSelection}
        value={text} onSubmitEditing={submit}
        onChangeText={next => {
          deleting.current = next.length < text.length;
          setText(next);
          if (next.trim()) actions.suggest(next, deleting.current); else actions.stopSuggesting();
        }}
        keyDownEvents={[{ key: 'ArrowDown' }, { key: 'ArrowUp' }, { key: 'Escape' }]}
        onKeyDown={e => {
          const key = e.nativeEvent.key;
          if (key === 'ArrowDown') move(1);
          else if (key === 'ArrowUp') move(-1);
          else if (key === 'Escape') escape();
        }}
        onKeyPress={e => { if (e.nativeEvent.key === 'Escape') escape(); }}
        style={{ flex: 1, color: colors.textPrimary, fontFamily: font.family, fontSize: font.size.input }} />
      <View style={{ paddingHorizontal: space.xs + space.hair, paddingVertical: space.hair, borderRadius: radius.sm,
        backgroundColor: colors.fillControl }}>
        <Text variant="caption" weight="semibold" tone="textSecondary">New tab</Text>
      </View>
    </View>
    {count > 0 && <View style={{ paddingHorizontal: space.sm, paddingBottom: space.xs }}>
      {typing
        ? suggestions.map((item: Suggestion, index) => <Row key={`${index}:${item.url}`} title={item.title || item.url}
          detail={item.kind === 'tab' ? 'Switch to tab' : item.kind === 'search' ? 'Search' : item.detail || displayHost(item.url) || undefined}
          leading={<Icon name={icons[item.kind]} tone="iconSecondary" size="small" />}
          selected={selected === index || (selected === -1 && index === 0 && !!item.default)} onPress={() => openSuggestion(index)} />)
        : pages.map((tab, index) => <Row key={tab.id} title={tab.title || tab.url} detail="Switch to tab"
          leading={<Favicon tab={tab} />} selected={selected === index} onPress={() => openPage(tab)} />)}
    </View>}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair, paddingHorizontal: space.md,
      paddingVertical: space.sm, borderTopWidth: geometry.hairline, borderTopColor: colors.borderSubtle }}>
      <Button label="Open a tab or file" icon="arrow.up.right" size="small"
        onPress={() => { finish(); void actions.command('palette menu'); }} />
      <View style={{ flex: 1 }} />
      <Button label="Go  ↩" variant="primary" size="small" disabled={!typing && !pages.length} onPress={submit} />
    </View>
  </>;
}

/** One place to go: the page or suggestion first, then what choosing it does. */
function Row({ title, detail, leading, selected, onPress }: {
  title: string; detail?: string; leading: React.ReactNode; selected: boolean; onPress(): void;
}) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel={detail ? `${title}, ${detail}` : title}
    accessibilityState={{ selected }} onPress={onPress} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, height: geometry.paletteRow - space.hair,
      paddingHorizontal: space.md, borderRadius: radius.field,
      backgroundColor: colors[selected ? 'fillSelected' : hovered ? 'fillHover' : 'fillTransparent'] }}>
    {leading}
    <Text lines={1} style={{ flexShrink: 1 }}>{title}</Text>
    {!!detail && <Text tone="textSecondary" lines={1} style={{ flexShrink: 0 }}>{`— ${detail}`}</Text>}
    <View style={{ flex: 1 }} />
    {selected && <Text variant="caption" weight="semibold" tone="textSecondary">↩</Text>}
  </Pressable>;
}
