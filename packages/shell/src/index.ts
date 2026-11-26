// AppKit views and menus for the React shell. Only apps/browser/src/platform
// imports this package; components use the wrappers it re-exports.
import { createElement, type ComponentType } from 'react';
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type SymbolName = 'arrow.left' | 'arrow.right' | 'arrow.up' | 'arrow.down' | 'arrow.clockwise' | 'xmark' | 'plus' |
  'sidebar.left' | 'gearshape' | 'arrow.down.circle' | 'command' | 'pin' | 'pin.fill' |
  'magnifyingglass' | 'clock' | 'bookmark' | 'bookmark.fill' | 'rectangle.stack' | 'speaker.wave.2' | 'speaker.slash' | 'globe' |
  'lock.shield' | 'ellipsis' | 'folder' | 'folder.badge.plus' | 'folder.badge.minus' | 'play.fill' | 'pause.fill' | 'forward.fill' | 'backward.fill' | 'trash' | 'pencil' | 'checkmark' | 'chevron.right' |
  'chevron.down' | 'puzzlepiece.extension' | 'person.crop.circle' | 'doc.text' | 'paintbrush' | 'hand.raised' | 'bolt' |
  'keyboard' | 'info.circle' | 'books.vertical' | 'arrow.uturn.backward' | 'play' | 'pause' | 'rectangle.split.2x1' |
  'lock' | 'lock.open' | 'exclamationmark.triangle' | 'exclamationmark.octagon' | 'bell.badge' | 'square.on.square' |
  'rectangle.portrait.and.arrow.right' | 'sparkles' | 'eye.slash' | 'link' | 'character.bubble' | 'key' | 'creditcard' |
  'mappin.and.ellipse' | 'arrow.up.forward.app' | 'moon' | 'sun.max' | 'rectangle.topthird.inset.filled' |
  // A dragged tab's drop zones over the page.
  'rectangle.lefthalf.filled' | 'rectangle.righthalf.filled' |
  // Tide's set: chevrons for navigation, and Merlin's own picks for Settings and the toolbar.
  'chevron.left' | 'chevron.up' | 'switch.2' | 'arrow.down.to.line' | 'nosign' | 'speedometer' | 'shippingbox' |
  'curlybraces' | 'm.square' | 'minus' | 'arrow.up.right' | 'person.crop.circle.badge.plus' | 'clock.arrow.circlepath' |
  'square.dashed' | 'safari' |
  // Ardia's downloads panel and the bookmarks bar.
  'magnifyingglass.circle.fill' | 'pause.circle.fill' | 'play.circle.fill' | 'xmark.circle.fill' | 'arrow.clockwise.circle.fill' |
  'doc' | 'folder.fill' | 'chevron.up.chevron.down' | 'checkmark.seal.fill' | 'sparkles.rectangle.stack' | 'link.circle' |
  // Tabs' sound, pinned tiles and the bookmarks section.
  'speaker.wave.2.fill' | 'speaker.slash.fill' | 'pin.slash' | 'doc.on.doc' | 'arrow.up.to.line' |
  // The tab menu (Ardia gives every item a symbol), and the icons a tab can take instead of its page's.
  'rectangle.stack.badge.plus' | 'rectangle.stack.badge.minus' | 'xmark.square' | 'face.smiling' | 'arrow.counterclockwise' |
  'star' | 'heart' | 'flag' | 'book' | 'briefcase' | 'cart' | 'envelope' | 'music.note' | 'gamecontroller' | 'house' |
  'graduationcap' | 'paintpalette' | 'chart.bar' | 'calendar' | 'film' | 'newspaper' | 'bubble.left' | 'leaf' | 'airplane' |
  // Spaces' icons (as in Zen and Arc) and their menus.
  'circle.fill' | 'flame' | 'cup.and.saucer' | 'chevron.left.forwardslash.chevron.right' | 'camera' | 'dumbbell' | 'pawprint' |
  'atom' | 'square.grid.2x2' | 'square.stack' | 'arrow.right.square';

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
  surfaceTurn?: { page: string; offset: number; milliseconds: number };
  surfaceFill?: string; surfaceRadius?: number; surfaceBorderColor?: string; surfaceBorderWidth?: number;
  surfaceShadowColor?: string; surfaceShadowOpacity?: number; surfaceShadowRadius?: number; surfaceShadowOffsetY?: number;
};
export const Surface = view<SurfaceProps>('Surface');

export const WelcomeFilm = view<ViewProps & { soundEnabled: boolean; onFinished(): void }>('WelcomeFilm');

export const WindowDragRegion = view<ViewProps>('WindowDragRegion');

/** Puts its React root in the macOS appearance for the shell's theme, so AppKit's own caret and menus match; "system" follows the window. */
export const WindowAppearance = view<ViewProps & { appearanceMode: 'light' | 'dark' | 'system' }>('WindowAppearance');

export type OutsidePressEvent = NativeSyntheticEvent<{ reason: 'press' | 'blur' | 'escape' }>;
/** Reports presses outside it (also on the page), the window losing focus and, with `closesOnEscape`, Escape typed anywhere in the window while it is the newest such area. */
export const OutsidePress = view<ViewProps & { onOutsidePress(event: OutsidePressEvent): void; closesOnEscape?: boolean }>('OutsidePress');

