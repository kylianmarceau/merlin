// AppKit views and menus: vibrancy, shadowed surfaces, the window drag region,
// outside-press detection, context-menu areas and native menus. Only
// components/ui and state/ reach this module.
export {
  canInstallUpdate, installUpdate,
  Symbol, VisualEffect, Surface, Glass as GlassPlate, PopoverBubble, WindowState, isLiquidGlass, fileIcon, checkDefaultBrowserTrial, isDefaultBrowser,
  makeDefaultBrowser, installedSetupApps, setupDockStatus, addMerlinToDock, installCli, loginItem, setLoginItem, setThinScrollBars, installQuitGuard, setBookmarksMenuHidden, tidyMenuBar, appIcons, appIcon, setAppIcon,
  onPreferenceChanged, haptic, imageTone, setMenuState, onMenuCommand, type HapticKind, type IconTone, type WindowStateEvent, copyText, releaseVersion, trace, traceEnabled, chooseSaveFile, type PopoverBubbleProps, type FullScreenEvent, type LoginItemStatus, type AppIconChoice, WelcomeFilm, WindowDragRegion, WindowAppearance, OutsidePress, ContextMenuArea, SwipeArea, FileDrag, ProgressRing, Fade, Gradient, showMenu, preference, setPreference,
  type GradientProps, type SymbolName, type SymbolProps, type VisualEffectProps, type SurfaceProps, type OutsidePressEvent, type MenuItem, type SwipeEvent,
} from '@merlin/shell';
