import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { GlassFill } from './GlassFill';
import { ContextMenu } from './Native';
import { Icon, type SymbolName } from './Icon';
import { useInteraction } from './interaction';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, opacity, radius, space, type ColorRole, type GlassState } from './tokens';

// Popover content follows Ardia's panels: text 16 pt from the panel's edge;
// rows inset 6 pt with 10 pt of their own padding and a concentric 6 pt
// corner; titles at 13/16, details at 11/14.

/** Popover content is inset this far from the panel's sides, as in the downloads panel. */
export const popoverInset = space.lg;
const rowInset = geometry.panelRowInset;
const rowPadding = geometry.panelRowPadding;

/** A row's highlight state from hover, press and selection. */
export function rowState(hovered: boolean, pressed: boolean, selected = false): GlassState {
  return pressed ? 'pressed' : selected ? 'active' : hovered ? 'lit' : 'rest';
}

/** The row highlight: glass with Glass, a soft wash with Classic. */
export function RowFill({ state, selectedRole = 'rowHover' }: { state: GlassState; selectedRole?: ColorRole }) {
  if (state === 'rest') return null;
  return <GlassFill radius={radius.bubbleRow} state={state}
    classic={state === 'pressed' ? 'rowPressed' : state === 'active' ? selectedRole : 'rowHover'} />;
}

/**
 * A command inside a popover or menu: its label first, then a shortcut or
 * value. Icons are optional and only for rows where they say something.
 */
export function MenuRow({ label, icon, shortcut, detail, trailing, onPress, disabled, destructive, selected }: {
  label: string; icon?: SymbolName; shortcut?: string; detail?: string; trailing?: React.ReactNode; onPress(): void;
  disabled?: boolean; destructive?: boolean; selected?: boolean;
}) {
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="menuitem" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected }}
    disabled={disabled} onPress={onPress} {...handlers}
    style={{ marginHorizontal: rowInset, opacity: disabled ? opacity.disabled : 1 }}>
    {({ pressed }) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: geometry.panelIconGap, minHeight: geometry.panelRow,
      paddingHorizontal: rowPadding, paddingVertical: detail ? space.xs : 0, borderRadius: radius.bubbleRow }}>
      <RowFill state={rowState(hovered && !disabled, pressed, selected)} selectedRole="suggestionSelected" />
      {icon && <Icon name={icon} tone={destructive ? 'textDanger' : 'iconSecondary'} size="small" />}
      <View style={{ flex: 1 }}>
        <Text variant="row" lines={1} tone={destructive ? 'textDanger' : selected ? 'suggestionSelectedText' : 'textPrimary'}>{label}</Text>
        {!!detail && <Text variant="rowDetail" lines={1}>{detail}</Text>}
      </View>
      {!!shortcut && <Text variant="label" weight="regular" tone="textTertiary">{shortcut}</Text>}
      {trailing}
    </View>}
  </Pressable>;
}

export function MenuSeparator() {
  const { colors } = useTheme();
  return <View style={{ height: geometry.hairline / 2, backgroundColor: colors.borderDefault, marginVertical: geometry.panelSeparatorGap,
    marginHorizontal: popoverInset }} />;
}

/** An uppercase heading over a group of rows, with an optional quiet action at its end ("Clear"). */
export function MenuSection({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', height: geometry.panelHeader, paddingLeft: popoverInset,
    paddingRight: popoverInset - space.sm }}>
    <View style={{ flex: 1 }}><Text variant="section" tone="textSecondary">{title}</Text></View>
    {trailing}
  </View>;
}

/** A quiet text button for a section header, such as the downloads panel's Clear. */
export function MenuTextButton({ label, onPress }: { label: string; onPress(): void }) {
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} {...handlers}>
    {({ pressed }) => <View style={{ height: geometry.panelHeader, justifyContent: 'center', paddingHorizontal: space.sm,
      borderRadius: radius.bubbleRow }}>
      <RowFill state={rowState(hovered, pressed)} />
      <Text variant="row" tone={hovered ? 'textPrimary' : 'textSecondary'}>{label}</Text>
    </View>}
  </Pressable>;
}

/** The quiet "View all …  ›" row that ends a popover. */
export function MenuFooter({ label, onPress }: { label: string; onPress(): void }) {
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} {...handlers} style={{ marginHorizontal: rowInset }}>
    {({ pressed }) => <View style={{ flexDirection: 'row', alignItems: 'center', height: geometry.panelRow, paddingHorizontal: rowPadding,
      borderRadius: radius.bubbleRow }}>
      <RowFill state={rowState(hovered, pressed)} />
      <View style={{ flex: 1 }}><Text variant="row" tone={hovered ? 'textPrimary' : 'textSecondary'}>{label}</Text></View>
      <Icon name="chevron.right" tone="textTertiary" size="chevron" weight="semibold" />
    </View>}
  </Pressable>;
}

/**
 * One item in a popover: something on the left (a file, a profile, a site),
 * a title with a detail line, and actions on the right. As in Ardia's
 * downloads panel, `hoverTrailing` shows only while the row is hovered.
 */
export function PopoverRow({ title, detail, leading, trailing, hoverTrailing, children, onPress, selected, titleTone = 'textPrimary',
  detailTone = 'textSecondary', wrap = false, strike = false, accessibilityLabel, onContextMenu }: {
  title: string; detail?: string; leading?: React.ReactNode; trailing?: React.ReactNode; hoverTrailing?: React.ReactNode;
  children?: React.ReactNode; onPress?: () => void; selected?: boolean; titleTone?: ColorRole; detailTone?: ColorRole; wrap?: boolean;
  /** The file is gone: the title is struck through. */
  strike?: boolean;
  accessibilityLabel?: string; onContextMenu?: () => void;
}) {
  // The whole row, its buttons included, counts as hovered.
  const [hovered, setHovered] = useState(false);
  const body = (pressed: boolean) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: geometry.panelIconGap,
    minHeight: geometry.downloadRow, paddingHorizontal: rowPadding, paddingVertical: space.xs, borderRadius: radius.bubbleRow }}>
    <RowFill state={rowState(!!onPress && hovered, !!onPress && pressed, selected)} />
    {leading}
    <View style={{ flex: 1 }}>
      <Text variant="row" tone={titleTone} lines={wrap ? undefined : 1}
        style={strike ? { textDecorationLine: 'line-through' } : undefined}>{title}</Text>
      {children}
      {!!detail && <Text variant="rowDetail" tone={detailTone} lines={wrap ? undefined : 1}>{detail}</Text>}
    </View>
    {trailing}
    {hoverTrailing && <View style={{ width: geometry.rowButton, marginRight: -(geometry.rowButton - geometry.rowGlyph) / 2,
      opacity: hovered ? 1 : 0 }} pointerEvents={hovered ? 'auto' : 'none'}>{hoverTrailing}</View>}
  </View>;
  const row = <View style={{ marginHorizontal: rowInset }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    {onPress ? <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ selected: !!selected }}
      onPress={onPress}>{({ pressed }) => body(pressed)}</Pressable> : body(false)}
  </View>;
  return onContextMenu ? <ContextMenu onOpen={onContextMenu}>{row}</ContextMenu> : row;
}

/** Free content in a popover, inset like its rows. */
export function PopoverBody({ children, gap = 'sm' }: React.PropsWithChildren<{ gap?: keyof typeof space }>) {
  return <View style={{ paddingHorizontal: popoverInset, paddingVertical: space.sm, gap: space[gap] }}>{children}</View>;
}

