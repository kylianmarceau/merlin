import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, useColorScheme } from 'react-native';
import { WindowAppearance } from '../../platform/shell';
import type { Appearance } from '../../state/types';
import { palette, type Palette } from './tokens';

export type Theme = { colors: Palette; dark: boolean; reduceMotion: boolean };
const ThemeContext = createContext<Theme | null>(null);

/** macOS's Reduce Motion (System Settings > Accessibility > Display), kept current. */
function useSystemReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduce(value); }, () => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { alive = false; subscription.remove(); };
  }, []);
  return reduce;
}

/**
 * Resolves the window's appearance into colour roles. "system" follows macOS.
 * Motion is reduced when either Merlin's setting or macOS's asks for it.
 */
export function ThemeScope({ appearance, children }: React.PropsWithChildren<{ appearance: Appearance }>) {
  const system = useColorScheme();
  const systemReduce = useSystemReduceMotion();
  const mode = appearance.mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : appearance.mode;
  const reduceMotion = appearance.reduceMotion || systemReduce;
  const theme = useMemo(() => ({ colors: palette(mode, appearance.accent), dark: mode === 'dark',
    reduceMotion }), [mode, appearance.accent, reduceMotion]);
  // AppKit draws the caret, text selection and menus from the view's own
  // macOS appearance (Chromium keeps the window on macOS's mode), so the
  // shell's views follow Merlin's setting too: a black caret in Light.
  return <ThemeContext.Provider value={theme}>
    {children}
    <WindowAppearance appearanceMode={appearance.mode} pointerEvents="none" style={hidden} />
  </ThemeContext.Provider>;
}

const hidden = StyleSheet.create({ view: { position: 'absolute', width: 0, height: 0 } }).view;

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('UI components need a ThemeScope');
  return theme;
}

/** Patches some colour roles for everything inside, such as a toolbar tinted with the site's colour. */
export function PaletteScope({ roles, children }: React.PropsWithChildren<{ roles: Partial<Palette> | null }>) {
  const theme = useTheme();
  const key = JSON.stringify(roles);
  // No roles: the surrounding palette. Callers can keep the scope in place
  // whether or not it changes anything, so their children aren't remounted.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => (roles ? { ...theme, colors: { ...theme.colors, ...roles } } : theme), [theme, key]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
