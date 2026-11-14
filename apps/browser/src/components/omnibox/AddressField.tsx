import React, { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { promptChipLabel, promptIcon } from '../../lib/prompts';
import { displayAddress, displayHost, isStartUrl } from '../../lib/format';
import { useActions, useActiveTab, useBrowser, useSnapshot } from '../../state/window';
import { Icon, IconButton, Text, duration, useEscape, useTheme, font, geometry, radius, space } from '../ui';

/**
 * The address and search field. Chromium's address-bar engine suggests as the
 * person types; Enter opens the highlighted suggestion, or the top one when
 * the field still shows its completion, exactly as Chromium's own field does.
 *
 * "shell" is the white pill at the top of the sidebar, showing just the site;
 * "toolbar" sits in the page card's toolbar and shows the path too.
 */
export function AddressField({ variant = 'toolbar', compact = false }: { variant?: 'toolbar' | 'shell'; compact?: boolean }) {
  const { colors } = useTheme();
  const snapshot = useSnapshot();
  const actions = useActions();
  const tab = useActiveTab();
  const focusRequest = useBrowser(s => s.addressFocus);
  const revertRequest = useBrowser(s => s.addressRevert);
  const omnibox = useBrowser(s => s.omnibox);
  const revealed = useBrowser(s => s.revealedPromptId);
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [text, setText] = useState('');
  const deleting = useRef(false);
  const input = useRef<TextInput>(null);
  const frame = useRef<View>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = tab?.url ?? '';
  const start = isStartUrl(url);
  const shell = variant === 'shell';
  const waiting = snapshot.prompt?.quiet && snapshot.prompt.id !== revealed ? snapshot.prompt : null;

  // macOS reports a click into the field as focus, blur, focus while its
  // editor takes over, so a blur only ends editing once it has settled.
  const editingNow = useRef(false);
  const startEditing = (value: string) => { editingNow.current = true; setEditing(true); setText(value); };
  const begin = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = null;
    if (editingNow.current && text !== (start ? '' : url)) return;
    const full = start ? '' : url;
    startEditing(full);
    // Select the address once the click that focused the field has finished.
    setTimeout(() => input.current?.setNativeProps({ selection: { start: 0, end: full.length } }), duration.fast);
  };
  const finish = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    // Let a click on a suggestion land before the list goes away.
    blurTimer.current = setTimeout(() => {
      blurTimer.current = null;
      editingNow.current = false;
      setEditing(false);
      actions.stopSuggesting();
    }, duration.base);
  };
  // A new-tab pop-up takes the focus request instead.
  const popupOpen = useBrowser(s => s.panel === 'newTab' || s.panel === 'location');
  // So does the start page's own field, on a start page.
  useEffect(() => { if (focusRequest && !popupOpen && !start) input.current?.focus(); }, [focusRequest]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (revertRequest) { editingNow.current = false; setEditing(false); input.current?.blur(); } }, [revertRequest]);
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);

  // Escape leaves the field: AppKit gives up the focus itself, and the
  // suggestions close and the site shows again.
  const escape = useEscape(() => {
    if (blurTimer.current) { clearTimeout(blurTimer.current); blurTimer.current = null; }
    editingNow.current = false; setEditing(false);
    actions.stopSuggesting();
  });

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
  // While not editing, the site reads first and the rest of the address stays quiet.
  const host = displayHost(url);
  const shown = displayAddress(url);
  const rest = shown.startsWith(host) ? shown.slice(host.length) : '';
  const label = shown.startsWith(host) ? host : shown;

  // The field looks the same with Glass as with Classic.
  const fill = shell
    ? colors[editing ? 'fillShellControlActive' : hovered ? 'fillShellControlActive' : 'fillShellControl']
    : colors[editing ? 'omniboxActive' : hovered ? 'omniboxHover' : 'omniboxIdle'];
  return <View ref={frame} onLayout={measure} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    style={{ flex: shell ? undefined : 1, flexDirection: 'row', alignItems: 'center', gap: space.xs,
      height: shell ? geometry.address : compact ? geometry.controlCompact : geometry.controlLarge, paddingLeft: space.md, paddingRight: space.xs,
      borderRadius: radius.field, backgroundColor: fill,
      borderWidth: geometry.hairline, borderColor: colors[editing && !shell ? 'borderDefault' : 'fillTransparent'] }}>
    {start && !editing && <Icon name="magnifyingglass" tone="iconSecondary" size="small" />}
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <TextInput ref={input} accessibilityLabel="Address and search" enableFocusRing={false}
        placeholder={editing || start ? 'Search or enter an address' : undefined}
        placeholderTextColor={colors.textSecondary} selectionColor={colors.textSelection} cursorColor={colors.textPrimary}
        value={editing ? text : ''} onFocus={begin} onBlur={finish}
        onChangeText={next => {
          // Typing always edits, even if the focus event went missing.
          if (!editingNow.current) { editingNow.current = true; setEditing(true); }
          if (blurTimer.current) { clearTimeout(blurTimer.current); blurTimer.current = null; }
          deleting.current = next.length < text.length;
          setText(next);
          actions.suggest(next, deleting.current);
        }}
        onSubmitEditing={() => submit(false)}
        keyDownEvents={[{ key: 'ArrowDown' }, { key: 'ArrowUp' }, { key: 'Tab' }, { key: 'Enter', metaKey: true }]}
        onKeyDown={e => {
          const key = e.nativeEvent.key;
          if (key === 'ArrowDown') actions.moveSuggestion(1);
          else if (key === 'ArrowUp') actions.moveSuggestion(-1);
          else if (key === 'Tab' && completion) { setText(text + completion); actions.suggest(text + completion, false); }
          else if (key === 'Enter' && e.nativeEvent.metaKey) submit(true);
        }}
        onKeyPress={e => { if (e.nativeEvent.key === 'Escape') escape(); }}
        style={{ color: colors.textPrimary, fontFamily: font.family, fontSize: font.size.body }} />
      {!editing && !start && <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        flexDirection: 'row', alignItems: 'center' }}>
        <Text weight="medium" lines={1} style={{ flexShrink: 0, maxWidth: '100%' }}>{label}</Text>
        {!shell && !!rest && <Text tone="textSecondary" lines={1} style={{ flexShrink: 1 }}>{rest}</Text>}
      </View>}
    </View>
    {!!completion && top && <Text variant="caption" tone="omniboxCompletion" lines={1}>{`→ ${displayHost(top.url) || top.title}`}</Text>}
    {tab?.loading && !editing && !shell && <Text variant="caption" tone="textTertiary">Loading…</Text>}
    {tab?.engine === 'webkit' && !editing && !shell && <Text variant="caption" tone="textTertiary">WebKit</Text>}
    {waiting && !editing && <Pressable accessibilityRole="button" accessibilityLabel={promptChipLabel(waiting)}
      accessibilityHint="Shows a request this page is waiting on" onPress={() => actions.revealPrompt(waiting.id)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, height: geometry.control - space.xs,
        paddingHorizontal: space.sm, borderRadius: radius.sm, backgroundColor: colors.accentSoft }}>
      <Icon name={promptIcon(waiting)} tone="accentSoftText" size="small" />
      <Text variant="caption" weight="semibold" tone="accentSoftText">{promptChipLabel(waiting)}</Text>
    </Pressable>}
    {!editing && !start && tab?.engine === 'webkit' && <IconButton label="Shown in WebKit. Show engine options" icon="safari"
      tone="siteSecure" size="small" onFrame={f => actions.setAnchor('site', f)} onPress={() => void actions.engineMenu()} />}
    {!editing && !start && tab?.engine !== 'webkit' && <IconButton label={security === 'secure' ? 'Connection is secure. Show site controls' : 'Show site controls'}
      icon={security === 'secure' ? 'lock' : security === 'insecure' ? 'exclamationmark.triangle' : 'info.circle'}
      tone={security === 'insecure' ? 'siteInsecure' : 'siteSecure'} size="small"
      onFrame={f => actions.setAnchor('site', f)} onPress={() => void actions.siteInfo()} />}
  </View>;
}
