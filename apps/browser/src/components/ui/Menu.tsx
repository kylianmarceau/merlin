import React from 'react';
import { Pressable, View } from 'react-native';
import { Icon, type SymbolName } from './Icon';
import { useInteraction } from './interaction';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, opacity, radius, space, type ColorRole } from './tokens';

/** Popover content is inset this far from the panel's sides, as in the downloads panel. */
export const popoverInset = space.lg + space.hair;

/**
 * A command inside a popover or menu: its label first, then a shortcut or
 * value. Icons are optional and only for rows where they say something.
 */
export function MenuRow({ label, icon, shortcut, detail, trailing, onPress, disabled, destructive, selected }: {
  label: string; icon?: SymbolName; shortcut?: string; detail?: string; trailing?: React.ReactNode; onPress(): void;
  disabled?: boolean; destructive?: boolean; selected?: boolean;
}) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="menuitem" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected }}
    disabled={disabled} onPress={onPress} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + space.hair, minHeight: geometry.popoverRow,
      paddingHorizontal: space.md, paddingVertical: detail ? space.xs : 0, marginHorizontal: space.sm - space.hair,
      borderRadius: radius.row, opacity: disabled ? opacity.disabled : 1,
      backgroundColor: colors[selected ? 'suggestionSelected' : hovered ? 'fillHover' : 'fillTransparent'] }}>
    {icon && <Icon name={icon} tone={destructive ? 'textDanger' : 'iconSecondary'} size="small" />}
    <View style={{ flex: 1 }}>
      <Text lines={1} tone={destructive ? 'textDanger' : selected ? 'suggestionSelectedText' : 'textPrimary'}>{label}</Text>
      {!!detail && <Text variant="caption" lines={1}>{detail}</Text>}
    </View>
    {!!shortcut && <Text variant="label" weight="regular" tone="textTertiary">{shortcut}</Text>}
    {trailing}
  </Pressable>;
}

export function MenuSeparator() {
  const { colors } = useTheme();
  return <View style={{ height: geometry.hairline, backgroundColor: colors.borderSubtle, marginVertical: space.xs + space.hair,
    marginHorizontal: popoverInset }} />;
}

/** An uppercase heading over a group of rows. */
export function MenuSection({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: popoverInset, paddingTop: space.md,
    paddingBottom: space.xs + space.hair }}>
    <View style={{ flex: 1 }}><Text variant="section">{title}</Text></View>
    {trailing}
  </View>;
}

/** The quiet "View all …  ›" row that ends a popover. */
export function MenuFooter({ label, onPress }: { label: string; onPress(): void }) {
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: popoverInset, paddingTop: space.sm + space.hair,
      paddingBottom: space.sm }}>
    <View style={{ flex: 1 }}><Text tone={hovered ? 'textPrimary' : 'textSecondary'}>{label}</Text></View>
    <Icon name="chevron.right" tone="iconSecondary" size="small" />
  </Pressable>;
}

/**
 * One item in a popover: something on the left (a file, a profile, a site),
 * a title with a detail line, and actions on the right.
 */
export function PopoverRow({ title, detail, leading, trailing, children, onPress, selected, titleTone = 'textPrimary', wrap = false,
  accessibilityLabel }: {
  title: string; detail?: string; leading?: React.ReactNode; trailing?: React.ReactNode; children?: React.ReactNode;
  onPress?: () => void; selected?: boolean; titleTone?: ColorRole; wrap?: boolean; accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  const body = <>
    {leading}
    <View style={{ flex: 1 }}>
      <Text variant="calloutStrong" tone={titleTone} lines={wrap ? undefined : 1}>{title}</Text>
      {children}
      {!!detail && <Text variant="label" weight="regular" tone="textSecondary" lines={wrap ? undefined : 1}>{detail}</Text>}
    </View>
  </>;
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingRight: popoverInset,
    backgroundColor: colors[onPress && hovered ? 'fillHover' : 'fillTransparent'] }}>
    {onPress ? <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ selected: !!selected }}
      onPress={onPress} {...handlers} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md,
        paddingLeft: popoverInset, paddingVertical: space.sm }}>{body}</Pressable>
      : <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: popoverInset,
        paddingVertical: space.sm }}>{body}</View>}
    {trailing}
  </View>;
}

/** Free content in a popover, inset like its rows. */
export function PopoverBody({ children, gap = 'sm' }: React.PropsWithChildren<{ gap?: keyof typeof space }>) {
  return <View style={{ paddingHorizontal: popoverInset, paddingVertical: space.sm, gap: space[gap] }}>{children}</View>;
}
