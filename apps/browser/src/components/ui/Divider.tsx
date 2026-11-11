import React from 'react';
import { View } from 'react-native';
import { useTheme } from './theme';
import { geometry, space, type ColorRole, type Space } from './tokens';

export function Divider({ vertical, tone = 'borderSubtle', inset = 'none' }: { vertical?: boolean; tone?: ColorRole; inset?: Space }) {
  const { colors } = useTheme();
  return <View style={vertical
    ? { width: geometry.hairline, alignSelf: 'stretch', backgroundColor: colors[tone], marginVertical: space[inset] }
    : { height: geometry.hairline, alignSelf: 'stretch', backgroundColor: colors[tone], marginHorizontal: space[inset] }} />;
}
