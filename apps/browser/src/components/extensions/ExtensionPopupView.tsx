import React from 'react';
import { View } from 'react-native';
import type { ExtensionPopup } from '../../state/types';
import { Page } from '../page/Page';
import { Spinner, useTheme } from '../ui';

/**
 * An extension's own popup page, in place under its toolbar button. Chromium
 * sizes the page to its content; the popover follows. It stays hidden until
 * its first load so it does not visibly resize.
 */
export function ExtensionPopupView({ popup }: { popup: ExtensionPopup }) {
  const { colors } = useTheme();
  return <View accessibilityLabel={popup.name} style={{ width: popup.width, height: popup.height, backgroundColor: colors.contentBackground }}>
    <Page tabId="extension-popup" style={{ width: popup.width, height: popup.height, opacity: popup.ready ? 1 : 0 }} />
    {!popup.ready && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
      <Spinner />
    </View>}
  </View>;
}
