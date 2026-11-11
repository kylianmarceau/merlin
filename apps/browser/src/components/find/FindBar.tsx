import React, { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import type { FindState } from '../../state/types';
import { useActions } from '../../state/window';
import { Field, IconButton, Panel, Text, geometry, space } from '../ui';

/** Find in page, floating at the top right of the page. */
export function FindBar({ find, tabId }: { find: FindState; tabId: string }) {
  const actions = useActions();
  const [text, setText] = useState(find.text);
  const field = useRef<TextInput>(null);
  useEffect(() => { setText(find.text); field.current?.focus(); }, [find.focus]);  // eslint-disable-line react-hooks/exhaustive-deps
  const query = (value: string, forward = true) => void actions.findQuery(tabId, value, forward);
  return <View pointerEvents="box-none" style={{ position: 'absolute', top: space.sm, right: space.md, width: geometry.popoverWide }}>
    <Panel fill="surfacePopover" radius="card" elevation="popover">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, padding: space.xs }}>
        <View style={{ flex: 1 }}>
          <Field ref={field} autoFocus blurOnSubmit={false} icon="magnifyingglass" accessibilityLabel="Find in page"
            placeholder="Find in page" value={text}
            trailing={<Text variant="caption">{text ? `${find.ordinal}/${find.matches}` : ''}</Text>}
            keyDownEvents={[{ key: 'Escape' }]} onKeyDown={e => { if (e.nativeEvent.key === 'Escape') void actions.findClose(); }}
            onFocus={() => void actions.findFocus(tabId, true)} onBlur={() => void actions.findFocus(tabId, false)}
            onChangeText={value => { setText(value); query(value); }} onSubmitEditing={() => query(text)} />
        </View>
        <IconButton label="Previous match" icon="arrow.up" size="small" disabled={!text || !find.matches} onPress={() => query(text, false)} />
        <IconButton label="Next match" icon="arrow.down" size="small" disabled={!text || !find.matches} onPress={() => query(text)} />
        <IconButton label="Close find" icon="xmark" size="small" onPress={() => void actions.findClose()} />
      </View>
    </Panel>
  </View>;
}
