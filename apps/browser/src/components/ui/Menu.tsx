import React from 'react';
import { Pressable, View } from 'react-native';
import { Icon, type SymbolName } from './Icon';
import { useInteraction } from './interaction';
import { KeyCap } from './KeyCap';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, opacity, radius, space } from './tokens';

/** A command inside a popover: icon, label and an optional shortcut. */
export function MenuRow({ label, icon, shortcut, detail, onPress, disabled, destructive, selected }: {
  label: string; icon?: SymbolName; shortcut?: string; detail?: string; onPress(): void; disabled?: boolean;
  destructive?: boolean; selected?: boolean;
}) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="menuitem" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected }}
    disabled={disabled} onPress={onPress} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: geometry.row, paddingHorizontal: space.sm,
      borderRadius: radius.sm, opacity: disabled ? opacity.disabled : 1,
      backgroundColor: colors[selected ? 'suggestionSelected' : hovered ? 'fillHover' : 'fillTransparent'] }}>
    {icon && <Icon name={icon} tone={destructive ? 'textDanger' : 'iconSecondary'} size="small" />}
    <View style={{ flex: 1 }}>
      <Text lines={1} tone={destructive ? 'textDanger' : selected ? 'suggestionSelectedText' : 'textPrimary'}>{label}</Text>
      {!!detail && <Text variant="caption" lines={1}>{detail}</Text>}
    </View>
    {!!shortcut && <KeyCap>{shortcut}</KeyCap>}
  </Pressable>;
}

export function MenuSeparator() {
  const { colors } = useTheme();
  return <View style={{ height: geometry.hairline, backgroundColor: colors.borderSubtle, marginVertical: space.xs, marginHorizontal: space.sm }} />;
}

export function MenuSection({ title }: { title: string }) {
  return <View style={{ paddingHorizontal: space.sm, paddingTop: space.sm, paddingBottom: space.xs }}>
    <Text variant="section">{title}</Text>
  </View>;
}
