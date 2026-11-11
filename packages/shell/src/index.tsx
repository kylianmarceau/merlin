import React from 'react';
import { requireNativeViewManager } from 'expo-modules-core';
import type { ViewProps } from 'react-native';

type PageProps = ViewProps & { windowId: string; tabId: string };
let Page: React.ComponentType<PageProps> | undefined;
export function BrowserPage(props: PageProps) {
  Page ??= requireNativeViewManager<PageProps>('MerlinEngine', 'Page');
  return <Page {...props} />;
}

export type SymbolName = 'arrow.left' | 'arrow.right' | 'arrow.up' | 'arrow.down' | 'arrow.clockwise' | 'xmark' | 'plus' |
  'sidebar.left' | 'gearshape' | 'arrow.down.circle' | 'command' | 'pin' | 'pin.fill' |
  'magnifyingglass' | 'clock' | 'bookmark' | 'rectangle.stack' | 'speaker.wave.2' | 'globe' | 'lock.shield' | 'ellipsis' |
  'folder' | 'folder.badge.plus' | 'trash' | 'pencil' | 'checkmark' | 'chevron.right' | 'puzzlepiece.extension' |
  'person.crop.circle' | 'doc.text' | 'paintbrush' | 'hand.raised' | 'bolt' | 'keyboard' | 'info.circle' |
  'books.vertical' | 'arrow.uturn.backward' | 'play' | 'pause' | 'rectangle.split.2x1' | 'lock' | 'exclamationmark.triangle';
type SymbolProps = ViewProps & { name: SymbolName; color: string; size: number };
let SymbolView: React.ComponentType<SymbolProps> | undefined;
export function Symbol({ name, color, size = 16 }: { name: SymbolName; color: string; size?: number }) {
  SymbolView ??= requireNativeViewManager<SymbolProps>('MerlinEngine', 'Symbol');
  return <SymbolView name={name} color={color} size={size} accessible={false} style={{ width: size, height: size }} />;
}
