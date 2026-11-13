import React from 'react';
import type { ViewStyle } from 'react-native';
import { WebKitPageView } from '../../platform/webkit';

/**
 * A tab's WebKit page, for sites Chromium can't play (state/webkit.ts). Like
 * Page, it only places the page: the page lives on while another tab shows,
 * and takes the keys when its tab is the active one.
 */
export function WebKitPage({ tabId, active, style }: { tabId: string; active: boolean; style?: ViewStyle }) {
  return <WebKitPageView tabId={tabId} active={active} style={style ?? { flex: 1 }} />;
}
