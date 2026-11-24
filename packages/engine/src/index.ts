import { createElement, type ComponentType } from 'react';
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { ViewProps } from 'react-native';
import { EngineClient, parseEngineEvent, type EngineEvent, type Transport } from './protocol';
export * from './protocol';

type NativeEngine = {
  call(windowId: string, method: string, args: string): Promise<string>;
  setupImportProfiles(browser: string): Promise<SetupImportProfile[]>;
  setupImport(windowId: string, browser: string, profile: string, categories: string[]): Promise<SetupImportResult[]>;
  addListener(name: 'browserEvent', listener: (event: { json: string }) => void): { remove(): void };
};

export type SetupImportProfile = { id: string; name: string };
export type SetupImportResult = { category: string; count: number; skipped?: number; error?: string };

export function setupImportProfiles(browser: string) {
  return requireNativeModule<NativeEngine>('MerlinEngine').setupImportProfiles(browser);
}

export function importSetupProfile(windowId: string, browser: string, profile: string, categories: string[]) {
  return requireNativeModule<NativeEngine>('MerlinEngine').setupImport(windowId, browser, profile, categories);
}

export async function openSetupImportTool(windowId: string, category: 'passwords' | 'bookmarks') {
  const reply = JSON.parse(await requireNativeModule<NativeEngine>('MerlinEngine')
    .call(windowId, 'setup.openImportTool', JSON.stringify({ category })));
  if (!reply.ok) throw new Error(reply.error || 'Merlin couldn’t open the file importer.');
}

/**
 * `onParse`, for timing traces: how long each event took to parse and check,
 * and its size. Every window's listener parses every event.
 */
export function connectEngine(windowId: string, onParse?: (ms: number, bytes: number) => void): EngineClient {
  // A missing engine is an integration error, never a reason to invent browser state.
  const native = requireNativeModule<NativeEngine>('MerlinEngine');
  const transport: Transport = {
    call: (id, method, args) => native.call(id, method, args),
    subscribe: listener => {
      const subscription = native.addListener('browserEvent', event => {
        let parsed: EngineEvent;
        const start = onParse ? performance.now() : 0;
        try { parsed = parseEngineEvent(event.json); }
        catch { parsed = { type: 'engine.error', windowId, message: 'The browser sent an invalid state update.' }; }
        onParse?.(performance.now() - start, event.json.length);
        listener(parsed);
      });
      return () => subscription.remove();
    },
  };
  return new EngineClient(windowId, transport);
}

export type PageViewProps = ViewProps & { windowId: string; tabId: string };
let Page: ComponentType<PageViewProps> | undefined;
/** A tab's web page, or the window's extension popup ("extension-popup"). */
export function PageView(props: PageViewProps) {
  Page ??= requireNativeViewManager<PageViewProps>('MerlinEngine', 'Page');
  return createElement(Page, props);
}
