import React from 'react';
import { StyleSheet } from 'react-native';
import { Gradient } from '../../platform/shell';
import type { WorkspaceTheme } from '../../state/workspaceTheme';

export function WorkspaceTint({ theme }: { theme: WorkspaceTheme }) {
  return <Gradient pointerEvents="none" gradientKind="workspace" gradientAngle={theme.angle}
    gradientNoise={theme.noise} gradientTexture={theme.texture} gradientColors={theme.stops}
    style={[StyleSheet.absoluteFillObject, { opacity: theme.intensity * (1 - theme.translucency * .4) }]} />;
}
