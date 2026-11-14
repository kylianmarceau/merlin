import React from 'react';
import type { ViewProps } from 'react-native';
import { ContextMenuArea as NativeContextMenuArea, WindowDragRegion, WindowState } from '../../platform/shell';

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