export const ContextMenuArea = view<ViewProps & { onContextMenu(): void }>('ContextMenuArea');

/** A sideways two-finger swipe over the area: how far the fingers have gone (points, right positive) and, at the end, how fast. */
export type SwipeEvent = NativeSyntheticEvent<{ phase: 'begin' | 'move' | 'end' | 'cancel'; dx: number; velocity: number }>;
/** Reports sideways trackpad swipes over it (spaces, as in Zen and Arc); vertical scrolling and clicks reach its children as usual. */
export const SwipeArea = view<ViewProps & { onSwipe(event: SwipeEvent): void; swipeEnabled?: boolean }>('SwipeArea');

/** Lets the file at `filePath` be dragged out, as from Finder; clicks inside still reach its children. */
export const FileDrag = view<ViewProps & { filePath: string; onDragEnd?(event: NativeSyntheticEvent<{ dropped: boolean }>): void }>('FileDrag');

/** A ring filling clockwise from the top; a negative `ringProgress` circles while the total is unknown. */
export type ProgressRingProps = ViewProps & {
  ringProgress: number; ringColor: string; ringTrackColor: string; ringWidth: number; ringReduceMotion?: boolean;
};
export const ProgressRing = view<ProgressRingProps>('ProgressRing');

/** "orb": four stops, highlight to deep, then horizon glow and shadow. "glow": one colour fading out. */
/**
 * Fades its content out over the last `fadeLength` points, instead of an
 * ellipsis, and over the first `fadeLeading` if set. `flushScroll`: a scroll
 * view inside sits in the title bar, and AppKit mustn't inset it for it.
 */
export const Fade = view<ViewProps & { fadeLength: number; fadeLeading?: number; flushScroll?: boolean }>('Fade');

export type GradientProps = ViewProps & {
  gradientKind: 'orb' | 'glow' | 'workspace' | 'vertical'; gradientColors: string[];
  gradientAngle?: number; gradientNoise?: number; gradientTexture?: string;
  gradientProfile?: { stops: number[]; fade: number[]; fadeStops: number[] };
};
export const Gradient = view<GradientProps>('Gradient');

/** A Liquid Glass plate behind a control (vibrancy before macOS 26). Never takes a click. */
export const Glass = view<ViewProps & { glassRadius: number; glassTint?: string; glassClear?: boolean; glassDark?: boolean }>('Glass');

export type PopoverBubbleProps = ViewProps & {
  bubbleRadius: number; arrowEdge: 'top' | 'bottom' | 'none'; arrowX?: number; arrowWidth?: number; arrowHeight?: number;
  bubbleJoin?: { top: boolean; left: boolean; right: boolean };
  /** The glass tint, or the solid fill when `glass` is false. */
  bubbleFill?: string; bubbleEdgeColor?: string; bubbleEdgeWidth?: number;
  bubbleShadowColor?: string; bubbleShadowOpacity?: number; bubbleShadowRadius?: number; bubbleShadowOffsetY?: number;
  glass: boolean;
  /** With glass: 0 is regular (frosted) glass, 1 clear glass, between them a cross-fade. */
  glassFade?: number; glassTint?: string;
};
/** A popover's surface: Liquid Glass or a solid panel, with an arrow pointing at its control. */
export const PopoverBubble = view<PopoverBubbleProps>('PopoverBubble');

export type FullScreenEvent = NativeSyntheticEvent<{ fullScreen: boolean }>;
/** Whether the window is in front, and which of its edges touch the screen's. */
export type WindowStateEvent = NativeSyntheticEvent<{ key: boolean; leftEdge: boolean; topEdge: boolean }>;
/** Reports whether its window is in macOS full screen, in front, and at the screen's edges; names the window. */
export const WindowState = view<ViewProps & { onFullScreen(event: FullScreenEvent): void; onWindowState?(event: WindowStateEvent): void;
  windowButtons?: boolean; windowButtonsCenter?: number; windowTitle?: string }>('WindowState');

export type MenuItem =
  | { id: string; title: string; enabled?: boolean; checked?: boolean; destructive?: boolean; symbol?: SymbolName }
  | { title: string; children: MenuItem[]; enabled?: boolean; symbol?: SymbolName }
  | { separator: true };
