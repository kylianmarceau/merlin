import React from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, radius, space } from './tokens';

/** A keyboard shortcut, drawn as keys. */
export function KeyCap({ children }: { children: string }) {
  const { colors } = useTheme();
  return <View style={{ minWidth: geometry.keycap, height: geometry.keycap, paddingHorizontal: space.xs, borderRadius: radius.xs,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.keycapFill,
    borderWidth: geometry.hairline, borderColor: colors.keycapBorder }}>
    <Text variant="caption" weight="semibold" tone="keycapText">{children}</Text>
  </View>;
}
