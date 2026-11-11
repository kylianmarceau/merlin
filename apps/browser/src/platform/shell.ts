// AppKit views and menus: vibrancy, shadowed surfaces, the window drag region,
// outside-press detection, context-menu areas and native menus. Only
// components/ui and state/ reach this module.
export {
  Symbol, VisualEffect, Surface, WindowDragRegion, OutsidePress, ContextMenuArea, showMenu,
  type SymbolName, type SymbolProps, type VisualEffectProps, type SurfaceProps, type OutsidePressEvent, type MenuItem,
} from '@merlin/shell';
