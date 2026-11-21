import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, ScrollView, StyleSheet, View } from 'react-native';
import { useActions, useSnapshot } from '../../state/window';
import { PageArea } from '../window/PageArea';
import {
  Button, DragRegion, Icon, KeyCap, Pressable, Text, WelcomeFilm, accentLabel, accentSwatch, accents, geometry,
  guideArt, leaveGuide, radius, space, useGuideTurn, useInteraction, useTheme, type SymbolName,
} from '../ui';
import { Lookout, WorkspacePreview, cue } from './WorkspacePreview';

const poster = require('./night-watch-poster.jpg');
const stages = ['intro', 'appearance', 'workspace', 'practice', 'ready'] as const;
type Stage = typeof stages[number];
type Page = Exclude<Stage, 'intro'>;
const titles = { appearance: 'Appearance', workspace: 'Workspace', practice: 'Keyboard guide', ready: 'Finish' };
const modes = [
  { value: 'system', label: 'System', detail: 'Follow your Mac', icon: 'rectangle.lefthalf.filled' },
  { value: 'light', label: 'Light', detail: 'Always light', icon: 'sun.max' },
  { value: 'dark', label: 'Dark', detail: 'Always dark', icon: 'moon' },
] as const;
const layouts = [
  { value: 'side', label: 'In the sidebar', icon: 'sidebar.left' },
  { value: 'top', label: 'Across the top', icon: 'rectangle.topthird.inset.filled' },
] as const;
const fill = StyleSheet.absoluteFillObject;

function RadioRow({ label, detail, icon, selected, onPress }: {
  label: string; detail?: string; icon: SymbolName; selected: boolean; onPress(): void;
}) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = useInteraction();
  return <Pressable accessibilityRole="radio" accessibilityLabel={detail ? label + ', ' + detail : label}
    accessibilityState={{ selected }} onPress={onPress} {...handlers}
    style={{ minHeight: geometry.rowTall, paddingVertical: space.sm, paddingHorizontal: space.md, flexDirection: 'row',
      alignItems: 'center', gap: space.md, borderRadius: radius.control, borderWidth: geometry.hairline,
      backgroundColor: selected ? colors.accentSoft : hovered ? colors.fillHover : colors.contentBackground,
      borderColor: focused ? colors.focusRing : selected ? colors.accent : colors.borderDefault }}>
    <Icon name={icon} tone={selected ? 'accent' : 'iconSecondary'} />
    <Text variant="bodyStrong">{label}</Text>
    <View style={{ flex: 1 }} />
    {detail && <Text variant="caption" lines={1}>{detail}</Text>}
    <View style={{ width: geometry.iconSmall, height: geometry.iconSmall, borderRadius: radius.pill,
      alignItems: 'center', justifyContent: 'center', borderWidth: geometry.hairline,
      borderColor: selected ? colors.accent : colors.borderDefault }}>
      {selected && <View style={{ width: geometry.dot, height: geometry.dot, borderRadius: radius.pill, backgroundColor: colors.accent }} />}
    </View>
  </Pressable>;
}

