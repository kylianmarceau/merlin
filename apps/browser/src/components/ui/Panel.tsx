import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { Surface } from '../../platform/shell';
import { PopoverSurface } from './PopoverSurface';
import { useTheme } from './theme';
import { geometry, radius as radii, shadow, type ColorRole, type Radius, type ShadowName } from './tokens';

export type PanelProps = {
  fill?: ColorRole; radius?: Radius; border?: ColorRole | null; elevation?: ShadowName; style?: ViewStyle | ViewStyle[];
  /** Liquid Glass, or a solid panel in Classic; `fill` then only applies to non-glass panels. */
  glass?: boolean;
  /** With `glass`, the least colour layer over it (see PopoverSurface). */
  glassFloor?: number;
  children?: React.ReactNode; accessibilityLabel?: string; accessibilityViewIsModal?: boolean;
};

/**
 * A raised surface with a real layer shadow. Popovers, menus, dialogs and
 * sheets share its fill, edge and shadow model.
 * A glass panel is Liquid Glass when Settings › Appearance chooses Glass, and
 * an opaque panel with an edge and a shadow when it chooses Classic.
 */
export function Panel({ fill = 'surfacePopover', radius = 'popover', border = 'surfaceBorder', elevation = 'popover', glass = false,
  glassFloor, style, children, ...rest }: PanelProps) {
  const { colors, dark } = useTheme();
  const drop = shadow[elevation];
  const r = radii[radius];
  if (glass) return <View {...rest} style={style}>
    <PopoverSurface radius={r} elevation={elevation} glassFloor={glassFloor} />
    {children}
  </View>;
  return <Surface {...rest} style={style} surfaceFill={colors[fill]} surfaceRadius={r}
    surfaceBorderColor={border ? colors[border] : undefined} surfaceBorderWidth={border ? geometry.hairline : 0}
    surfaceShadowColor={colors.shadowColor} surfaceShadowOpacity={dark ? Math.min(1, drop.opacity * 2) : drop.opacity}
    surfaceShadowRadius={drop.radius} surfaceShadowOffsetY={drop.offsetY}>
    {children}
  </Surface>;
}
