import React from 'react';
import { View } from 'react-native';
import { GlassPlate } from '../../platform/shell';
import { useTheme } from './theme';
import { controlGlass, controlGlassStrength, type ColorRole, type GlassState } from './tokens';

const cover = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

/**
 * The highlight behind a row or control that is hovered, pressed or chosen:
 * a Liquid Glass plate with Glass, a flat wash (`classic`) with Classic.
 * Drawn behind the control's content and never takes a click.
 */
export function GlassFill({ radius, state, classic, dark: surfaceDark }: {
  radius: number; state: GlassState; classic?: ColorRole; dark?: boolean;
}) {
  const { colors, dark, accent, glass } = useTheme();
  if (state === 'rest' && !glass.on) return null;
  if (!glass.on) return classic ? <View pointerEvents="none" style={[cover, { borderRadius: radius, backgroundColor: colors[classic] }]} /> : null;
  const shownDark = surfaceDark ?? dark;
  return <GlassPlate pointerEvents="none" style={[cover, { opacity: controlGlassStrength }]} glassRadius={radius} glassClear glassDark={shownDark}
    glassTint={controlGlass(shownDark ? 'dark' : 'light', accent, glass, state)} />;
}
