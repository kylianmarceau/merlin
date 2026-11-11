import React, { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import type { EngineClient, FindState } from '@merlin/engine/protocol';
import { Button, Field, Label } from './components';
import { useTheme } from './Theme';
import { space } from './tokens';

export function FindBox({ find, tabId, engine, onError }: {
  find: FindState; tabId: string; engine: EngineClient; onError(message: string): void;
}) {
  const t = useTheme();
  const [text, setText] = useState(find.text);
  const field = useRef<TextInput>(null);
  useEffect(() => { setText(find.text); field.current?.focus(); }, [find.focus]);
  const query = (value: string, forward = true) => {
    void engine.call('find.query', { tabId, text: value, forward }).catch(e => onError(String(e)));
  };
  const close = () => void engine.call('find.close', {}).catch(e => onError(String(e)));
  const focus = (focused: boolean) => void engine.call('find.focus', { tabId, focused }).catch(e => onError(String(e)));
  return <View onKeyDown={event => { if (event.nativeEvent.key === 'Escape') { event.stopPropagation(); close(); } }}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md,
      paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: t.border }}>
    <Field ref={field} autoFocus blurOnSubmit={false} accessibilityLabel="Find in page" placeholder="Find in page" value={text} style={{ flex: 1 }}
      onFocus={() => focus(true)} onBlur={() => focus(false)}
      onChangeText={value => { setText(value); query(value); }} onSubmitEditing={() => query(text)} />
    <Label muted size="caption">{text ? `${find.ordinal} of ${find.matches}` : 'Search this page'}</Label>
    <Button title="Previous match" icon="arrow.up" iconOnly quiet disabled={!text || !find.matches} onPress={() => query(text, false)} />
    <Button title="Next match" icon="arrow.down" iconOnly quiet disabled={!text || !find.matches} onPress={() => query(text)} />
    <Button title="Close find" icon="xmark" iconOnly quiet onPress={close} />
  </View>;
}
