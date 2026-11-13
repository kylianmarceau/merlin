// AppKit views and menus for the React shell. Only apps/browser/src/platform
// imports this package; components use the wrappers it re-exports.
import { createElement, type ComponentType } from 'react';
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type SymbolName = 'arrow.left' | 'arrow.right' | 'arrow.up' | 'arrow.down' | 'arrow.clockwise' | 'xmark' | 'plus' |
  'sidebar.left' | 'gearshape' | 'arrow.down.circle' | 'command' | 'pin' | 'pin.fill' |
  'magnifyingglass' | 'clock' | 'bookmark' | 'bookmark.fill' | 'rectangle.stack' | 'speaker.wave.2' | 'speaker.slash' | 'globe' |
  'lock.shield' | 'ellipsis' | 'folder' | 'folder.badge.plus' | 'trash' | 'pencil' | 'checkmark' | 'chevron.right' |
  'chevron.down' | 'puzzlepiece.extension' | 'person.crop.circle' | 'doc.text' | 'paintbrush' | 'hand.raised' | 'bolt' |
  'keyboard' | 'info.circle' | 'books.vertical' | 'arrow.uturn.backward' | 'play' | 'pause' | 'rectangle.split.2x1' |
  'lock' | 'lock.open' | 'exclamationmark.triangle' | 'exclamationmark.octagon' | 'bell.badge' | 'square.on.square' |
  'rectangle.portrait.and.arrow.right' | 'sparkles' | 'eye.slash' | 'link' | 'character.bubble' | 'key' | 'creditcard' |
  'mappin.and.ellipse' | 'arrow.up.forward.app' | 'moon' | 'sun.max' | 'rectangle.topthird.inset.filled' |
  // Tide's set: chevrons for navigation, and Merlin's own picks for Settings and the toolbar.
  'chevron.left' | 'chevron.up' | 'switch.2' | 'arrow.down.to.line' | 'nosign' | 'speedometer' | 'shippingbox' |
  'curlybraces' | 'm.square' | 'minus' | 'arrow.up.right' | 'person.crop.circle.badge.plus' | 'clock.arrow.circlepath' |
  'square.dashed';

// Each view is its own native module (MerlinShell<Name>); see MerlinShellModule.swift.
function view<P>(name: string) {
  let resolved: ComponentType<P> | undefined;
  return (props: P) => {
    resolved ??= requireNativeViewManager<P>(`MerlinShell${name}`);
    return createElement(resolved as ComponentType<object>, props as object);
  };
}

export type SymbolProps = { name: SymbolName; color: string; size?: number; weight?: 'regular' | 'medium' | 'semibold' | 'bold' };
const NativeSymbol = view<ViewProps & Required<Omit<SymbolProps, 'weight'>> & { weight: string }>('Symbol');
export function Symbol({ name, color, size = 16, weight = 'medium' }: SymbolProps) {
  return NativeSymbol({ name, color, size, weight, accessible: false, style: { width: size, height: size } });
}

export type VisualEffectProps = ViewProps & {
  material: 'sidebar' | 'popover' | 'menu' | 'hud' | 'header' | 'sheet' | 'window' | 'underWindow' | 'content' | 'titlebar' | 'tooltip';
  blending?: 'behind' | 'within'; alwaysActive?: boolean; emphasized?: boolean; effectRadius?: number;
};
export const VisualEffect = view<VisualEffectProps>('VisualEffect');

export type SurfaceProps = ViewProps & {
  surfaceFill?: string; surfaceRadius?: number; surfaceBorderColor?: string; surfaceBorderWidth?: number;
  surfaceShadowColor?: string; surfaceShadowOpacity?: number; surfaceShadowRadius?: number; surfaceShadowOffsetY?: number;
};
export const Surface = view<SurfaceProps>('Surface');

export const WindowDragRegion = view<ViewProps>('WindowDragRegion');

/** Puts its React root in the macOS appearance for the shell's theme, so AppKit's own caret and menus match; "system" follows the window. */
export const WindowAppearance = view<ViewProps & { appearanceMode: 'light' | 'dark' | 'system' }>('WindowAppearance');

export type OutsidePressEvent = NativeSyntheticEvent<{ reason: 'press' | 'blur' }>;
export const OutsidePress = view<ViewProps & { onOutsidePress(event: OutsidePressEvent): void }>('OutsidePress');

export const ContextMenuArea = view<ViewProps & { onContextMenu(): void }>('ContextMenuArea');

/** "orb": four stops, highlight to deep, then horizon glow and shadow. "glow": one colour fading out. */
/** Fades its content out over the last `fadeLength` points, instead of an ellipsis. */
export const Fade = view<ViewProps & { fadeLength: number }>('Fade');

export type GradientProps = ViewProps & { gradientKind: 'orb' | 'glow'; gradientColors: string[] };
export const Gradient = view<GradientProps>('Gradient');

export type MenuItem =
  | { id: string; title: string; enabled?: boolean; checked?: boolean; destructive?: boolean; symbol?: SymbolName }
  | { title: string; children: MenuItem[]; enabled?: boolean; symbol?: SymbolName }
  | { separator: true };
type NativeShell = {
  showMenu(items: MenuItem[]): Promise<string | null>;
  preference(key: string): Promise<string | null>;
  setPreference(key: string, value: string | null): Promise<void>;
};
let shell: NativeShell | undefined;
/** Shows a native menu at the pointer; resolves with the chosen item's id. */
export function showMenu(items: MenuItem[]): Promise<string | null> {
  shell ??= requireNativeModule<NativeShell>('MerlinShell');
  return shell.showMenu(items);
}

/** Reads a shell-only preference kept by AppKit (the same for every profile). */
export function preference(key: string): Promise<string | null> {
  shell ??= requireNativeModule<NativeShell>('MerlinShell');
  return shell.preference(key);
}
export function setPreference(key: string, value: string | null): Promise<void> {
  shell ??= requireNativeModule<NativeShell>('MerlinShell');
  return shell.setPreference(key, value);
}
