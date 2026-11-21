import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, ScrollView, StyleSheet, View } from 'react-native';
import { useActions, useSnapshot } from '../../state/window';
import { PageArea } from '../window/PageArea';
import {
  Button, DragRegion, Icon, KeyCap, Panel, Pressable, Segmented, Text, accentLabel, accentSwatch,
  accents, geometry, guideArt, leaveGuide, radius, space, useGuideSelection, useGuideTurn, useInteraction, useTheme, useWelcomeFlight,
} from '../ui';

import { Coast, PrintFan, Scene, cue, daylight, moonlight } from './PrintScene';

const stages = ['intro', 'appearance', 'workspace', 'practice', 'ready'] as const;
type Stage = typeof stages[number];
const titles = { appearance: 'Appearance', workspace: 'Workspace', practice: 'Field guide', ready: 'Finish' };
const modes = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] as const;
const layouts = [{ value: 'side', label: 'Sidebar' }, { value: 'top', label: 'Across the top' }] as const;
const fill = StyleSheet.absoluteFillObject;

function Flight({ onStart, width, height }: { onStart(): void; width: number; height: number }) {
  const { dark, reduceMotion } = useTheme();
  const t = useWelcomeFlight(reduceMotion);
  const night = useGuideSelection(dark, reduceMotion);
  const ink = dark ? guideArt.nightInk : guideArt.printInk;
  const printWidth = Math.min(guideArt.printWidth, width * .53, height * .38);
  return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md }}>
    <PrintFan time={t} width={printWidth} night={night} />
    <View style={{ alignItems: 'center', marginTop: space.md }}>
      <Animated.View style={{ opacity: cue(t, .23, .51), transform: [{ translateY: cue(t, .23, .51, space.sm, 0) }] }}>
        <Text variant="callout" style={{ color: ink }}>Welcome to</Text>
      </Animated.View>
      <View accessible accessibilityRole="header" accessibilityLabel="Merlin" style={{ flexDirection: 'row', overflow: 'hidden' }}>
        {'Merlin'.split('').map((letter, i) => {
          const start = .29 + i * .035;
          return <Animated.View key={i} accessibilityElementsHidden style={{ opacity: cue(t, start, start + .2),
            transform: [{ translateY: cue(t, start, start + .22, space.xxl, 0) }] }}>
            <Text variant="greeting" style={{ color: ink, fontSize: guideArt.logotypeSize, lineHeight: guideArt.logotypeLine,
              letterSpacing: guideArt.tracking }}>{letter}</Text>
          </Animated.View>;
        })}
      </View>
    </View>
    <Animated.View style={{ marginTop: space.sm, transform: [{ translateY: cue(t, .45, .82, space.sm, 0) }],
      opacity: cue(t, .45, .82, .6, 1) }}>
      <Button label="Get started" variant="primary" size="large" trailingIcon="arrow.right" onPress={onStart} />
    </Animated.View>
  </View>;
}

function ModeTile({ mode, selected, onPress }: { mode: typeof modes[number]; selected: boolean; onPress(): void }) {
  const { colors, reduceMotion } = useTheme();
  const { hovered, focused, handlers } = useInteraction();
  const lift = useGuideSelection(hovered || focused || selected, reduceMotion);
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={mode.label}
    onPress={onPress} {...handlers} style={{ flex: 1, maxWidth: geometry.switcherThumb, minWidth: geometry.paletteInput }}>
    <Animated.View style={{ borderWidth: geometry.focusRing, borderColor: focused ? colors.focusRing : selected ? colors.accent : colors.borderDefault,
      borderRadius: radius.card, padding: space.xs, alignItems: 'center', gap: space.xs, backgroundColor: colors.contentBackground,
      transform: [{ translateY: cue(lift, 0, 1, 0, -space.hair) }] }}>
      <View style={{ height: guideArt.miniPrintHeight, width: '100%', borderRadius: radius.control, overflow: 'hidden' }}>
        <Image accessible={false} resizeMode="cover" source={mode.value === 'dark' ? moonlight : daylight} style={{ width: '100%', height: '100%' }} />
        {mode.value === 'system' && <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', overflow: 'hidden' }}>
          <Image accessible={false} resizeMode="cover" source={moonlight} style={{ width: '200%', height: '100%', alignSelf: 'flex-end' }} />
        </View>}
      </View>
      <Text variant="label" weight={selected ? 'semibold' : 'regular'}>{mode.label}</Text>
    </Animated.View>
  </Pressable>;
}

