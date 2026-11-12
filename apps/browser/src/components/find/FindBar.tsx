import React, { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import type { FindState } from '../../state/types';
import { useActions } from '../../state/window';
import { Panel, RoundButton, Text, duration, font, geometry, space, useEscape, useTheme } from '../ui';

/** Find in page: a glass capsule at the top right of the page. */
export function FindBar({ find, tabId }: { find: FindState; tabId: string }) {
  const actions = useActions();
  const { colors } = useTheme();
  const [text, setText] = useState(find.text);
  const field = useRef<TextInput>(null);
  // Each Command-F focuses the field with the last search selected, so typing replaces it.
  useEffect(() => {
    setText(find.text); field.current?.focus();
    const timer = setTimeout(() => field.current?.setNativeProps({ selection: { start: 0, end: find.text.length } }), duration.fast);
    return () => clearTimeout(timer);
  }, [find.focus]);  // eslint-disable-line react-hooks/exhaustive-deps
  const escape = useEscape(() => void actions.findClose());
  const query = (value: string, forward = true) => void actions.findQuery(tabId, value, forward);
  return <View pointerEvents="box-none" style={{ position: 'absolute', top: space.md, right: space.lg, width: geometry.findBar }}>
    <Panel glass radius="pill" elevation="popover" accessibilityLabel="Find in page">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair, minHeight: geometry.controlLarge + space.sm,
        paddingLeft: space.lg, paddingRight: space.sm }}>
        <TextInput ref={field} autoFocus blurOnSubmit={false} enableFocusRing={false} accessibilityLabel="Find in page" placeholder="Find in page" value={text}
          placeholderTextColor={colors.textSecondary} selectionColor={colors.textSelection}
          style={{ flex: 1, color: colors.textPrimary, fontFamily: font.family, fontSize: font.size.callout,
            fontWeight: font.weight.medium }}
          keyDownEvents={[{ key: 'Escape' }]} onKeyDown={e => { if (e.nativeEvent.key === 'Escape') escape(); }}
          onKeyPress={e => { if (e.nativeEvent.key === 'Escape') escape(); }}
          onFocus={() => void actions.findFocus(tabId, true)} onBlur={() => void actions.findFocus(tabId, false)}
          onChangeText={value => { setText(value); query(value); }} onSubmitEditing={() => query(text)} />
        {!!text && <Text variant="label" weight="regular" tone="textSecondary">
          {find.matches ? `${find.ordinal} of ${find.matches}` : 'No matches'}</Text>}
        <RoundButton label="Previous match" icon="chevron.up" soft disabled={!text || !find.matches} onPress={() => query(text, false)} />
        <RoundButton label="Next match" icon="chevron.down" soft disabled={!text || !find.matches} onPress={() => query(text)} />
        <RoundButton label="Close find" icon="xmark" onPress={() => void actions.findClose()} />
      </View>
    </Panel>
  </View>;
}
