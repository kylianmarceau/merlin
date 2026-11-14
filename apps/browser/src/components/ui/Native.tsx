import React from 'react';
import type { ViewProps } from 'react-native';
import { ContextMenuArea as NativeContextMenuArea, FileDrag as NativeFileDrag, WindowDragRegion, WindowState } from '../../platform/shell';

/** Empty space that moves the window when dragged and zooms it on a double click. */
export function DragRegion(props: ViewProps) {
  return <WindowDragRegion {...props} />;
}

/** Turns a right click or Control-click inside it into `onOpen`, for a native menu. */
export function ContextMenu({ onOpen, children, style }: React.PropsWithChildren<{ onOpen(): void; style?: ViewProps['style'] }>) {
  return <NativeContextMenuArea onContextMenu={onOpen} style={style}>{children}</NativeContextMenuArea>;
}

/** Reports whether the window is in macOS full screen (not a page's own fullscreen). */
export function FullScreenWatch({ onChange }: { onChange(fullScreen: boolean): void }) {
  return <WindowState pointerEvents="none" style={{ position: 'absolute', width: 0, height: 0 }}
    onFullScreen={e => onChange(e.nativeEvent.fullScreen)} />;
}

/**
 * Lets the file at `path` be dragged out of the window, to Finder, Mail or a
 * page, as from Finder. Without a path it is a plain view. Clicks inside
 * still work; a press that moves becomes the drag instead.
 */
export function FileDragArea({ path, children, style }: React.PropsWithChildren<{ path?: string; style?: ViewProps['style'] }>) {
  return <NativeFileDrag filePath={path ?? ''} style={style}>{children}</NativeFileDrag>;
}
