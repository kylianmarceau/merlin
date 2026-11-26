import React from 'react';
import type { ViewStyle } from 'react-native';
import { Surface, Symbol, type SymbolName } from '../../platform/shell';
import { geometry } from './tokens';

/**
 * A rounded surface with a real layer shadow at any size and colour, for
 * drawings drawn to scale such as setup's preview window. Everything else
 * uses Panel, which takes the shell's named radii and roles.
 */
export function Plate({ fill, radius, edge, edgeWidth = geometry.hairline / 2, shadow, style, children }: {
  fill: string; radius: number; edge?: string; edgeWidth?: number;
  shadow?: { color: string; opacity: number; radius: number; offsetY: number };
  style?: ViewStyle | ViewStyle[]; children?: React.ReactNode;
}) {
  return <Surface pointerEvents="none" style={style} surfaceFill={fill} surfaceRadius={radius}
    surfaceBorderColor={edge} surfaceBorderWidth={edge ? edgeWidth : 0}
    surfaceShadowColor={shadow?.color} surfaceShadowOpacity={shadow?.opacity ?? 0}
    surfaceShadowRadius={shadow?.radius ?? 0} surfaceShadowOffsetY={shadow?.offsetY ?? 0}>
    {children}
  </Surface>;
}

/** An SF Symbol at any size and colour, for drawings drawn to scale. */
export function Glyph({ name, size, color, weight = 'medium' }: {
  name: SymbolName; size: number; color: string; weight?: 'regular' | 'medium' | 'semibold' | 'bold';
}) {
  return <Symbol name={name} size={size} color={color} weight={weight} />;
}
