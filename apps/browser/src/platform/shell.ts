// AppKit views and menus: vibrancy, shadowed surfaces, the window drag region,
// outside-press detection, context-menu areas and native menus. Only
// components/ui and state/ reach this module.
export {
  Symbol, VisualEffect, Surface, Glass as GlassPlate, PopoverBubble, WindowState, isLiquidGlass, fileIcon, isDefaultBrowser,
  makeDefaultBrowser, loginItem, setLoginItem, setThinScrollBars, installQuitGuard, setBookmarksMenuHidden, appIcons, appIcon, setAppIcon,
  onPreferenceChanged, copyText, releaseVersion, chooseSaveFile, type PopoverBubbleProps, type FullScreenEvent, type LoginItemStatus, type AppIconChoice, WindowDragRegion, WindowAppearance, OutsidePress, ContextMenuArea, FileDrag, ProgressRing, Fade, Gradient, showMenu, preference, setPreference,
  type GradientProps, type SymbolName, type SymbolProps, type VisualEffectProps, type SurfaceProps, type OutsidePressEvent, type MenuItem,
} from '@merlin/shell';
