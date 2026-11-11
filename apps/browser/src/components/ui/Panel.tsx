import React from 'react';
import type { ViewStyle } from 'react-native';
import { Surface } from '../../platform/shell';
import { useTheme } from './theme';
import { geometry, radius as radii, shadow, type ColorRole, type Radius, type ShadowName } from './tokens';

export type PanelProps = {
  fill?: ColorRole; radius?: Radius; border?: ColorRole | null; elevation?: ShadowName; style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode; accessibilityLabel?: string; accessibilityViewIsModal?: boolean;
};

/**
 * A raised surface with a real layer shadow. Popovers, menus, dialogs, sheets
 * and toasts are all Panels, so they share one fill, edge and shadow model.
 */
export function Panel({ fill = 'surfacePopover', radius = 'popover', border = 'surfaceBorder', elevation = 'popover', style, children,
  ...rest }: PanelProps) {
  const { colors, dark } = useTheme();
  const drop = shadow[elevation];
  return <Surface {...rest} style={style} surfaceFill={colors[fill]} surfaceRadius={radii[radius]}
    surfaceBorderColor={border ? colors[border] : undefined} surfaceBorderWidth={border ? geometry.hairline : 0}
    surfaceShadowColor={colors.shadowColor} surfaceShadowOpacity={dark ? Math.min(1, drop.opacity * 2) : drop.opacity}
    surfaceShadowRadius={drop.radius} surfaceShadowOffsetY={drop.offsetY}>
    {children}
  </Surface>;
}
