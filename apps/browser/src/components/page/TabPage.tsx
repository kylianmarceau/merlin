import React from 'react';
import type { Tab } from '../../state/types';
import { Page } from './Page';
import { WebKitPage } from './WebKitPage';

/**
 * A tab's page in whichever engine shows it: WebKit's page for a site that
 * opens in WebKit (state/webkit.ts), else Chromium's. Every place that shows
 * a tab's page (the window's page area, a pop-up) shows it through this, so
 * none shows Chromium's hidden page under WebKit's address.
 */
export function TabPage({ tab, active }: { tab: Tab; active: boolean }) {
  return tab.engine === 'webkit' ? <WebKitPage key="webkit" tabId={tab.id} active={active} /> : <Page key="page" tabId={tab.id} />;
}