/** alignment: a tick as something snaps into place; level: a limit reached; generic: anything else. */
export type HapticKind = 'alignment' | 'level' | 'generic';
/** An icon's colours: one dark colour, one light colour, a few greys, or colour. */
export type IconTone = 'dark' | 'light' | 'mixed' | 'colour';
export type LoginItemStatus = 'enabled' | 'requiresApproval' | 'notRegistered' | 'notFound';
export type AppIconChoice = { id: string; name: string; preview: string };
type NativeShell = {
  showMenu(items: MenuItem[]): Promise<string | null>;
  preference(key: string): Promise<string | null>;
  setPreference(key: string, value: string | null): Promise<void>;
  isLiquidGlass(): boolean;
  fileIcon(ext: string, size: number): Promise<string | null>;
  installedSetupApps(ids: string[]): Promise<string[]>;
  setupDockStatus(): Promise<boolean>;
  addMerlinToDock(): Promise<boolean>;
  installBrowserctl(): Promise<string>;
  checkDefaultBrowserTrial(): Promise<void>;
  isDefaultBrowser(): Promise<boolean>;
  makeDefaultBrowser(): Promise<boolean>;
  loginItem(): Promise<LoginItemStatus>;
  setLoginItem(on: boolean): Promise<LoginItemStatus>;
  setThinScrollBars(thin: boolean): Promise<void>;
  installQuitGuard(): Promise<void>;
  setBookmarksMenuHidden(hidden: boolean): Promise<void>;
  tidyMenuBar(): Promise<void>;
  appIcons(size: number): Promise<AppIconChoice[]>;
  appIcon(): Promise<string>;
  setAppIcon(id: string): Promise<void>;
  copyText(text: string): Promise<void>;
  releaseVersion(): string | null;
  traceEnabled(): boolean;
  trace(line: string): void;
  chooseSaveFile(name: string): Promise<string | null>;
  haptic(kind: HapticKind): void;
  imageTone(dataURL: string): Promise<IconTone | null>;
  setMenuState(state: Record<string, boolean>): void;
  addListener(event: 'onPreferenceChanged', listener: (event: { key: string; value: string | null }) => void): { remove(): void };
  addListener(event: 'onMenuCommand', listener: (event: { id: string }) => void): { remove(): void };
};
let shell: NativeShell | undefined;
const native = () => (shell ??= requireNativeModule<NativeShell>('MerlinShell'));

/** Whether macOS draws Liquid Glass (macOS 26 and later). */
export function isLiquidGlass(): boolean {
  try { return native().isLiquidGlass(); } catch { return false; }
}
/** The Finder icon for files with this extension, as a PNG data URL. */
export const fileIcon = (ext: string, size: number) => native().fileIcon(ext, size);
export const installedSetupApps = (ids: string[]) => native().installedSetupApps(ids);
export const setupDockStatus = () => native().setupDockStatus();
export const addMerlinToDock = () => native().addMerlinToDock();
export const installBrowserctl = () => native().installBrowserctl();
export const checkDefaultBrowserTrial = () => native().checkDefaultBrowserTrial();
export const isDefaultBrowser = () => native().isDefaultBrowser();
/** macOS asks the person to confirm; resolves with whether Merlin is now the default. */
export const makeDefaultBrowser = () => native().makeDefaultBrowser();
export const loginItem = () => native().loginItem();
export const setLoginItem = (on: boolean) => native().setLoginItem(on);
export const setThinScrollBars = (thin: boolean) => native().setThinScrollBars(thin);
/** Routes ⌘Q through the "Warn before quitting" question. */
export const installQuitGuard = () => native().installQuitGuard();
export const setBookmarksMenuHidden = (hidden: boolean) => native().setBookmarksMenuHidden(hidden);
export const tidyMenuBar = () => native().tidyMenuBar();
export const appIcons = (size: number) => native().appIcons(size);
export const appIcon = () => native().appIcon();
export const setAppIcon = (id: string) => native().setAppIcon(id);
export const copyText = (text: string) => native().copyText(text);
/** Asks where to save a file; resolves with its path, or null when cancelled. */
export const chooseSaveFile = (name: string) => native().chooseSaveFile(name);
/** Merlin's release version ("0.2.0-beta.13"), or null for a build that was not packaged as a release. */
export function releaseVersion(): string | null {
  try { return native().releaseVersion() ?? null; } catch { return null; }
}
/** Whether MERLIN_STARTUP_TRACE is set, so timing lines are wanted. */
export function traceEnabled(): boolean {
  try { return native().traceEnabled(); } catch { return false; }
}
/** Appends a line to the startup trace (only when traceEnabled). */
export const trace = (line: string) => native().trace(line);
/** A shell preference AppKit changed itself, such as "Don't ask again" on the quit question. */
export function onPreferenceChanged(listener: (key: string, value: string | null) => void) {
  return native().addListener('onPreferenceChanged', e => listener(e.key, e.value));
}
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

/** A tick on a Force Touch trackpad; nothing on other hardware or builds without it. */
export function haptic(kind: HapticKind) {
  try { native().haptic(kind); } catch { /* An older host: no haptics. */ }
}
/** Whether a page icon (a data URL) is all one dark or light colour. */
export async function imageTone(dataURL: string): Promise<IconTone | null> {
  try { return await native().imageTone(dataURL); } catch { return null; }
}
/** The front window's layout, for the checkmarks on Merlin's View menu items. */
export function setMenuState(state: Record<string, boolean>) {
  try { native().setMenuState(state); } catch { /* An older host: no View menu items. */ }
}
/** A View menu item of Merlin's was chosen ("tabs.side", "tabs.top", "tabs.hide", "split", "address.toolbar"). */
export function onMenuCommand(listener: (id: string) => void) {
  try { return native().addListener('onMenuCommand', e => listener(e.id)); } catch { return { remove() {} }; }
}
