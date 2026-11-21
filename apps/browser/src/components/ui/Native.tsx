import React from 'react';
import type { ViewProps } from 'react-native';
import { ContextMenuArea as NativeContextMenuArea, FileDrag as NativeFileDrag, WindowDragRegion, WindowState, haptic, type HapticKind } from '../../platform/shell';

/** Empty space that moves the window when dragged and zooms it on a double click. */
export function DragRegion(props: ViewProps) {
  return <WindowDragRegion {...props} />;
}

/** Turns a right click or Control-click inside it into `onOpen`, for a native menu. */
export function ContextMenu({ onOpen, children, style }: React.PropsWithChildren<{ onOpen(): void; style?: ViewProps['style'] }>) {
  return <NativeContextMenuArea onContextMenu={onOpen} style={style}>{children}</NativeContextMenuArea>;
}

export type WindowFacts = { key: boolean; leftEdge: boolean; topEdge: boolean };

/**
 * Reports whether the window is in macOS full screen (not a page's own
 * fullscreen), whether it is in front and which of its edges meet the
 * screen's (`onState`); shows or hides its traffic lights (`windowButtons`)
 * and names it in the Window menu (`title`).
 */
export function FullScreenWatch({ onChange, onState, windowButtons = true, title }: {
  onChange(fullScreen: boolean): void; onState?(facts: WindowFacts): void; windowButtons?: boolean; title?: string;
}) {
  return <WindowState pointerEvents="none" style={{ position: 'absolute', width: 0, height: 0 }} windowButtons={windowButtons}
    windowTitle={title} onFullScreen={e => onChange(e.nativeEvent.fullScreen)} onWindowState={e => onState?.(e.nativeEvent)} />;
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
