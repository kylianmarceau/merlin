import React, { useState } from 'react';
import { Animated, View } from 'react-native';
import { awayFromHome } from '../../state/pinned';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { IconButton, Panel, Text, geometry, space, useHoverCardMotion, useLatest, useTheme } from '../ui';
import { tabTitle } from './TabRow';

/**
 * The card beside a tab the pointer rests on, as in Dia and Ardia: its whole
 * title, its address, and what can be done to it in one press (pin,
 * bookmark, split, mute; for a pinned tile that has wandered off, the way
 * back). Beside a sidebar row it opens to the right; under a tab across the
 * top or a pinned tile, below. It stays while the pointer is on it. It
 * arrives as Dia's does, fading in while it grows from 0.92 out of its
 * corner nearest the tab; moving to the next tab moves it there at once.
 */
export function HoverCardOverlay() {
  const card = useBrowser(s => s.hoverCard);
  const snapshot = useSnapshot();
  const actions = useActions();
  const bounds = useBrowser(s => s.windowSize);
  const homes = useBrowser(s => s.pinnedHomes);
  const { reduceMotion } = useTheme();
  const kept = useLatest(card);
  const motion = useHoverCardMotion(!!card, reduceMotion);
  const [height, setHeight] = useState(0);
  const tab = kept ? snapshot.tabs.find(t => t.id === kept.tabId) : undefined;
  if (!kept || !tab || !motion.mounted) return null;
  const { anchor } = kept;
  const width = geometry.hoverCard;
  const margin = space.sm;
  const left = kept.side === 'right'
    ? Math.min(anchor.x + anchor.width + margin, bounds.width - width - margin)
    : Math.max(margin, Math.min(anchor.x, bounds.width - width - margin));
  const wanted = kept.side === 'right' ? anchor.y - space.xs : anchor.y + anchor.height + space.xs;
  const top = Math.max(margin, Math.min(wanted, bounds.height - height - margin));
  const home = tab.pinned ? homes[tab.id] : undefined;
  const away = awayFromHome(tab, home);
  const title = tabTitle(tab);
  const address = tab.displayUrl ?? tab.url;
  const page = !!tab.url && !/^(about|chrome|merlin):/.test(tab.url);
  const act = (fn: () => unknown) => () => { actions.closeHoverCard(); void fn(); };
  return <Animated.View onMouseEnter={actions.holdHoverCard} onMouseLeave={actions.leaveTab}
    onLayout={e => setHeight(e.nativeEvent.layout.height)}
    style={{ position: 'absolute', left, top, width, opacity: motion.opacity, transformOrigin: 'left top',
      transform: [{ scale: motion.scale }] }}>
    <Panel fill="surfacePopoverSolid" radius="card" elevation="menu" accessibilityLabel={`${title}, ${address}`}
      style={{ paddingHorizontal: space.md, paddingTop: space.sm + space.hair, paddingBottom: space.xs + space.hair, gap: space.hair }}>
      <Text variant="bodyStrong" lines={2}>{title}</Text>
      {!!address && page && <Text variant="caption" tone="textSecondary" lines={1}>{address}</Text>}
      {away && home && <Text variant="caption" tone="textTertiary" lines={1}>{`Pinned on ${home.title || home.url}`}</Text>}
      {tab.discarded && <Text variant="caption" tone="textTertiary">Asleep to save memory; it reloads when you open it</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs, marginLeft: -space.xs }}>
        {away && <IconButton label="Back to pinned page" icon="arrow.uturn.backward" size="card" variant="plate" onPress={act(() => actions.returnToPinnedPage(tab.id))} />}
        <IconButton label={tab.pinned ? 'Unpin tab' : 'Pin tab'} icon={tab.pinned ? 'pin.slash' : 'pin'} size="card" variant="plate"
          onPress={act(() => actions.pinTab(tab.id, !tab.pinned))} />
        {page && <IconButton label={tab.bookmarked ? 'Remove bookmark' : 'Add to Bookmarks bar'} icon={tab.bookmarked ? 'bookmark.fill' : 'bookmark'}
          size="card" variant="plate" onPress={act(() => actions.bookmarkTab(tab.id))} />}
        {tab.id !== snapshot.activeTabId && !tab.split && <IconButton label="Open in split view" icon="rectangle.split.2x1" size="card" variant="plate"
          onPress={act(() => actions.splitTab(tab.id))} />}
        {(tab.audible || tab.muted) && <IconButton label={tab.muted ? 'Unmute tab' : 'Mute tab'}
          icon={tab.muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} size="card" variant="plate" onPress={act(() => actions.muteTab(tab.id, !tab.muted))} />}
        {page && <IconButton label="Copy link" icon="link" size="card" variant="plate" onPress={act(() => actions.copyTabLink(tab.id))} />}
      </View>
    </Panel>
  </Animated.View>;
}
