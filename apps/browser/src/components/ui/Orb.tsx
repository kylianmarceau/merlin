import React from 'react';
import { type ViewStyle } from 'react-native';
import { Gradient } from '../../platform/shell';
import { useTheme } from './theme';
import { geometry } from './tokens';

/** The new tab page's sphere in the workspace colour. */
export function Orb({ size = geometry.orb }: { size?: number }) {
  const { colors } = useTheme();
  return <Gradient accessible={false} gradientKind="orb" style={{ width: size, height: size }}
    gradientColors={[colors.orbHighlight, colors.orbLight, colors.orbMid, colors.orbDeep, colors.orbHorizon, colors.orbShadow]} />;
}

/** A soft wash of the workspace colour that fades out towards its edges. */
export function Glow({ style }: { style?: ViewStyle }) {
  const { colors } = useTheme();
  return <Gradient accessible={false} pointerEvents="none" gradientKind="glow" gradientColors={[colors.startGlow]} style={style} />;
}
