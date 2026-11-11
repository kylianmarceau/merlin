import React from 'react';
import type { ViewProps } from 'react-native';
import { ContextMenuArea as NativeContextMenuArea, WindowDragRegion } from '../../platform/shell';

/** Empty space that moves the window when dragged and zooms it on a double click. */
export function DragRegion(props: ViewProps) {
  return <WindowDragRegion {...props} />;
}

/** Turns a right click or Control-click inside it into `onOpen`, for a native menu. */
export function ContextMenu({ onOpen, children, style }: React.PropsWithChildren<{ onOpen(): void; style?: ViewProps['style'] }>) {
  return <NativeContextMenuArea onContextMenu={onOpen} style={style}>{children}</NativeContextMenuArea>;
}
