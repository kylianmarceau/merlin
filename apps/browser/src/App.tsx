import React, { useEffect } from 'react';
import { useStore } from 'zustand';
import { Box, Text, ThemeScope } from './components/ui';
import { BrowserWindow } from './components/window/BrowserWindow';
import { FailForTest, InterfaceBoundary } from './components/window/InterfaceBoundary';
import { PopupWindow } from './components/window/PopupWindow';
import { loadShellPrefs } from './state/shellPrefsStorage';
import { useGlassLook } from './state/glass';
import { useWindowConnection, WindowProvider } from './state/window';

const fallbackAppearance = { mode: 'system', accent: 'fern', reduceMotion: false } as const;

/**
 * One React root per Chromium window; the native host passes its ID. A
 * failure while drawing the window stops at its InterfaceBoundary, which
 * offers to start the window's interface again.
 */
export function App({ windowId }: { windowId: string }) {
  return <InterfaceBoundary windowId={windowId}><Window windowId={windowId} /></InterfaceBoundary>;
}

function Window({ windowId }: { windowId: string }) {
  const { store, actions, engine } = useWindowConnection(windowId);
  useEffect(loadShellPrefs, []);
  const snapshot = useStore(store, s => s.snapshot);
  const error = useStore(store, s => s.connectionError);
  const glass = useGlassLook();
  // Chromium logs, and tests read, that the window has drawn from the browser's state.
  const shown = !!snapshot;
  useEffect(() => {
    if (shown && engine) void engine.call('shell.report', { state: 'ready' }).catch(() => undefined);
  }, [shown, engine]);
  return <ThemeScope appearance={snapshot?.appearance ?? fallbackAppearance} glass={glass}>
    {actions && snapshot ? <WindowProvider store={store} actions={actions}>
      <FailForTest />
      {snapshot.kind === 'popup' ? <PopupWindow /> : <BrowserWindow />}
    </WindowProvider> : <Startup error={error} />}
  </ThemeScope>;
}

function Startup({ error }: { error: string | null }) {
  return <Box flex={1} fill="windowBackground" pad="xxl" justify="center" gap="md">
    <Text variant="display">Merlin</Text>
    <Text tone="textSecondary">{error ? 'The browser engine could not start.' : 'Opening your window…'}</Text>
    {!!error && <Text variant="caption" selectable>{error}</Text>}
  </Box>;
}
