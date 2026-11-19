import React from 'react';
import { View } from 'react-native';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, opacity, radius, space } from './tokens';

/** One choice from a short list, shown inline. */
export function Segmented<T extends string | number>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange(value: T): void; disabled?: boolean;
}) {
  const { colors } = useTheme();
  return <View accessibilityRole="radiogroup" accessibilityLabel={label}
    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.hair, padding: space.hair, borderRadius: radius.control,
      backgroundColor: colors.fillControl, opacity: disabled ? opacity.disabled : 1, alignSelf: 'flex-start' }}>
    {options.map(option => {
      const selected = option.value === value;
      return <Pressable key={String(option.value)} accessibilityRole="radio" accessibilityState={{ selected, disabled }}
        accessibilityLabel={option.label} disabled={disabled} onPress={() => onChange(option.value)}
        style={{ paddingHorizontal: space.md, minHeight: geometry.control - space.xs, justifyContent: 'center',
          borderRadius: radius.sm, backgroundColor: colors[selected ? 'fillSelectedStrong' : 'fillTransparent'] }}>
        <Text variant="label" tone={selected ? 'textPrimary' : 'textSecondary'} weight={selected ? 'semibold' : 'medium'}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}
