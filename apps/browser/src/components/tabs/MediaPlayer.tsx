import React, { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { displayHost } from '../../lib/format';
import { keepDismissed, mediaPlaying, playerTab } from '../../state/mediaPlayer';
import type { Tab } from '../../state/types';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { Favicon } from '../favicon/Favicon';
import {
  Equaliser, Fade, GlassFill, IconButton, Panel, Pressable, Text, geometry, presenceStyle, radius, space, useEased, useLatest, usePresence, useTheme,
} from '../ui';
import { tabTitle } from './TabRow';

/**
 * A small player at the foot of the sidebar, as Dia's is, for media playing
 * (or paused) in a tab you have left: its track and site, and play, pause
 * and skip as the page's own controls would. Pressing it goes to the tab;
 * its × puts it away until that tab plays again. From an engine that doesn't
 * describe media it shows the sounding tab with its mute button instead.
 */
export function MediaPlayer() {
  const snapshot = useSnapshot();
  const recent = useBrowser(s => s.recentTabs);
  const { reduceMotion } = useTheme();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  // Whether each tab played at the last snapshot, so a dismissal ends when it starts again.
  const was = useRef(new Map<string, boolean>());
  useEffect(() => {
    setDismissed(old => {
      if (!old.size) return old;
      const next = keepDismissed(old, snapshot.tabs, was.current);
      return next.size === old.size ? old : next;
    });
    was.current = new Map(snapshot.tabs.map(t => [t.id, mediaPlaying(t)]));
  }, [snapshot.tabs]);
  const tab = playerTab(snapshot.tabs, snapshot.activeTabId, recent, dismissed);
  const { mounted, progress } = usePresence(!!tab, 'mediaPlayer', reduceMotion);
  // The tab stays on the card while it goes.
  const shown = useLatest(tab);
  if (!mounted || !shown) return null;
  return <Animated.View style={presenceStyle(progress, 'mediaPlayer')}>
    <Player tab={shown} onDismiss={() => setDismissed(old => new Set(old).add(shown.id))} />
  </Animated.View>;
}

function Player({ tab, onDismiss }: { tab: Tab; onDismiss(): void }) {
  const actions = useActions();
  const { colors, reduceMotion, glass } = useTheme();
  const [hovered, setHovered] = useState(false);
  const closeShown = useEased(hovered, reduceMotion);
  const media = tab.media;
  const page = tabTitle(tab);
  const title = media?.title || page;
  const detail = media?.artist || tab.displayHost || displayHost(tab.url);
  const playing = mediaPlaying(tab);
  const control = (action: 'play' | 'pause' | 'next' | 'previous') => () => void actions.mediaTab(tab.id, action);
  return <View onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    style={{ flexDirection: 'row', alignItems: 'center', borderRadius: radius.row, minHeight: geometry.tabRow + space.md }}>
    {glass.on ? <GlassFill radius={radius.row} state={hovered ? 'lit' : 'rest'} />
      : <Panel fill="tabActive" radius="row" border="tabActiveBorder" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} />}
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}${media?.artist ? `, ${media.artist}` : ''}, ${
      playing ? 'playing' : 'paused'} in ${page}. Go to tab`}
      onPress={() => { actions.closeHoverCard(); void actions.activateTab(tab.id); }}
      style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm + space.hair,
        paddingLeft: space.sm + space.hair, paddingVertical: space.xs, borderRadius: radius.row,
        backgroundColor: colors[pressed ? 'tabPressed' : 'fillTransparent'] })}>
      <Favicon tab={tab} />
      <Fade style={{ flex: 1 }}>
        <View style={{ width: geometry.titleRun }}>
          <Text lines={1} ellipsizeMode="clip" tone="tabTextActive" weight="medium">{title}</Text>
          <Text lines={1} ellipsizeMode="clip" variant="caption" tone="textSecondary">{detail}</Text>
        </View>
      </Fade>
    </Pressable>
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: space.xs }}>
      {media ? <>
        {media.canPrevious && <IconButton label="Previous track" icon="backward.fill" size="small" tone="iconSecondary"
          onPress={control('previous')} />}
        <IconButton label={media.playing ? 'Pause' : 'Play'} icon={media.playing ? 'pause.fill' : 'play.fill'} size="small"
          tone="iconPrimary" onPress={control(media.playing ? 'pause' : 'play')} />
        {media.canNext && <IconButton label="Next track" icon="forward.fill" size="small" tone="iconSecondary" onPress={control('next')} />}
      </> : <IconButton label={tab.muted ? `Unmute ${page}` : `Mute ${page}`} tip={tab.muted ? 'Unmute tab' : 'Mute tab'}
        icon={tab.muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} size="small" tone="iconSecondary"
        art={tab.muted ? undefined : <Equaliser playing={tab.audible} />} onPress={() => void actions.muteTab(tab.id, !tab.muted)} />}
      {/* Its × keeps its place and shows on hover, as a tab's does. */}
      <Animated.View pointerEvents={hovered ? 'auto' : 'none'} style={{ opacity: closeShown }}>
        <IconButton label="Hide player" tip={false} icon="xmark" size="small" onPress={onDismiss} />
      </Animated.View>
    </View>
  </View>;
}
