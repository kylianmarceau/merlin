import React, { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, TextInput, View } from 'react-native';
import type { CommandPalette } from '../../state/types';
import { useActions } from '../../state/window';
import { Box, Field, KeyCap, MenuRow, Panel, Text, geometry, presenceStyle, space, useLatest, usePresence, useTheme } from '../ui';

/**
 * Merlin's command menu: tabs, workspaces and commands from the native
 * controller. It drops from the top of the window like Spotlight and does not
 * dim the page.
 */
export function CommandMenu({ palette, open }: { palette: CommandPalette | null; open: boolean }) {
  const { reduceMotion } = useTheme();
  const { mounted, progress } = usePresence(open && !!palette, 'popover', reduceMotion);
  const last = useLatest(palette);
  if (!mounted || !last) return null;
  return <View pointerEvents="box-none" style={{ position: 'absolute', top: geometry.toolbar + space.md, left: 0, right: 0, alignItems: 'center' }}>
    <Animated.View style={[{ width: geometry.palette, maxWidth: '90%' }, presenceStyle(progress, 'popover')]}>
      <Panel fill="surfacePopover" radius="panel" elevation="dialog" accessibilityLabel={last.prompt || 'Commands'}>
        <Menu palette={last} />
      </Panel>
    </Animated.View>
  </View>;
}

function Menu({ palette }: { palette: CommandPalette }) {
  const actions = useActions();
  const [text, setText] = useState(palette.text);
  const editGeneration = useRef(0);
  const draft = useRef<string | null>(null);
  const input = useRef<TextInput>(null);
  const list = useRef<ScrollView>(null);
  // An acknowledgement can arrive before the native snapshot echoes the text.
  // Keep the local draft until it does, so older results never replace typing.
  useEffect(() => {
    if (draft.current === null) setText(palette.text);
    else if (palette.text === draft.current) draft.current = null;
  }, [palette.text]);
  useEffect(() => { draft.current = null; setText(palette.text); }, [palette.prompt, palette.placeholder]);
  useEffect(() => {
    list.current?.scrollTo({ y: Math.max(0, palette.selected - 3) * geometry.rowTall, animated: false });
  }, [palette.selected]);
  return <Box pad="sm" gap="sm">
    <Field ref={input} autoFocus size="large" icon="command" blurOnSubmit={false} accessibilityLabel="Search commands"
      value={text} placeholder={palette.placeholder || palette.prompt}
      keyDownEvents={[{ key: 'ArrowDown' }, { key: 'ArrowUp' }, { key: 'Escape' }]}
      onKeyDown={e => {
        const key = e.nativeEvent.key;
        if (key === 'ArrowDown') void actions.paletteKey('next');
        else if (key === 'ArrowUp') void actions.paletteKey('previous');
        else if (key === 'Escape') void actions.paletteKey('cancel');
      }}
      onSubmitEditing={() => void actions.paletteKey('accept')}
      onChangeText={value => {
        setText(value); draft.current = value;
        const generation = ++editGeneration.current;
        actions.paletteText(value).catch(e => {
          if (generation === editGeneration.current) { draft.current = null; actions.notify(String(e)); }
        });
      }} />
    {!!palette.error && <Text tone="textDanger">{palette.error}</Text>}
    <ScrollView ref={list} style={{ maxHeight: geometry.sheetHeight * 0.6 }} contentContainerStyle={{ gap: space.hair }}>
      {palette.rows.map((row, index) => <View key={`${index}:${row.title}`} style={{ paddingLeft: Math.min(row.indent, 5) * space.md }}>
        <MenuRow label={row.title} detail={row.detail || undefined} selected={index === palette.selected}
          shortcut={row.keys || undefined} onPress={() => void actions.paletteSelect(index)} />
      </View>)}
      {!palette.rows.length && <Box pad="md"><Text tone="textSecondary">{palette.status || 'No matching commands'}</Text></Box>}
    </ScrollView>
    <Box row gap="md" align="center" padX="xs">
      <Box row gap="xs" align="center"><KeyCap>↑↓</KeyCap><Text variant="caption">Move</Text></Box>
      <Box row gap="xs" align="center"><KeyCap>↩</KeyCap><Text variant="caption">Open</Text></Box>
      <Box row gap="xs" align="center"><KeyCap>esc</KeyCap><Text variant="caption">Close</Text></Box>
    </Box>
  </Box>;
}
