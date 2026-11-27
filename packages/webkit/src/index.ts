// WebKit pages for sites Chromium can't play (MerlinWebKitModule.swift).
// Only apps/browser/src/platform imports this package.
import { createElement, type ComponentType } from 'react';
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { ViewProps } from 'react-native';

/** What a tab's WebKit page shows. Colours are "#RRGGBB"; the icon is a data URL. */
export type WebKitPageState = {
  tabId: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; crashed: boolean;
  color?: string; surface?: string; favicon?: string;
};
export type WebKitCommand = 'back' | 'forward' | 'reload' | 'reloadFromOrigin' | 'stop';
export type WebKitEvent =
  | { type: 'pageState'; state: WebKitPageState }
  /** A link or script on the page opened a window, or a file to download. */
  | { type: 'openTab'; tabId: string; url: string; download: boolean; peek: boolean; groupLink: boolean }
  | { type: 'toolbarDirection'; tabId: string; down: boolean }
  /** A page shortcut (Command-R, Command-[ …) pressed while the page had the keys. */
  | { type: 'pageKey'; tabId: string; command: WebKitCommand }
  | { type: 'reopenTab'; tabId: string }
  | { type: 'pageError'; tabId: string; message: string };

type Subscription = { remove(): void };
type NativeWebKit = {
  load(tabId: string, url: string, ephemeral: boolean, data: string): Promise<void>;
  removeData(data: string): Promise<void>;
  command(tabId: string, command: WebKitCommand): Promise<void>;
  focus(tabId: string): Promise<void>;
  close(tabId: string): Promise<void>;
  privateWindow(windowId: string, open: boolean): Promise<void>;
  autoPip(on: boolean): Promise<void>;
  addListener(name: string, listener: (body: Record<string, unknown>) => void): Subscription;
};

let native: NativeWebKit | undefined;
const module = () => (native ??= requireNativeModule<NativeWebKit>('MerlinWebKit'));

/** `data` is the tab's space data (Snapshot.data), whose WebKit store the page uses; "" keeps the page's own. */
export const loadWebKitPage = (tabId: string, url: string, ephemeral: boolean, data = '') => module().load(tabId, url, ephemeral, data);
/** A space's data was deleted: its WebKit pages close and its store goes. */
export const removeWebKitData = (data: string) => module().removeData(data);
export const webKitCommand = (tabId: string, command: WebKitCommand) => module().command(tabId, command);
export const focusWebKitPage = (tabId: string) => module().focus(tabId);
export const closeWebKitPage = (tabId: string) => module().close(tabId);
/** A private window opened or closed: WebKit's private session ends with the last one. */
export const setPrivateWindow = (windowId: string, open: boolean) => module().privateWindow(windowId, open);
/** Settings › General › Float videos when you switch tabs, for WebKit's pages as for Chromium's. */
export const setWebKitAutoPip = (on: boolean) => module().autoPip(on);

const commands: readonly string[] = ['back', 'forward', 'reload', 'reloadFromOrigin', 'stop'];
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const optional = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** Checks what the native side sent; anything malformed is dropped. */
export function parseWebKitEvent(name: string, body: Record<string, unknown>): WebKitEvent | null {
  const tabId = str(body.tabId);
  if (!tabId) return null;
  switch (name) {
    case 'pageState': return { type: 'pageState', state: {
      tabId, url: str(body.url), title: str(body.title), loading: body.loading === true, canGoBack: body.canGoBack === true,
      canGoForward: body.canGoForward === true, crashed: body.crashed === true,
      color: optional(body.color), surface: optional(body.surface), favicon: optional(body.favicon),
    } };
    case 'openTab': return body.url && typeof body.url === 'string' ? { type: 'openTab', tabId, url: body.url, download: body.download === true, peek: body.peek === true, groupLink: body.groupLink === true } : null;
    case 'toolbarDirection': return { type: 'toolbarDirection', tabId, down: body.down === true };
    case 'pageKey': return commands.includes(str(body.command)) ? { type: 'pageKey', tabId, command: str(body.command) as WebKitCommand } : null;
    case 'reopenTab': return { type: 'reopenTab', tabId };
    case 'pageError': return { type: 'pageError', tabId, message: str(body.message) || 'This page could not be opened.' };
    default: return null;
  }
}

/** Every page's events, for the whole app (all windows share one bridge). */
export function subscribeWebKit(listener: (event: WebKitEvent) => void): () => void {
  const subscriptions = (['pageState', 'openTab', 'pageKey', 'pageError', 'toolbarDirection'] as const).map(name =>
    module().addListener(name, body => {
      const event = parseWebKitEvent(name, body ?? {});
      if (event) listener(event);
    }));
  return () => subscriptions.forEach(s => s.remove());
}

export type WebKitPageViewProps = ViewProps & { tabId: string; active: boolean };
let View: ComponentType<WebKitPageViewProps> | undefined;
/** Shows a tab's WebKit page; the page lives on when this unmounts. */
export function WebKitPageView(props: WebKitPageViewProps) {
  View ??= requireNativeViewManager<WebKitPageViewProps>('MerlinWebKit');
  return createElement(View, props);
}