function Progress({ page }: { page: Exclude<Stage, 'intro'> }) {
  const { colors } = useTheme();
  const n = stages.indexOf(page);
  return <View accessibilityLabel={`Step ${n} of 4, ${titles[page]}`} style={{ gap: space.sm }}>
    <View style={{ flexDirection: 'row', gap: space.xs }}>
      {stages.slice(1).map((s, i) => <View key={s} style={{ width: geometry.controlLarge, height: space.hair,
        borderRadius: radius.pill, backgroundColor: i < n ? colors.accent : colors.borderDefault }} />)}
    </View>
    <Text variant="section">{`${n} / 4   ·   ${titles[page]}`}</Text>
  </View>;
}

function Heading({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return <View style={{ gap: space.md }}>
    <Text variant="greeting" accessibilityRole="header" style={{ letterSpacing: guideArt.tracking, fontSize: guideArt.titleSize, lineHeight: guideArt.titleLine }}>{title}</Text>
    <Text variant="callout" tone="textSecondary">{children}</Text>
  </View>;
}

function Choices({ page, onError }: { page: 'appearance' | 'workspace' | 'ready'; onError(): void }) {
  const actions = useActions();
  const { appearance, modal } = useSnapshot();
  const { colors, dark } = useTheme();
  if (page === 'ready') return <>
    <Heading title="The browser is yours.">Your workspace is ready. Open a tab or bring your bookmarks with you.</Heading>
    {([['⌘ T', 'Open a new tab'], ['⌘ L', 'Search or enter an address']] as const).map(([key, label]) =>
      <View key={key} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}><KeyCap>{key}</KeyCap><Text>{label}</Text></View>)}
    <Text variant="caption">Find the field guide again in Help › Keyboard Tutorial.</Text>
  </>;
  if (page === 'appearance') return <>
    <Heading title="Find your light.">Set the light for your browser. System follows your Mac throughout the day.</Heading>
    <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={{ flexDirection: 'row', gap: space.sm }}>
      {modes.map(mode => <ModeTile key={mode.value} mode={mode} selected={mode.value === appearance.mode}
        onPress={() => { void actions.setAppearance({ mode: mode.value }).then(ok => { if (!ok) onError(); }); }} />)}
    </View>
  </>;
  return <>
    <Heading title="Make room for your tabs.">Choose where your tabs live and a colour for your workspace.</Heading>
    <View style={{ gap: space.sm }}><Text variant="group">Tab placement</Text>
      <Segmented label="Tab placement" value={modal.tabLayout === 'top' ? 'top' : 'side'} options={layouts}
        onChange={value => { void actions.request('settings.set', { key: 'tabs', value }).catch(onError); }} />
    </View>
    <View style={{ gap: space.sm }}><Text variant="group">Workspace colour · {accentLabel(appearance.accent)}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Workspace colour" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {accents.map(name => {
          const selected = appearance.accent === name;
          return <Pressable key={name} accessibilityRole="radio" accessibilityLabel={accentLabel(name)} accessibilityState={{ selected }}
            onPress={() => void actions.setAppearance({ accent: name }).then(ok => { if (!ok) onError(); })}
            style={{ padding: space.hair, borderRadius: radius.pill, borderWidth: geometry.focusRing, borderColor: selected ? colors.accent : colors.fillTransparent }}>
            <View style={{ width: geometry.iconLarge, height: geometry.iconLarge, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: accentSwatch(dark ? 'dark' : 'light', name).fill }}>
              {selected && <Icon name="checkmark" size="small" tone="textOnAccent" />}
            </View>
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
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState('');
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
  const start = useCallback(() => { void advance('appearance'); }, [advance]);
  useEffect(() => {
    if (stage === 'practice' && !snapshot.welcomeTabId) void advance('tutorial');
  }, [stage, snapshot.welcomeTabId, advance]);
  const { outgoing, direction, progress } = useGuideTurn(stage, stages, reduceMotion);
  const compact = size.width < guideArt.compact;
  const frameWidth = Math.min(guideArt.width, Math.max(0, size.width - (compact ? space.lg : space.huge * 2)));
  const night = useGuideSelection(dark, reduceMotion);
  const fromIntro = outgoing === 'intro';
  const onIntro = stage === 'intro';
  const primary = (page: Exclude<Stage, 'intro'>) => page === 'practice' ?
    <Button label="Skip practice" onPress={() => void advance('ready')} /> :
    <Button variant="primary" size="large" trailingIcon="arrow.right"
      label={page === 'appearance' ? 'Continue' : page === 'workspace' ? 'Try the field guide' : 'Start browsing'}
      onPress={() => void advance(page === 'appearance' ? 'workspace' : page === 'workspace' ? 'tutorial' : 'browse')} />;
  const secondary = (page: Exclude<Stage, 'intro'>) => page === 'ready' ?
    <Button variant="ghost" label="Import bookmarks…" onPress={() => void advance('import')} /> :
    page === 'appearance' ? <Button variant="ghost" label="Skip setup" onPress={() => void advance('browse')} /> :
    <Button variant="ghost" label="Back" icon="chevron.left" onPress={() => void advance(page === 'practice' ? 'workspace' : 'appearance')} />;
  const pageTurn = (page: Exclude<Stage, 'intro'>, leaving: boolean) => {
    const shift = direction * frameWidth;
    const offset = leaving ? [0, -shift * .62] : [fromIntro ? 0 : shift, 0];
    const copyArrival = leaving ? 0 : cue(progress, .1, 1, space.xl, 0);
    return <Animated.View key={page} pointerEvents={leaving ? 'none' : 'auto'} accessibilityElementsHidden={leaving}
      style={[fill, { backgroundColor: colors.contentBackground, opacity: leaving ? cue(progress, .12, .95, 1, 0) : 1,
        transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: offset }) }] }]}>
      {page === 'practice' ? <>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md }}>
          <Progress page={page} />{primary(page)}
        </View>
        {snapshot.welcomeTabId && snapshot.welcomeTabId === snapshot.activeTabId ? <PageArea /> :
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Button label="Return to the lesson" onPress={() => void advance('tutorial')} /></View>}
        <View style={{ paddingHorizontal: space.lg, paddingVertical: space.xs }}>{secondary(page)}</View>
      </> : <View style={{ flex: 1, flexDirection: compact ? 'column-reverse' : 'row', padding: space.md, gap: space.sm }}>
        <View style={{ flex: 1, padding: compact ? space.sm : space.lg }}>
          <Progress page={page} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: space.lg }}>
            <Animated.View style={{ gap: space.xl, transform: [{ translateY: copyArrival }] }}>
              <Choices page={page} onError={onError} />
            </Animated.View>
          </ScrollView>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs }}>
            {primary(page)}{secondary(page)}
          </View>
        </View>
        {(!compact || size.height >= geometry.sheetHeight) && <Animated.View style={[compact ? { height: geometry.switcherThumb } : { flex: 1.14 },
          { transform: [{ scale: leaving ? 1 : cue(progress, 0, 1, .955, 1) }] }]}>
          <Scene page={page} compact={compact} time={progress} />
        </Animated.View>}
      </View>}
    </Animated.View>;
  };
  return <View onLayout={e => { const { width, height } = e.nativeEvent.layout; setSize({ width, height }); }}
    style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: dark ? guideArt.charcoal : guideArt.paper }}>
    <View pointerEvents="none" style={[fill, { opacity: dark ? .15 : .09 }]}><Coast night={night} /></View>
    <DragRegion style={fill} />
    {(onIntro || fromIntro) && <Animated.View accessibilityElementsHidden={!onIntro} pointerEvents={onIntro ? 'auto' : 'none'}
      style={[fill, { opacity: onIntro ? 1 : cue(progress, 0, .56, 1, 0),
        transform: [{ scale: onIntro ? 1 : cue(progress, 0, 1, 1, 1.12) }] }]}>
      <Flight onStart={start} width={size.width} height={size.height} />
    </Animated.View>}
    {!onIntro && <Animated.View style={{ width: frameWidth, height: Math.max(0, Math.min(guideArt.height, size.height - geometry.titlebar * (compact ? 1 : 2))),
      opacity: Animated.multiply(fromIntro ? cue(progress, 0, .8) : 1, cue(exit, 0, 1, 1, 0)),
      transform: [{ translateY: fromIntro ? cue(progress, 0, 1, space.xxl, 0) : 0 },
        { scale: Animated.multiply(fromIntro ? cue(progress, 0, 1, .92, 1) : 1, cue(exit, 0, 1, 1, reduceMotion ? 1 : .96)) }] }}>
      <Panel fill="contentBackground" radius="panel" elevation="dialog" style={{ flex: 1 }}>
        <View style={{ flex: 1, borderRadius: radius.panel, overflow: 'hidden' }}>
          {outgoing && outgoing !== 'intro' && outgoing !== stage && pageTurn(outgoing, true)}
          {pageTurn(stage, false)}
        </View>
        {!!error && <Text align="center" tone="textDanger">{error}</Text>}
      </Panel>
    </Animated.View>}
  </View>;
}
