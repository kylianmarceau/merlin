import React, { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from './theme';
import { geometry, space, type ColorRole, type Space } from './tokens';

export function Divider({ vertical, tone = 'borderSubtle', inset = 'none' }: { vertical?: boolean; tone?: ColorRole; inset?: Space }) {
  const { colors } = useTheme();
  return <View style={vertical
    ? { width: geometry.hairline, alignSelf: 'stretch', backgroundColor: colors[tone], marginVertical: space[inset] }
    : { height: geometry.hairline, alignSelf: 'stretch', backgroundColor: colors[tone], marginHorizontal: space[inset] }} />;
}

/**
 * A dashed hairline across its container, as Ardia draws under its Top Apps
 * tiles. Drawn as dashes rather than a dashed border, which AppKit only draws
 * around a whole box.
 */
export function DashedRule({ tone = 'sidebarRule', inset = 'none' }: { tone?: ColorRole; inset?: Space }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const count = Math.floor((width + geometry.ruleGap) / (geometry.ruleDash + geometry.ruleGap));
  return <View pointerEvents="none" onLayout={e => setWidth(e.nativeEvent.layout.width)}
    style={{ height: geometry.hairline, alignSelf: 'stretch', marginHorizontal: space[inset], flexDirection: 'row', gap: geometry.ruleGap,
      overflow: 'hidden' }}>
    {Array.from({ length: count }, (_, i) => <View key={i} style={{ width: geometry.ruleDash, backgroundColor: colors[tone] }} />)}
  </View>;
}
