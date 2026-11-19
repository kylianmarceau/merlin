import React, { useEffect, useRef, useState } from 'react';
import { Animated, TextInput, View } from 'react-native';
import { promptChipLabel, promptIcon } from '../../lib/prompts';
import { addressParts, displayHost, isStartUrl, leftToRight, pageTitle } from '../../lib/format';
import { securityBadge } from '../../lib/security';
import { currentSuggestions } from '../../state/store';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActions, useActiveTab, useBrowser, useSnapshot } from '../../state/window';
import { Icon, IconButton, LoadingBar, Text, duration, useEscape, usePop, useTheme, font, geometry, radius, space, Pressable } from '../ui';

/**
 * The address and search field. Chromium's address-bar engine suggests as the
 * person types; Enter opens the highlighted suggestion, or the top one when
 * the field still shows its completion, exactly as Chromium's own field does.
 *
 * "shell" is the white pill at the top of the sidebar, showing just the site;
 * "toolbar" sits in the page card's toolbar. At rest it reads as Dia's
 * breadcrumb, the site then the page's title; with the pointer on it, the
 * whole address and the page's actions (bookmark, copy link) show. A filled
 * bookmark says the page is already saved. With modal browsing, Insert mode
 * rings it in the accent. `listens` is false for a second field on screen
 * (the sidebar peeking over the page), which leaves focus requests alone.
 */
