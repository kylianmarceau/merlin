// The glass look every window draws with, from Settings › Appearance ›
// Interface style. Liquid Glass panels need macOS 26. On macOS 14 and 15
// Settings doesn't offer the choice and panels and controls are always
// Classic (`on` is false), but the stored style (Glass by default) still
// decides `translucent`: the window around the page keeps the system's
// sidebar vibrancy, which those versions have.
import { useMemo } from 'react';
import { isLiquidGlass } from '../platform/shell';
import { useShellPrefs } from './shellPrefs';

export const liquidGlass = isLiquidGlass();

export type GlassChoice = { on: boolean; translucent: boolean; tint: number; transparency: number; workspaceColor?: string };

/** `spaceColor`: the colour of the space the window shows, if it has its own (state/spaces.ts). */
export function useGlassLook(spaceColor?: string): GlassChoice {
  const style = useShellPrefs(p => p.interfaceStyle);
  const tinted = useShellPrefs(p => p.glassTintWithTheme);
  const amount = useShellPrefs(p => p.glassTintAmount);
  const transparency = useShellPrefs(p => p.glassTransparency);
  const workspaceColor = useShellPrefs(p => p.workspaceTheme?.stops[0]) ?? undefined;
  const color = spaceColor ?? workspaceColor;
  return useMemo(() => ({ on: liquidGlass && style === 'glass', translucent: style === 'glass', tint: tinted ? amount : 0, transparency, workspaceColor: color }),
    [style, tinted, amount, transparency, color]);
}
