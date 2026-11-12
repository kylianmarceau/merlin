import React, { useEffect } from 'react';
import { useStore } from 'zustand';
import { Box, Text, ThemeScope } from './components/ui';
import { BrowserWindow } from './components/window/BrowserWindow';
import { PopupWindow } from './components/window/PopupWindow';
import { loadShellPrefs } from './state/shellPrefsStorage';
import { useWindowConnection, WindowProvider } from './state/window';

const fallbackAppearance = { mode: 'system', accent: 'fern', reduceMotion: false } as const;

/** One React root per Chromium window; the native host passes its ID. */
export function App({ windowId }: { windowId: string }) {
  const { store, actions } = useWindowConnection(windowId);
  useEffect(loadShellPrefs, []);
  const snapshot = useStore(store, s => s.snapshot);
  const error = useStore(store, s => s.connectionError);
  return <ThemeScope appearance={snapshot?.appearance ?? fallbackAppearance}>
    {actions && snapshot ? <WindowProvider store={store} actions={actions}>
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
