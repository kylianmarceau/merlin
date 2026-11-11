import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import type { CommandPalette, EngineClient } from '@merlin/engine/protocol';
import { Button, Dialog, Field, Label, Row } from './components';
import { space } from './tokens';

export function CommandMenu({ palette, revision, engine, onError }: {
  palette: CommandPalette; revision: number; engine: EngineClient; onError(message: string): void;
}) {
  const [text, setText] = useState(palette.text);
  const editGeneration = useRef(0);
  const draft = useRef<string | null>(null);
  const input = useRef<TextInput>(null);
  const list = useRef<ScrollView>(null);
  // A promise acknowledgement may precede the coalesced native snapshot. Keep
  // the local draft until that snapshot echoes it, so an older result cannot
  // replace freshly typed characters.
  useEffect(() => {
    if (draft.current === null) setText(palette.text);
    else if (palette.text === draft.current) draft.current = null;
  }, [palette.text]);
  useEffect(() => { draft.current = null; setText(palette.text); }, [palette.prompt, palette.placeholder]);
  useEffect(() => { list.current?.scrollTo({ y: Math.max(0, palette.selected - 3) * 48, animated: false }); }, [palette.selected]);
  const key = async (value: 'accept' | 'cancel' | 'next' | 'previous') => {
    try { await engine.call('modal.palette.key', { key: value }); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  return <Dialog title={palette.prompt || 'Commands'} onClose={() => void key('cancel')} width={560}
    subtitle="Find a tab, open a workspace, or run a command.">
    <View onKeyDown={event => {
      if (event.nativeEvent.key === 'ArrowDown') { event.stopPropagation(); void key('next'); }
      if (event.nativeEvent.key === 'ArrowUp') { event.stopPropagation(); void key('previous'); }
    }}>
      <Field ref={input} autoFocus blurOnSubmit={false} accessibilityLabel="Search commands" value={text} placeholder={palette.placeholder}
        onSubmitEditing={() => void key('accept')} onChangeText={value => {
          setText(value); draft.current = value;
          const generation = ++editGeneration.current;
          void engine.call('modal.palette.text', { text: value }).catch(e => {
            if (generation === editGeneration.current) { draft.current = null; onError(String(e)); }
          });
        }} />
    </View>
    {!!palette.error && <Label>{palette.error}</Label>}
    <ScrollView ref={list} style={{ maxHeight: 390 }} contentContainerStyle={{ gap: space.xs }}>
      {palette.rows.map((row, index) => <View key={`${index}:${row.title}`} style={{ paddingLeft: Math.min(row.indent, 5) * space.md }}>
        <Row title={row.title} detail={row.detail} selected={index === palette.selected}
          onPress={() => void engine.call('modal.palette.select', { index, revision }).catch(e => onError(String(e)))}
          trailing={row.keys ? <Label muted size="caption">{row.keys}</Label> : undefined} />
      </View>)}
      {!palette.rows.length && <Label muted>{palette.status || 'No matching commands'}</Label>}
    </ScrollView>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Label muted size="caption">↑ ↓ to move · Return to open · Esc to close</Label>
      <Button title="Open" compact disabled={palette.selected < 0 && !text.trim()} onPress={() => void key('accept')} />
    </View>
  </Dialog>;
}
