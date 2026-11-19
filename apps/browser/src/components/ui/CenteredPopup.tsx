import React, { useEffect, useRef, useState } from 'react';
import { Animated, TextInput, View } from 'react-native';
import { Pressable } from './Pressable';
import { Icon, type SymbolName } from './Icon';
import { KeyCap } from './KeyCap';
import { Panel } from './Panel';
import { Text } from './Text';
import { useInteraction } from './interaction';
import { useEscape } from './keys';
import { duration, useEntrance } from './motion';
import { Shake } from './Shake';
import { useTheme } from './theme';
import { font, geometry, legibleGlass, opacity, radius, space } from './tokens';

/**
 * The one place every centred pop-up sits: the command menu (`:` and
 * Command-K), the new-tab pop-up (Command-T) and Run a Command. Same width,
 * same spot: its top is where a full pop-up would be centred in the window,
 * so the field never jumps as the list fills. It grows in from 92% on a
 * spring while it fades in over 100 ms (`useEntrance`), and leaves the window
 * undimmed: its shadow sets it apart, and a press anywhere outside it closes
 * it. Input it refuses shakes it (`shake` changes).
 */
export function CenteredPopup({ label, onDismiss, width = geometry.palette, shake = 0, children }: React.PropsWithChildren<{
  label: string; onDismiss(): void; width?: number; shake?: number;
}>) {
  const { reduceMotion } = useTheme();
  const entrance = useEntrance(reduceMotion);
  const [height, setHeight] = useState(0);
  const top = Math.max(space.huge, (height - geometry.popupHeight) / 2);
  return <View pointerEvents="box-none" onLayout={e => setHeight(e.nativeEvent.layout.height)}
    style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', paddingTop: top }}>
    <Pressable accessible={false} onPress={onDismiss} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    <Animated.View style={{ width, maxWidth: '90%', opacity: entrance.opacity, transform: [{ scale: entrance.scale }] }}>
      <Shake count={shake} radius={radius.popover}>
        <Panel glass glassFloor={legibleGlass} fill="surfacePalette" radius="popover" elevation="dialog" accessibilityLabel={label}
          accessibilityViewIsModal>
          <View style={{ borderRadius: radius.popover, overflow: 'hidden' }}>{children}</View>
        </Panel>
      </Shake>
    </Animated.View>
  </View>;
}

type FieldKey = 'up' | 'down' | 'tab';

/**
 * A pop-up's search field. It holds the keyboard for as long as the pop-up is
 * open: the page or Chromium can take focus as a pop-up opens (a tab switch
 * focuses the page), which used to leave typing and Escape going to the page.
 */
export function PopupField({ value, placeholder, label, icon = 'magnifyingglass', onChangeText, onSubmit, onEscape, onKey,
  focusRequest, trailing, selectAll = false }: {
  value: string; placeholder: string; label: string; icon?: SymbolName;
  onChangeText(text: string): void; onSubmit(): void; onEscape(): void; onKey?(key: FieldKey): void;
  /** Changes when something asks for the field to take the focus again. */
  focusRequest?: number;
  trailing?: React.ReactNode;
  /** Selects what the field starts with, so typing replaces it (⌘L's address). */
  selectAll?: boolean;
}) {
  const { colors } = useTheme();
  const input = useRef<TextInput>(null);
  useEffect(() => {
    if (!selectAll) return;
    const timer = setTimeout(() => input.current?.setNativeProps({ selection: { start: 0, end: value.length } }), duration.fast);
    return () => clearTimeout(timer);
  }, [focusRequest]);  // eslint-disable-line react-hooks/exhaustive-deps
  const open = useRef(true);
  const escape = useEscape(onEscape);
  const focus = () => { if (open.current) input.current?.focus(); };
  useEffect(() => {
    open.current = true;
    focus();
    // Once more after the event that opened the pop-up has finished.
    const timer = setTimeout(focus, duration.refocus);
    return () => { open.current = false; clearTimeout(timer); };
  }, [focusRequest]);  // eslint-disable-line react-hooks/exhaustive-deps
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, height: geometry.paletteInput,
    paddingHorizontal: space.lg + space.xs, borderBottomWidth: geometry.hairline, borderBottomColor: colors.borderSubtle }}>
    <Icon name={icon} tone="iconSecondary" size="large" weight="regular" />
    <TextInput ref={input} autoFocus blurOnSubmit={false} enableFocusRing={false} accessibilityLabel={label}
      value={value} placeholder={placeholder} placeholderTextColor={colors.textTertiary} selectionColor={colors.textSelection} cursorColor={colors.textPrimary}
      style={{ flex: 1, color: colors.textPrimary, fontFamily: font.family, fontSize: font.size.input }}
      onBlur={() => setTimeout(focus, duration.refocus)}
      keyDownEvents={[{ key: 'ArrowDown' }, { key: 'ArrowUp' }, { key: 'Tab' }, { key: 'Escape' }]}
      onKeyDown={e => {
        const key = e.nativeEvent.key;
        if (key === 'ArrowDown') onKey?.('down');
        else if (key === 'ArrowUp') onKey?.('up');
        else if (key === 'Tab') onKey?.('tab');
        else if (key === 'Escape') escape();
      }}
      onKeyPress={e => { if (e.nativeEvent.key === 'Escape') escape(); }}
      onSubmitEditing={onSubmit} onChangeText={onChangeText} />
    {trailing}
  </View>;
}

/** One result in a centred pop-up: what it is first, then what choosing it does. */
export function PopupRow({ title, detail, keys, leading, selected, disabled, onPress }: {
  title: string; detail?: string; keys?: string; leading?: React.ReactNode; selected: boolean; disabled?: boolean; onPress(): void;
}) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="menuitem" accessibilityLabel={detail ? `${title}, ${detail}` : title}
    accessibilityState={{ selected, disabled: !!disabled }} disabled={disabled} onPress={onPress} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: geometry.paletteRow, paddingHorizontal: space.md,
      borderRadius: radius.field, opacity: disabled ? opacity.disabled : 1,
      backgroundColor: colors[selected ? 'paletteSelected' : hovered && !disabled ? 'fillHover' : 'fillTransparent'] }}>
    {leading}
    <Text lines={1} style={{ flexShrink: 1 }} tone={selected ? 'paletteSelectedText' : 'textPrimary'}>{title}</Text>
    <View style={{ flex: 1 }} />
    {!!detail && <Text variant="label" weight="regular" lines={1} tone={selected ? 'paletteSelectedText' : 'textSecondary'}
      style={{ flexShrink: 1 }}>{detail}</Text>}
    {!!keys && <KeyCap>{keys}</KeyCap>}
  </Pressable>;
}

/** The pop-up's footer: the keys that work in it, on the pop-up's own surface. */
export function PopupFooter({ accept = 'Open', children }: React.PropsWithChildren<{ accept?: string }>) {
  const { colors } = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg + space.hair, paddingHorizontal: space.lg + space.xs,
    paddingVertical: space.sm + space.hair, borderTopWidth: geometry.hairline,
    borderTopColor: colors.borderSubtle }}>
    <Hint keys="↩" label={accept} />
    <Hint keys="↑↓" label="Move" />
    {children}
    <View style={{ flex: 1 }} />
    <Hint keys="esc" label="Close" />
  </View>;
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair }}>
    <Text variant="label" weight="semibold" tone="groupLabel">{keys}</Text>
    <Text variant="label" weight="regular" tone="textSecondary">{label}</Text>
  </View>;
}
