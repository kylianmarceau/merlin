import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, TextInput, View } from 'react-native';
import type { CommandPalette } from '../../state/types';
import { useActions } from '../../state/window';
import {
  Icon, KeyCap, Panel, Text, font, geometry, presenceStyle, radius, space, useEscape, useInteraction, useLatest, usePresence, useTheme,
} from '../ui';

/**
 * Merlin's command bar: tabs, workspaces and commands from the native
 * controller. It drops into the upper middle of the window over a light scrim,
 * like Spotlight; the highlighted row takes the workspace colour.
 */
export function CommandMenu({ palette, open }: { palette: CommandPalette | null; open: boolean }) {
  const { colors, reduceMotion } = useTheme();
  const actions = useActions();
  const { mounted, progress } = usePresence(open && !!palette, 'popover', reduceMotion);
  const last = useLatest(palette);
  if (!mounted || !last) return null;
  return <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center',
    paddingTop: geometry.toolbar + space.huge }}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: progress }}>
      <Pressable accessible={false} style={{ flex: 1, backgroundColor: colors.scrim }} onPress={() => void actions.paletteKey('cancel')} />
    </Animated.View>
    <Animated.View style={[{ width: geometry.palette, maxWidth: '90%' }, presenceStyle(progress, 'popover')]}>
      <Panel fill="surfacePalette" radius="popover" elevation="dialog" accessibilityLabel={last.prompt || 'Commands'}>
        <View style={{ borderRadius: radius.popover, overflow: 'hidden' }}><Menu palette={last} /></View>
      </Panel>
    </Animated.View>
  </View>;
}

function Menu({ palette }: { palette: CommandPalette }) {
  const actions = useActions();
  const { colors } = useTheme();
  const [text, setText] = useState(palette.text);
  const editGeneration = useRef(0);
  const draft = useRef<string | null>(null);
  const input = useRef<TextInput>(null);
  const list = useRef<ScrollView>(null);
  const escape = useEscape(() => void actions.paletteKey('cancel'));
  // An acknowledgement can arrive before the native snapshot echoes the text.
  // Keep the local draft until it does, so older results never replace typing.
  useEffect(() => {
    if (draft.current === null) setText(palette.text);
    else if (palette.text === draft.current) draft.current = null;
  }, [palette.text]);
  useEffect(() => { draft.current = null; setText(palette.text); }, [palette.prompt, palette.placeholder]);
  useEffect(() => {
    list.current?.scrollTo({ y: Math.max(0, palette.selected - 3) * geometry.paletteRow, animated: false });
  }, [palette.selected]);
  return <>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, height: geometry.paletteInput, paddingHorizontal: space.lg + space.xs,
      borderBottomWidth: geometry.hairline, borderBottomColor: colors.borderSubtle }}>
      <Icon name="magnifyingglass" tone="iconSecondary" size="large" weight="regular" />
      <TextInput ref={input} autoFocus blurOnSubmit={false} enableFocusRing={false} accessibilityLabel="Search commands"
        value={text} placeholder={palette.placeholder || palette.prompt} placeholderTextColor={colors.textTertiary}
        selectionColor={colors.textSelection}
        style={{ flex: 1, color: colors.textPrimary, fontFamily: font.family, fontSize: font.size.input }}
        keyDownEvents={[{ key: 'ArrowDown' }, { key: 'ArrowUp' }, { key: 'Escape' }]}
        onKeyDown={e => {
          const key = e.nativeEvent.key;
          if (key === 'ArrowDown') void actions.paletteKey('next');
          else if (key === 'ArrowUp') void actions.paletteKey('previous');
          else if (key === 'Escape') escape();
        }}
        onKeyPress={e => { if (e.nativeEvent.key === 'Escape') escape(); }}
        onSubmitEditing={() => void actions.paletteKey('accept')}
        onChangeText={value => {
          setText(value); draft.current = value;
          const generation = ++editGeneration.current;
          actions.paletteText(value).catch(e => {
            if (generation === editGeneration.current) { draft.current = null; actions.notify(String(e)); }
          });
        }} />
      {!!palette.prompt && !!palette.placeholder && <KeyCap>{palette.prompt}</KeyCap>}
    </View>
    {!!palette.error && <View style={{ paddingHorizontal: space.lg + space.xs, paddingTop: space.md }}>
      <Text tone="textDanger">{palette.error}</Text>
    </View>}
    <ScrollView ref={list} style={{ maxHeight: geometry.sheetHeight * 0.6 }} contentContainerStyle={{ padding: space.sm, gap: geometry.hairline }}>
      {palette.rows.map((row, index) => <View key={`${index}:${row.title}`} style={{ paddingLeft: Math.min(row.indent, 5) * space.md }}>
        <PaletteRow title={row.title} detail={row.detail} keys={row.keys} selected={index === palette.selected}
          onPress={() => void actions.paletteSelect(index)} />
      </View>)}
      {!palette.rows.length && <View style={{ padding: space.md }}>
        <Text tone="textSecondary">{palette.status || 'No matching commands'}</Text>
      </View>}
    </ScrollView>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg + space.hair, paddingHorizontal: space.lg + space.xs,
      paddingVertical: space.sm + space.hair, backgroundColor: colors.surfacePaletteFooter, borderTopWidth: geometry.hairline,
      borderTopColor: colors.borderSubtle }}>
      <Hint keys="↩" label="Open" />
      <Hint keys="↑↓" label="Move" />
      <View style={{ flex: 1 }} />
      <Hint keys="esc" label="Close" />
    </View>
  </>;
}

function PaletteRow({ title, detail, keys, selected, onPress }: {
  title: string; detail: string; keys: string; selected: boolean; onPress(): void;
}) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="menuitem" accessibilityLabel={title} accessibilityState={{ selected }} onPress={onPress} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: geometry.paletteRow, paddingHorizontal: space.md,
      borderRadius: radius.field, backgroundColor: colors[selected ? 'paletteSelected' : hovered ? 'fillHover' : 'fillTransparent'] }}>
    <Text lines={1} flex={1} tone={selected ? 'paletteSelectedText' : 'textPrimary'}>{title}</Text>
    {!!detail && <Text variant="label" weight="regular" lines={1} tone={selected ? 'paletteSelectedText' : 'textSecondary'}
      style={{ flexShrink: 1, opacity: selected ? 0.85 : 1 }}>{detail}</Text>}
    {!!keys && <KeyCap>{keys}</KeyCap>}
  </Pressable>;
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair }}>
    <Text variant="label" weight="semibold" tone="groupLabel">{keys}</Text>
    <Text variant="label" weight="regular" tone="textSecondary">{label}</Text>
  </View>;
}