function Heading({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return <View style={{ gap: space.sm }}>
    <Text variant="display" accessibilityRole="header" style={{ letterSpacing: guideArt.tracking }}>{title}</Text>
    <Text variant="callout" tone="textSecondary">{children}</Text>
  </View>;
}

function Choices({ page, onError }: { page: Exclude<Page, 'practice'>; onError(): void }) {
  const actions = useActions();
  const { appearance, modal } = useSnapshot();
  const { colors, dark } = useTheme();
  if (page === 'appearance') return <>
    <Heading title="Light or dark?">Choose how Merlin looks on this Mac.</Heading>
    <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={{ gap: space.xs }}>
      {modes.map(mode => <RadioRow key={mode.value} {...mode} selected={mode.value === appearance.mode}
        onPress={() => { void actions.setAppearance({ mode: mode.value }).then(ok => { if (!ok) onError(); }); }} />)}
    </View>
  </>;
  if (page === 'ready') return <>
    <Heading title="Welcome aboard.">Your workspace is ready. Start with a fresh tab or bring your bookmarks along.</Heading>
    <View style={{ gap: space.md }}>
      {([['⌘ T', 'Open a new tab'], ['⌘ L', 'Search or enter an address']] as const).map(([key, label]) =>
        <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}><KeyCap>{key}</KeyCap><Text>{label}</Text></View>)}
    </View>
    <Text variant="caption">Replay the guide in Help › Keyboard Tutorial.</Text>
  </>;
  return <>
    <Heading title="Where do your tabs go?">Pick a layout and a colour for your workspace.</Heading>
    <View accessibilityRole="radiogroup" accessibilityLabel="Tab placement" style={{ gap: space.xs }}>
      {layouts.map(layout => <RadioRow key={layout.value} {...layout} selected={layout.value === (modal.tabLayout === 'top' ? 'top' : 'side')}
        onPress={() => { void actions.request('settings.set', { key: 'tabs', value: layout.value }).catch(onError); }} />)}
    </View>
    <View style={{ gap: space.sm }}>
      <Text variant="label">Workspace colour · {accentLabel(appearance.accent)}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Workspace colour" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {accents.map(name => {
          const selected = appearance.accent === name;
          return <Pressable key={name} accessibilityRole="radio" accessibilityLabel={accentLabel(name)} accessibilityState={{ selected }}
            onPress={() => void actions.setAppearance({ accent: name }).then(ok => { if (!ok) onError(); })}
            style={{ padding: space.hair, borderRadius: radius.pill, borderWidth: geometry.hairline, borderColor: selected ? colors.textPrimary : colors.fillTransparent }}>
            <View style={{ width: geometry.iconLarge, height: geometry.iconLarge, borderRadius: radius.pill, backgroundColor: accentSwatch(dark ? 'dark' : 'light', name).fill,
              alignItems: 'center', justifyContent: 'center' }}>{selected && <Icon name="checkmark" size="small" tone="textOnAccent" />}</View>
          </Pressable>;
        })}
      </View>
    </View>
  </>;
}

