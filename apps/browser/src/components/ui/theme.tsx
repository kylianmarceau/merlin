import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import type { Appearance } from '../../state/types';
import { palette, type Palette } from './tokens';

export type Theme = { colors: Palette; dark: boolean; reduceMotion: boolean };
const ThemeContext = createContext<Theme | null>(null);

/** Resolves the window's appearance into colour roles. "system" follows macOS. */
export function ThemeScope({ appearance, children }: React.PropsWithChildren<{ appearance: Appearance }>) {
  const system = useColorScheme();
  const mode = appearance.mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : appearance.mode;
  const theme = useMemo(() => ({ colors: palette(mode, appearance.accent), dark: mode === 'dark',
    reduceMotion: appearance.reduceMotion }), [mode, appearance.accent, appearance.reduceMotion]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('UI components need a ThemeScope');
  return theme;
}

/** Patches some colour roles for everything inside, such as a toolbar tinted with the site's colour. */
export function PaletteScope({ roles, children }: React.PropsWithChildren<{ roles: Partial<Palette> }>) {
  const theme = useTheme();
  const key = JSON.stringify(roles);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ ...theme, colors: { ...theme.colors, ...roles } }), [theme, key]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