export function AddressField({ variant = 'toolbar', compact = false, listens = true }: {
  variant?: 'toolbar' | 'shell'; compact?: boolean; listens?: boolean;
}) {
  const { colors, reduceMotion } = useTheme();
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
    // Suggestions hang from whichever field is being typed in.
    measure();
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
  // Only requests made after it appeared: a field that mounts later (the peeking sidebar's) must not take the focus.
  const seenFocus = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === seenFocus.current) return;
    seenFocus.current = focusRequest;
    if (listens && !popupOpen && !start) input.current?.focus();
  }, [focusRequest]);  // eslint-disable-line react-hooks/exhaustive-deps
  const seenRevert = useRef(revertRequest);
  useEffect(() => {
    if (revertRequest === seenRevert.current) return;
    seenRevert.current = revertRequest;
    editingNow.current = false; setEditing(false); input.current?.blur();
  }, [revertRequest]);
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);

  // Escape leaves the field: AppKit gives up the focus itself, and the
  // suggestions close and the site shows again. An open popover closes too.
  const escape = useEscape(() => {
    actions.escapePopover();
    if (blurTimer.current) { clearTimeout(blurTimer.current); blurTimer.current = null; }
    editingNow.current = false; setEditing(false);
    actions.stopSuggesting();
  });

  const top = currentSuggestions(omnibox)[0];
  const completion = editing && omnibox && omnibox.text === text && !deleting.current && top?.default && top.completion
    ? top.completion : '';
  const submit = (newTab = false) => {
    const value = text.trim();
    if (!value) return;
    if (omnibox && omnibox.selected >= 0) void actions.openSuggestion(omnibox.selected, newTab);
    else void actions.submitAddress(text + completion, newTab);
    input.current?.blur();
  };
  // Chromium's security state, never the scheme: an https page whose
  // certificate error was clicked through is dangerous, not secure.
  const badge = securityBadge(tab?.security);
  const measure = () => frame.current?.measureInWindow((x, y, width, height) => actions.setAnchor('address', { x, y, width, height }));
  // While not editing, the site reads first and the rest of the address
  // stays quiet, as Chromium formats it: no user name, spoofed hosts in punycode.
  const { host: label, rest } = addressParts(tab ?? { url });
  // Dia's breadcrumb: "site / page title", until the pointer asks for the whole address.
  const title = pageTitle(tab?.title);
  const crumbTitle = title && title !== label && title !== tab?.displayUrl ? title : '';
  const crumb = !shell && !hovered && !!crumbTitle;
  const page = !!tab && !start && /^(https?|file):/i.test(url);
  const bookmarks = useShellPrefs(p => p.showBookmarks);
  const saved = usePop(!!tab?.bookmarked, reduceMotion, tab?.id);
  const insert = snapshot.modal.modalBrowsing !== false && snapshot.modal.mode === 'Insert';

  // The field looks the same with Glass as with Classic.
  const fill = shell
    ? colors[editing ? 'fillShellControlActive' : hovered ? 'fillShellControlActive' : 'fillShellControl']
    : colors[editing ? 'omniboxActive' : hovered ? 'omniboxHover' : 'omniboxIdle'];
  return <View ref={frame} onLayout={measure} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    style={{ flex: shell ? undefined : 1, flexDirection: 'row', alignItems: 'center', gap: space.xs,
      height: shell ? geometry.address : compact ? geometry.controlCompact : geometry.controlLarge, paddingLeft: space.md, paddingRight: space.xs,
      borderRadius: radius.field, backgroundColor: fill,
      borderWidth: geometry.hairline, borderColor: colors[insert && !editing ? 'modeInsert' : editing && !shell ? 'borderDefault' : 'fillTransparent'] }}>
    {/* The page loading runs along the field's bottom edge; a new tab starts its own. */}
    <LoadingBar key={tab?.id ?? ''} loading={!!tab?.loading && !start} inset={radius.field} />
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
        <Text weight="medium" lines={1} style={{ flexShrink: 0, maxWidth: '100%' }}>{leftToRight(label)}</Text>
        {crumb && <Text tone="textTertiary">{'  /  '}</Text>}
        {crumb && <Text tone="textSecondary" lines={1} style={{ flexShrink: 1 }}>{crumbTitle}</Text>}
        {!shell && !crumb && !!rest && <Text tone="textSecondary" lines={1} style={{ flexShrink: 1 }}>{leftToRight(rest)}</Text>}
      </View>}
    </View>
    {!!completion && top && <Text variant="caption" tone="omniboxCompletion" lines={1}>{`→ ${displayHost(top.url) || top.title}`}</Text>}
    {tab?.engine === 'webkit' && !editing && !shell && <Text variant="caption" tone="textTertiary">WebKit</Text>}
    {waiting && !editing && <Pressable accessibilityRole="button" accessibilityLabel={promptChipLabel(waiting)}
      accessibilityHint="Shows a request this page is waiting on" onPress={() => actions.revealPrompt(waiting.id)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, height: geometry.control - space.xs,
        paddingHorizontal: space.sm, borderRadius: radius.sm, backgroundColor: colors.accentSoft }}>
      <Icon name={promptIcon(waiting)} tone="accentSoftText" size="small" />
      <Text variant="caption" weight="semibold" tone="accentSoftText">{promptChipLabel(waiting)}</Text>
    </Pressable>}
    {/* The page's actions, as in Dia: shown with the pointer on the field; a saved page keeps its filled bookmark. */}
    {/* Saving pops the glyph on a spring. */}
    {!editing && page && bookmarks && (hovered || tab?.bookmarked) && <Animated.View style={{ transform: [{ scale: saved }] }}><IconButton
      label={tab?.bookmarked ? 'Remove bookmark' : 'Add to Bookmarks bar'} keys={['⌘', 'D']} icon={tab?.bookmarked ? 'bookmark.fill' : 'bookmark'}
      tone={tab?.bookmarked ? 'textAccent' : undefined} size="small" onPress={() => { if (tab) void actions.bookmarkTab(tab.id); }} /></Animated.View>}
    {!editing && page && hovered && <IconButton label="Copy link" keys={['⇧', '⌘', 'C']} icon="link" size="small"
      onPress={() => { if (tab) void actions.copyAddress(tab.url); }} />}
    {!editing && !start && tab?.engine === 'webkit' && <IconButton label="Shown in WebKit. Show engine options" icon="safari"
      tone="siteSecure" size="small" onFrame={f => actions.setAnchor('site', f)} onPress={() => void actions.engineMenu()} />}
    {!editing && !start && tab?.engine !== 'webkit' && <IconButton label={`${badge.label}. Show site controls`} tip={`${badge.label} · Site settings`}
      icon={badge.icon} tone={badge.tone} size="small"
      onFrame={f => actions.setAnchor('site', f)} onPress={() => void actions.siteInfo()} />}
  </View>;
}