export function Welcome({ stage }: { stage: Stage }) {
  const actions = useActions();
  const snapshot = useSnapshot();
  const { colors, dark, reduceMotion } = useTheme();
  const canvas = dark ? colors.contentBackground : guideArt.paper;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState('');
  const [replay, setReplay] = useState(false);
  const [take, setTake] = useState(0);
  const [muted, setMuted] = useState(false);
  const current = replay ? 'intro' : stage;
  const pending = useRef(false);
  const exit = useRef(new Animated.Value(0)).current;
  const onError = useCallback(() => setError('That change didn’t go through. Please try again.'), []);
  const advance = useCallback(async (next: Parameters<typeof actions.advanceWelcome>[0]) => {
    if (pending.current) return;
    pending.current = true;
    setError('');
    try {
      if (next === 'browse' || next === 'import') await leaveGuide(exit, reduceMotion);
      if (!await actions.advanceWelcome(next)) { exit.setValue(0); onError(); }
    } finally { pending.current = false; }
  }, [actions, exit, onError, reduceMotion]);
  const finishFilm = useCallback(() => {
    if (replay) setReplay(false);
    else if (stage === 'intro') void advance('appearance');
  }, [advance, replay, stage]);
  useEffect(() => {
    if (current === 'intro' && reduceMotion) finishFilm();
    if (stage === 'practice' && !snapshot.welcomeTabId) void advance('tutorial');
  }, [current, stage, snapshot.welcomeTabId, advance, reduceMotion, finishFilm]);
  const { outgoing, direction, progress } = useGuideTurn(current, stages, reduceMotion);
  const compact = size.width < guideArt.compact;
  const width = Math.min(guideArt.width, Math.max(0, size.width - (compact ? space.xl : space.huge * 2)));
  const height = Math.min(guideArt.height, Math.max(0, size.height - (compact ? space.xl : geometry.titlebar * 2)));
  const showPreview = !compact || height >= geometry.sheetHeight;
  const fromIntro = outgoing === 'intro';
  const content = (page: Page, leaving: boolean) => {
    const travel = (compact ? width : width * .42) * direction;
    return <Animated.View key={page} accessibilityElementsHidden={leaving} pointerEvents={leaving ? 'none' : 'auto'}
      style={[fill, { backgroundColor: canvas,
        opacity: leaving ? cue(progress, 0, .7, 1, 0) : cue(progress, 0, .65),
        transform: [{ translateX: leaving ? cue(progress, 0, 1, 0, -travel * .45) : cue(progress, 0, 1, fromIntro ? 0 : travel * .64, 0) }] }]}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: space.xl, paddingVertical: space.md, paddingHorizontal: space.hair }}>
        {page !== 'practice' && <Choices page={page} onError={onError} />}
      </ScrollView>
    </Animated.View>;
  };
  const intro = current === 'intro';
  return <View onLayout={e => { const { width, height } = e.nativeEvent.layout; setSize({ width, height }); }}
    style={{ flex: 1, backgroundColor: canvas, justifyContent: 'center', alignItems: 'center' }}>
    <DragRegion style={fill} />
    {(intro || fromIntro) && !reduceMotion && <Animated.View accessibilityElementsHidden={!intro} pointerEvents={intro ? 'auto' : 'none'}
      style={[fill, { opacity: intro ? 1 : cue(progress, 0, .9, 1, 0) }]}>
      <Image accessible={false} source={poster} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
      <WelcomeFilm key={take} accessible accessibilityRole="image" accessibilityLabel="Night Watch, an aurora above the Merlin observatory" style={fill} soundEnabled={intro && !muted} onFinished={finishFilm} />
      <DragRegion style={fill} />
      <View style={{ position: 'absolute', left: space.xl, right: space.xl, bottom: space.xl,
        flexDirection: 'row', justifyContent: 'space-between' }} pointerEvents="box-none">
        <Button label={muted ? 'Unmute' : 'Mute'} accessibilityLabel={muted ? 'Unmute intro sound' : 'Mute intro sound'}
          icon={muted ? 'speaker.slash' : 'speaker.wave.2'} variant="secondary" onPress={() => setMuted(value => !value)} />
        <Button label="Skip intro" variant="secondary" onPress={finishFilm} />
      </View>
    </Animated.View>}
    {!intro && <Animated.View style={{ width, height, opacity: Animated.multiply(fromIntro ? cue(progress, .16, 1) : 1, cue(exit, 0, 1, 1, 0)),
      transform: [{ translateY: fromIntro ? cue(progress, 0, 1, space.lg, 0) : 0 }] }}>
      <View style={{ minHeight: geometry.paletteInput, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md }}>
        <View accessible accessibilityLabel={`Step ${stages.indexOf(current)} of 4, ${titles[current]}`} style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            {stages.slice(1).map((s, i) => <View key={s} style={{ width: geometry.controlLarge, height: space.hair, borderRadius: radius.pill,
              backgroundColor: i < stages.indexOf(current) ? colors.accent : colors.borderDefault }} />)}
          </View>
          <Text variant="label" tone="textSecondary">{titles[current]} · {stages.indexOf(current)} of 4</Text>
        </View>
        {current === 'appearance' && !reduceMotion && <Button icon="play" label="Replay intro" variant="ghost" onPress={() => { setTake(n => n + 1); setReplay(true); }} />}
        {current === 'practice' && <Button label="Skip practice" variant="ghost" onPress={() => void advance('ready')} />}
      </View>
      {current === 'practice' ? <View style={{ flex: 1, overflow: 'hidden', borderRadius: radius.panel }}>
        <Animated.View style={[fill, { transform: [{ translateX: cue(progress, 0, 1, width * .34, 0) }], opacity: cue(progress, 0, .65) }]}>
          {snapshot.welcomeTabId && snapshot.welcomeTabId === snapshot.activeTabId ? <PageArea /> :
            <Button label="Return to the lesson" onPress={() => void advance('tutorial')} />}
        </Animated.View>
      </View> : <View style={{ flex: 1, flexDirection: compact ? 'column-reverse' : 'row', gap: compact ? space.md : space.huge }}>
        <View style={{ flex: 1, overflow: 'hidden' }}>
          {outgoing && outgoing !== 'intro' && outgoing !== 'practice' && outgoing !== current && content(outgoing, true)}
          {content(current, false)}
        </View>
        {showPreview && <View style={compact ? { height: geometry.switcherThumb + space.xl } : { flex: 1.38 }}>
          {current === 'ready' ? <Lookout /> : <WorkspacePreview compact={compact} />}
        </View>}
      </View>}
      {!!error && <Text align="center" tone="textDanger">{error}</Text>}
      <View style={{ minHeight: geometry.paletteInput, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {current !== 'practice' && <Button label={current === 'appearance' ? 'Continue' : current === 'workspace' ? 'Try the field guide' : 'Start browsing'}
          variant="primary" size="large" trailingIcon="arrow.right"
          onPress={() => void advance(current === 'appearance' ? 'workspace' : current === 'workspace' ? 'tutorial' : 'browse')} />}
        {current === 'appearance' ? <Button label="Skip setup" variant="ghost" onPress={() => void advance('browse')} /> :
          current === 'ready' ? <Button label="Import bookmarks…" variant="ghost" onPress={() => void advance('import')} /> :
          <Button label="Back" variant="ghost" icon="chevron.left" onPress={() => void advance(current === 'practice' ? 'workspace' : 'appearance')} />}
      </View>
    </Animated.View>}
  </View>;
}
