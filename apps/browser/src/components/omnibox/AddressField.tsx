import React, { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { displayAddress, displayHost, isStartUrl } from '../../lib/format';
import { useActions, useActiveTab, useBrowser } from '../../state/window';
import { IconButton, Text, duration, useTheme, font, geometry, radius, space } from '../ui';

/**
 * The address and search field. Chromium's address-bar engine suggests as the
 * person types; Enter opens the highlighted suggestion, or the top one when
 * the field still shows its completion, exactly as Chromium's own field does.
 */
export function AddressField() {
  const { colors } = useTheme();
  const actions = useActions();
  const tab = useActiveTab();
  const focusRequest = useBrowser(s => s.addressFocus);
  const revertRequest = useBrowser(s => s.addressRevert);
  const omnibox = useBrowser(s => s.omnibox);
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [text, setText] = useState('');
  const deleting = useRef(false);
  const input = useRef<TextInput>(null);
  const frame = useRef<View>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = tab?.url ?? '';
  const start = isStartUrl(url);

  const begin = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    const full = start ? '' : url;
    setEditing(true); setText(full);
    requestAnimationFrame(() => input.current?.setNativeProps({ selection: { start: 0, end: full.length } }));
  };
  const finish = () => {
    setEditing(false);
    // Let a click on a suggestion land before the list goes away.
    blurTimer.current = setTimeout(() => actions.stopSuggesting(), duration.base);
  };
  useEffect(() => { if (focusRequest) input.current?.focus(); }, [focusRequest]);
  useEffect(() => { if (revertRequest) { setEditing(false); input.current?.blur(); } }, [revertRequest]);
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);

  const top = omnibox?.items[0];
  const completion = editing && omnibox && omnibox.text === text && !deleting.current && top?.default && top.completion
    ? top.completion : '';
  const submit = (newTab = false) => {
    const value = text.trim();
    if (!value) return;
    if (omnibox && omnibox.selected >= 0) void actions.openSuggestion(omnibox.selected, newTab);
    else void actions.submitAddress(text + completion, newTab);
    input.current?.blur();
  };
  const security = start ? 'start' : url.startsWith('https:') ? 'secure' : url.startsWith('http:') ? 'insecure' : 'internal';
  const measure = () => frame.current?.measureInWindow((x, y, width, height) => actions.setAnchor('address', { x, y, width, height }));

  return <View ref={frame} onLayout={measure} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs, height: geometry.control + space.xs,
      paddingLeft: space.hair, paddingRight: space.sm, borderRadius: radius.field,
      backgroundColor: colors[editing ? 'omniboxActive' : hovered ? 'omniboxHover' : 'omniboxIdle'],
      borderWidth: geometry.hairline, borderColor: colors[editing ? 'borderFocus' : 'fillTransparent'] }}>
    <IconButton label={security === 'secure' ? 'Connection is secure. Show site information' : 'Show site information'}
      icon={security === 'secure' ? 'lock' : security === 'insecure' ? 'exclamationmark.triangle' : security === 'start' ? 'magnifyingglass' : 'info.circle'}
      tone={security === 'insecure' ? 'siteInsecure' : 'siteSecure'} size="small" disabled={start}
      onFrame={f => actions.setAnchor('site', f)} onPress={() => void actions.siteInfo()} />
    <TextInput ref={input} accessibilityLabel="Address and search" placeholder="Search or enter an address"
      placeholderTextColor={colors.textTertiary} selectionColor={colors.accent}
      value={editing ? text : displayAddress(url)} onFocus={begin} onBlur={finish}
      onChangeText={next => {
        deleting.current = next.length < text.length;
        setText(next);
        actions.suggest(next, deleting.current);
      }}
      onSubmitEditing={() => submit(false)}
      keyDownEvents={[{ key: 'ArrowDown' }, { key: 'ArrowUp' }, { key: 'Escape' }, { key: 'Tab' }, { key: 'Enter', metaKey: true }]}
      onKeyDown={e => {
        const key = e.nativeEvent.key;
        if (key === 'ArrowDown') actions.moveSuggestion(1);
        else if (key === 'ArrowUp') actions.moveSuggestion(-1);
        else if (key === 'Tab' && completion) { setText(text + completion); actions.suggest(text + completion, false); }
        else if (key === 'Enter' && e.nativeEvent.metaKey) submit(true);
        else if (key === 'Escape') {
          if (omnibox) actions.stopSuggesting();
          else { setEditing(false); input.current?.blur(); }
        }
      }}
      style={{ flex: 1, alignSelf: 'stretch', color: colors[editing ? 'textPrimary' : 'textSecondary'], fontFamily: font.family,
        fontSize: font.size.body }} />
    {!!completion && top && <Text variant="caption" tone="omniboxCompletion" lines={1}>{`→ ${displayHost(top.url) || top.title}`}</Text>}
    {tab?.loading && !editing && <Text variant="caption" tone="textTertiary">Loading…</Text>}
  </View>;
}
