import React from 'react';
import type { ViewStyle } from 'react-native';
import { PopoverBubble } from '../../platform/shell';
import { useTheme } from './theme';
import { geometry, panelGlass, radius as radii, shadow, type ColorRole, type ShadowName } from './tokens';

/**
 * A popover's surface. With Glass it is macOS Liquid Glass in the window's
 * tint and transparency; with Classic a solid panel with an edge and a
 * shadow. The arrow, when there is one, is part of the same outline.
 */
export function PopoverSurface({ arrow = 'none', arrowX = 0, radius = radii.bubble, fill = 'surfacePopoverSolid', elevation = 'popover',
  glassFloor = 0, style }: {
  arrow?: 'top' | 'bottom' | 'none'; arrowX?: number; radius?: number; fill?: ColorRole; elevation?: ShadowName;
  /** The least colour layer over the glass, 0 to 1 (`legibleGlass` for text-heavy pop-ups). */
  glassFloor?: number; style?: ViewStyle;
}) {
  const { colors, dark, accent, glass } = useTheme();
  const drop = shadow[elevation];
  const tinted = panelGlass(dark ? 'dark' : 'light', accent, glass, glassFloor);
  return <PopoverBubble pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, style ?? {}]}
    glass={glass.on} glassFade={tinted.fade} glassTint={tinted.tint} bubbleRadius={radius} arrowEdge={arrow} arrowX={arrowX}
    arrowWidth={geometry.arrowWidth} arrowHeight={geometry.arrowHeight}
    bubbleFill={glass.on ? tinted.fill : colors[fill]} bubbleEdgeColor={colors.surfaceBorder} bubbleEdgeWidth={geometry.hairline / 2}
    bubbleShadowColor={colors.shadowColor} bubbleShadowOpacity={dark ? Math.min(1, drop.opacity * 2) : drop.opacity}
    bubbleShadowRadius={drop.radius} bubbleShadowOffsetY={drop.offsetY} />;
}

