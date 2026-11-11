import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import type { Appearance } from '@merlin/engine';
import { accents, palettes } from './tokens';

export type Theme = { [K in keyof typeof palettes.light]: string } & { accent: string; onAccent: string; dark: boolean };
const ThemeContext = createContext<Theme | null>(null);
export function ThemeScope({ appearance, children }: React.PropsWithChildren<{ appearance: Appearance }>) {
  const system = useColorScheme();
  const mode = appearance.mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : appearance.mode;
  const theme = useMemo(() => ({ ...palettes[mode], accent: accents[mode][appearance.accent],
    onAccent: mode === 'dark' ? palettes.dark.frame : palettes.light.raised, dark: mode === 'dark' }), [mode, appearance.accent]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('UI components require ThemeScope');
  return theme;
}
