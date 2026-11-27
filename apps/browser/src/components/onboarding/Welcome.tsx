import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import type { Snapshot } from '../../state/types';
import { useActions, useSnapshot } from '../../state/window';
import { PageArea } from '../window/PageArea';
import { Button, DragRegion, Panel, Text, WelcomeFilm, geometry, radius, setupGeometry, space, useGuideTurn, useTheme } from '../ui';
import { SetupWizard } from './SetupWizard';

const poster = require('./lighthouse-poster.jpg');
const fill = StyleSheet.absoluteFillObject;
const phases = ['intro', 'setup', 'practice', 'ready'] as const;
type Stage = Exclude<Snapshot['welcome'], '' | undefined>;

export function Welcome({ stage }: { stage: Stage }) {
  const actions = useActions();
  const snapshot = useSnapshot();
  const { colors, reduceMotion } = useTheme();
  const [replay, setReplay] = useState(false);
  const [take, setTake] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const raw = stage === 'appearance' || stage === 'workspace' ? 'setup' : stage;
  const current = replay ? 'intro' : raw;
  const { outgoing, progress } = useGuideTurn(current, phases, reduceMotion);
  const pendingFilm = current === 'intro' || outgoing === 'intro';

  const advance = useCallback(async (next: Parameters<typeof actions.advanceWelcome>[0]) => {
    if (busy.current) return;
    busy.current = true;
    setError('');
    try {
      if (!await actions.advanceWelcome(next)) setError('Merlin couldn’t move to the next screen. Please try again.');
    } finally {
      busy.current = false;
    }
  }, [actions]);

  const finishFilm = useCallback(() => {
    if (replay) setReplay(false);
    else if (stage === 'intro') void advance('setup');
  }, [advance, replay, stage]);

  useEffect(() => {
    if (current === 'intro' && reduceMotion) finishFilm();
    if (stage === 'practice' && !snapshot.welcomeTabId) void advance('tutorial');
  }, [current, stage, snapshot.welcomeTabId, advance, reduceMotion, finishFilm]);

  return <View style={{ flex: 1, backgroundColor: colors.windowBackground }}>
    <DragRegion style={fill} />
    {raw === 'setup' && <View accessibilityElementsHidden={replay} pointerEvents={replay ? 'none' : 'auto'} style={fill}>
      <SetupWizard replayIntro={reduceMotion ? undefined : () => { setTake(n => n + 1); setReplay(true); }} />
    </View>}
    {current === 'practice' && <View style={{ flex: 1, paddingTop: geometry.paletteRow, paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="title" accessibilityRole="header">Merlin keyboard guide</Text>
        <Button label="Skip practice" variant="ghost" onPress={() => void advance('ready')} />
      </View>
      <View style={{ flex: 1, overflow: 'hidden', borderRadius: radius.panel }}>
        {snapshot.welcomeTabId && snapshot.welcomeTabId === snapshot.activeTabId ? <PageArea /> :
          <Button label="Return to the lesson" onPress={() => void advance('tutorial')} />}
      </View>
    </View>}
    {current === 'ready' && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
      <Panel fill="contentBackground" border="borderDefault" elevation="card" style={{ width: '100%', maxWidth: geometry.dialogWide, padding: space.xxl, gap: space.lg }}>
        <Text variant="display" accessibilityRole="header">Welcome aboard</Text>
        <Text>The keyboard guide is always available in Help › Keyboard Tutorial.</Text>
        <Button label="Start browsing" variant="primary" onPress={() => void advance('browse')} />
        <Button label="Import bookmarks…" variant="ghost" onPress={() => void advance('import')} />
      </Panel>
    </View>}
    {pendingFilm && !reduceMotion && <Animated.View accessibilityElementsHidden={current !== 'intro'}
      pointerEvents={current === 'intro' ? 'auto' : 'none'}
      style={[fill, { opacity: current === 'intro' ? 1 : progress.interpolate({ inputRange: [0, .9, 1], outputRange: [1, 0, 0] }) }]}>
      <Image accessible={false} source={poster} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
      <WelcomeFilm key={take} accessible accessibilityRole="image" accessibilityLabel="Lighthouse Point, a lighthouse sweeping its beam over the sea at dusk as a falcon flies in"
        style={fill} soundEnabled={current === 'intro' && !muted} onFinished={finishFilm} />
      <DragRegion style={fill} />
      <View style={{ position: 'absolute', left: space.xl, right: space.xl, bottom: space.xl,
        flexDirection: 'row', justifyContent: 'space-between' }} pointerEvents="box-none">
        <Button label={muted ? 'Unmute' : 'Mute'} accessibilityLabel={muted ? 'Unmute intro sound' : 'Mute intro sound'}
          icon={muted ? 'speaker.slash' : 'speaker.wave.2'} variant="secondary" onPress={() => setMuted(value => !value)} />
        <Button label="Skip intro" variant="secondary" onPress={finishFilm} />
      </View>
    </Animated.View>}
    {!!error && <View style={{ position: 'absolute', bottom: setupGeometry.filmNoticeBottom, alignSelf: 'center', padding: space.sm, backgroundColor: colors.contentBackground }}>
      <Text tone="textDanger">{error}</Text>
    </View>}
  </View>;
}
