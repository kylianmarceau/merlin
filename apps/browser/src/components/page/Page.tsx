import React from 'react';
import type { ViewStyle } from 'react-native';
import { PageView } from '../../platform/engine';
import { useSnapshot } from '../../state/window';

/**
 * A tab's web page, or the window's extension popup. Chromium owns the page
 * view; this places it in the layout. The only feature that hosts a native page.
 */
export function Page({ tabId, style }: { tabId: string; style?: ViewStyle }) {
  const { windowId } = useSnapshot();
  return <PageView key={tabId} windowId={windowId} tabId={tabId} style={style ?? { flex: 1 }} />;
}
