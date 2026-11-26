import React from 'react';
import type { ViewProps } from 'react-native';
import { ContextMenuArea as NativeContextMenuArea, FileDrag as NativeFileDrag, SwipeArea as NativeSwipeArea, WindowDragRegion, WindowState, haptic, type HapticKind, type WindowStateEvent } from '../../platform/shell';

/** Empty space that moves the window when dragged and zooms it on a double click. */
export function DragRegion(props: ViewProps) {
  return <WindowDragRegion {...props} />;
}

/** A sideways two-finger swipe over the area, as `onSwipe` hears it: the phase, the fingers' travel in points (right positive) and, at the end, their speed. */
export type Swipe = { phase: 'begin' | 'move' | 'end' | 'cancel'; dx: number; velocity: number };
/** Hears sideways trackpad swipes over its children (spaces, as in Zen and Arc); clicks and vertical scrolling reach them as usual. */
export function SwipeArea({ onSwipe, enabled = true, style, children }: React.PropsWithChildren<{
  onSwipe(swipe: Swipe): void; enabled?: boolean; style?: ViewProps['style'];
}>) {
  return <NativeSwipeArea swipeEnabled={enabled} style={style} onSwipe={e => onSwipe(e.nativeEvent)}>{children}</NativeSwipeArea>;
}

/** Turns a right click or Control-click inside it into `onOpen`, for a native menu. */
export function ContextMenu({ onOpen, children, style }: React.PropsWithChildren<{ onOpen(): void; style?: ViewProps['style'] }>) {
  return <NativeContextMenuArea onContextMenu={onOpen} style={style}>{children}</NativeContextMenuArea>;
}

export type WindowFacts = WindowStateEvent['nativeEvent'];

/**
 * Reports whether the window is in macOS full screen (not a page's own
 * fullscreen), whether it is in front and which of its edges meet the
 * screen's (`onState`); shows or hides its traffic lights (`windowButtons`)
 * and names it in the Window menu (`title`).
 */
export function FullScreenWatch({ onChange, onState, windowButtons = true, windowButtonsCenter = 0, title }: {
  onChange(fullScreen: boolean): void; onState?(facts: WindowFacts): void;
  windowButtons?: boolean; windowButtonsCenter?: number; title?: string;
}) {
  return <WindowState pointerEvents="none" style={{ position: 'absolute', width: 0, height: 0 }} windowButtons={windowButtons}
    windowButtonsCenter={windowButtonsCenter} windowTitle={title}
    onFullScreen={e => onChange(e.nativeEvent.fullScreen)} onWindowState={e => onState?.(e.nativeEvent)} />;
}

/**
 * Lets the file at `path` be dragged out of the window, to Finder, Mail or a
 * page, as from Finder. Without a path it is a plain view. Clicks inside
 * still work; a press that moves becomes the drag instead.
 */
export function FileDragArea({ path, children, style }: React.PropsWithChildren<{ path?: string; style?: ViewProps['style'] }>) {
  return <NativeFileDrag filePath={path ?? ''} style={style}>{children}</NativeFileDrag>;
}

/**
 * A trackpad tick, as AppKit gives one when something snaps into place: a
 * dragged tab reaching a new slot or a drop target, a resize meeting its
 * limit. Silent on a mouse, and harmless where the host has no haptics.
 */
export function tick(kind: HapticKind = 'alignment') {
  haptic(kind);
}

export { WelcomeFilm } from '../../platform/shell';
