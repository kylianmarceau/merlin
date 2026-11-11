import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { VisualEffect, type VisualEffectProps } from '../../platform/shell';
import { useTheme } from './theme';
import { radius as radii, type ColorRole, type Radius } from './tokens';

/**
 * macOS vibrancy behind its children: the desktop shows through the sidebar
 * ("behind"), or the page through a popover ("within"). A tint keeps text
 * legible over busy wallpapers.
 */
export function Glass({ material, blending = 'behind', tint, radius = 'none', style, children }: React.PropsWithChildren<{
  material: VisualEffectProps['material']; blending?: 'behind' | 'within'; tint?: ColorRole; radius?: Radius; style?: ViewStyle;
}>) {
  const { colors } = useTheme();
  return <View style={[{ overflow: radius === 'none' ? undefined : 'hidden', borderRadius: radii[radius] }, style]}>
    <VisualEffect material={material} blending={blending} effectRadius={radii[radius]}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    {tint && <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors[tint] }} />}
    {children}
  </View>;
}
