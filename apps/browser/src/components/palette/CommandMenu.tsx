import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { CommandPalette } from '../../state/types';
import { useActions } from '../../state/window';
import { CenteredPopup, KeyCap, PopupField, PopupFooter, PopupRow, Text, geometry, space } from '../ui';

/**
 * Merlin's command bar (`:` and Command-K): tabs, workspaces and commands
 * from the native controller, in the same place and size as every other
 * centred pop-up. The highlighted row takes the workspace colour.
 */
export function CommandMenu({ palette, open }: { palette: CommandPalette | null; open: boolean }) {
  const actions = useActions();
  if (!open || !palette) return null;
  return <CenteredPopup label={palette.prompt || 'Commands'} onDismiss={() => void actions.paletteKey('cancel')}>
    <Menu palette={palette} />
  </CenteredPopup>;
}

function Menu({ palette }: { palette: CommandPalette }) {
  const actions = useActions();
  const [text, setText] = useState(palette.text);
  const editGeneration = useRef(0);
  const draft = useRef<string | null>(null);
  const list = useRef<ScrollView>(null);
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
    <PopupField value={text} label="Search commands" placeholder={palette.placeholder || palette.prompt}
      onEscape={() => void actions.paletteKey('cancel')} onSubmit={() => void actions.paletteKey('accept')}
      onKey={key => {
        if (key === 'down') void actions.paletteKey('next');
        else if (key === 'up') void actions.paletteKey('previous');
      }}
      onChangeText={value => {
        setText(value); draft.current = value;
        const generation = ++editGeneration.current;
        actions.paletteText(value).catch(e => {
          if (generation === editGeneration.current) { draft.current = null; actions.notify(String(e)); }
        });
      }}
      trailing={!!palette.prompt && !!palette.placeholder ? <KeyCap>{palette.prompt}</KeyCap> : undefined} />
    {!!palette.error && <View style={{ paddingHorizontal: space.lg + space.xs, paddingTop: space.md }}>
      <Text tone="textDanger">{palette.error}</Text>
    </View>}
    <ScrollView ref={list} style={{ maxHeight: geometry.popupList }} contentContainerStyle={{ padding: space.sm, gap: geometry.hairline }}>
      {palette.rows.map((row, index) => <View key={`${index}:${row.title}`} style={{ paddingLeft: Math.min(row.indent, 5) * space.md }}>
        <PopupRow title={row.title} detail={row.detail} keys={row.keys} selected={index === palette.selected}
          onPress={() => void actions.paletteSelect(index)} />
      </View>)}
      {!palette.rows.length && <View style={{ padding: space.md }}>
        <Text tone="textSecondary">{palette.status || 'No matching commands'}</Text>
      </View>}
    </ScrollView>
    <PopupFooter />
  </>;
}
