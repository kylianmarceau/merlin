import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { Surface, VisualEffect } from '../../platform/shell';
import { useTheme } from './theme';
import { geometry, radius as radii, shadow, type ColorRole, type Radius, type ShadowName } from './tokens';

export type PanelProps = {
  fill?: ColorRole; radius?: Radius; border?: ColorRole | null; elevation?: ShadowName; style?: ViewStyle | ViewStyle[];
  /** Vibrancy under a translucent `fill`: the page shows through, blurred. */
  glass?: boolean;
  children?: React.ReactNode; accessibilityLabel?: string; accessibilityViewIsModal?: boolean;
};

const cover = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

/**
 * A raised surface with a real layer shadow. Popovers, menus, dialogs, sheets
 * and toasts are all Panels, so they share one fill, edge and shadow model.
 * Glass panels draw the edge over their vibrancy so it stays visible.
 */
export function Panel({ fill = 'surfacePopover', radius = 'popover', border = 'surfaceBorder', elevation = 'popover', glass = false,
  style, children, ...rest }: PanelProps) {
  const { colors, dark } = useTheme();
  const drop = shadow[elevation];
  const r = radii[radius];
  return <Surface {...rest} style={style} surfaceFill={glass ? undefined : colors[fill]} surfaceRadius={r}
    surfaceBorderColor={!glass && border ? colors[border] : undefined} surfaceBorderWidth={!glass && border ? geometry.hairline : 0}
    surfaceShadowColor={colors.shadowColor} surfaceShadowOpacity={dark ? Math.min(1, drop.opacity * 2) : drop.opacity}
    surfaceShadowRadius={drop.radius} surfaceShadowOffsetY={drop.offsetY}>
    {glass && <VisualEffect material="popover" blending="within" effectRadius={r} style={cover} />}
    {glass && <View pointerEvents="none" style={[cover, { borderRadius: r, backgroundColor: colors[fill] }]} />}
    {children}
    {glass && border && <View pointerEvents="none" style={[cover, { borderRadius: r, borderWidth: geometry.hairline,
      borderColor: colors[border] }]} />}
  </Surface>;
}
