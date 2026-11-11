import React from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from './Icon';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, opacity, radius, space } from './tokens';

/** A checkbox with its label; the whole row toggles it. */
export function Checkbox({ label, value, onChange, disabled = false }: {
  label: string; value: boolean; onChange(value: boolean): void; disabled?: boolean;
}) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }}
    disabled={disabled} onPress={() => onChange(!value)}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, opacity: disabled ? opacity.disabled : 1 }}>
    <View style={{ width: geometry.iconSmall + space.xs, height: geometry.iconSmall + space.xs, borderRadius: radius.xs,
      alignItems: 'center', justifyContent: 'center', borderWidth: geometry.hairline,
      borderColor: colors[value ? 'accent' : 'borderStrong'], backgroundColor: colors[value ? 'accent' : 'fillTransparent'] }}>
      {value && <Icon name="checkmark" tone="textOnAccent" size="small" weight="bold" />}
    </View>
    <Text>{label}</Text>
  </Pressable>;
}
