import React from 'react';
import { Animated, View } from 'react-native';
import { displayHost } from '../../lib/format';
import { useActions, useSnapshot } from '../../state/window';
import { Button, Icon, IconButton, Panel, Spinner, Text, geometry, presenceStyle, space, useLatest, usePresence, useTheme, Pressable } from '../ui';
import { Page } from './Page';

const cover = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

/**
 * Peek: a link (the `gf` hint, `:peek`) in a card floating over the dimmed
 * page, read without leaving the tab. Escape, the close button or a press
 * outside dismiss it; Open in Tab (⌘↩) keeps the page as a tab beside the
 * current one. Chromium closes it when the tab changes.
 */
export function PeekOverlay() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const { colors, reduceMotion } = useTheme();
  const peek = snapshot.peek ?? null;
  const { mounted, progress } = usePresence(!!peek, 'dialog', reduceMotion);
  const shown = useLatest(peek);
  if (!mounted || !shown) return null;
  const host = displayHost(shown.url);
  const title = shown.title || host || 'Loading…';
  return <View style={[cover, { alignItems: 'center', justifyContent: 'center' }]}>
    <Animated.View style={[cover, { opacity: progress }]}>
      <Pressable accessible={false} style={{ flex: 1, backgroundColor: colors.scrim }} onPress={() => { if (peek) void actions.closePeek(); }} />
    </Animated.View>
    <Animated.View style={[{ width: '84%', height: '88%' }, presenceStyle(progress, 'dialog')]}
      keyDownEvents={[{ key: 'Escape' }]} onKeyDown={e => { if (e.nativeEvent.key === 'Escape' && peek) void actions.closePeek(); }}>
      <Panel fill="surfaceDialog" radius="dialog" elevation="dialog" accessibilityLabel={`Peek: ${title}`} accessibilityViewIsModal
        style={{ flex: 1 }}>
        <View style={{ height: geometry.peekHeader, flexDirection: 'row', alignItems: 'center', gap: space.sm,
          paddingLeft: space.md + space.xs, paddingRight: space.sm }}>
          <View style={{ width: geometry.icon, alignItems: 'center' }}>
            {shown.loading ? <Spinner /> : <Icon name="globe" tone="iconSecondary" size="small" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text weight="medium" lines={1}>{title}</Text>
            {!!host && host !== title && <Text variant="caption" tone="textSecondary" lines={1}>{host}</Text>}
          </View>
          <Button label="Open in Tab" size="small" icon="arrow.up.forward.app" onPress={() => void actions.promotePeek()} />
          <IconButton label="Close Peek" icon="xmark" onPress={() => void actions.closePeek()} />
        </View>
        {/* Inset so the page's corners (rounded by Chromium, merlin_shell_bridge_mac.mm) sit inside the card's. */}
        <View style={{ flex: 1, marginHorizontal: space.sm, marginBottom: space.sm, backgroundColor: colors.contentBackground }}>
          <Page tabId="peek" style={{ flex: 1 }} />
        </View>
      </Panel>
    </Animated.View>
  </View>;
}
