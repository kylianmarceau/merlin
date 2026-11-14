// The glass look every window draws with, from Settings › Appearance ›
// Interface style. Glass needs macOS 26's Liquid Glass; earlier macOS draws
// Classic whatever the setting says, and Settings doesn't offer the choice.
import { useMemo } from 'react';
import { isLiquidGlass } from '../platform/shell';
import { useShellPrefs } from './shellPrefs';

export const liquidGlass = isLiquidGlass();

export type GlassChoice = { on: boolean; translucent: boolean; tint: number; transparency: number };

export function useGlassLook(): GlassChoice {
  const style = useShellPrefs(p => p.interfaceStyle);
  const tinted = useShellPrefs(p => p.glassTintWithTheme);
  const amount = useShellPrefs(p => p.glassTintAmount);
  const transparency = useShellPrefs(p => p.glassTransparency);
  return useMemo(() => ({ on: liquidGlass && style === 'glass', translucent: style === 'glass', tint: tinted ? amount : 0, transparency }),
    [style, tinted, amount, transparency]);
}
