import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, ScrollView, StyleSheet, View } from 'react-native';
import { useActions, useSnapshot } from '../../state/window';
import { PageArea } from '../window/PageArea';
import {
  Button, DragRegion, Icon, KeyCap, Panel, Pressable, Segmented, Text, accentLabel, accentSwatch,
  accents, geometry, guideArt, leaveGuide, radius, space, useGuideTurn, useTheme, useWelcomeFlight,
} from '../ui';

const coast = require('../../../../../packages/shell/macos/Onboarding/MerlinCoast.jpg');
const falcon = require('../start/merlin-logo.png');
const wordmark = require('./merlin-wordmark.png');
const stages = ['intro', 'appearance', 'workspace', 'practice', 'ready'] as const;
type Stage = typeof stages[number];
const titles = { appearance: 'Appearance', workspace: 'Workspace', practice: 'Field guide', ready: 'Finish' };
const modes = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] as const;
const layouts = [{ value: 'side', label: 'Sidebar' }, { value: 'top', label: 'Across the top' }] as const;
const fill = StyleSheet.absoluteFillObject;

function Landscape({ dark = false, distant = false }: { dark?: boolean; distant?: boolean }) {
  return <View pointerEvents="none" style={fill}>
    <Image accessible={false} source={coast} resizeMode="cover" blurRadius={distant ? space.sm : 0} style={{ width: '100%', height: '100%' }} />
    {dark && <View style={[fill, { backgroundColor: guideArt.shadeDark }]} />}
  </View>;
}

function Flight({ onStart }: { onStart(): void }) {
  const { dark, reduceMotion } = useTheme();
  const [width, setWidth] = useState(0);
  const t = useWelcomeFlight(reduceMotion);
  return <View style={{ flex: 1, overflow: 'hidden', backgroundColor: guideArt.pine }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
    <Animated.View style={[fill, { transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1.11, 1] }) }] }]}>
      <Landscape dark={dark} />
    </Animated.View>
    <DragRegion style={fill} />
    <Animated.Image accessible={false} resizeMode="contain" source={falcon} style={{ position: 'absolute', top: '23%', left: '50%',
      tintColor: dark ? guideArt.ivory : guideArt.pine, width: geometry.startFalcon, height: geometry.startFalcon,
      transform: [{ translateX: t.interpolate({ inputRange: [0, .48, .8, 1], outputRange: [-width * .63, -width * .17, 0, width * .035] }) },
        { translateY: t.interpolate({ inputRange: [0, .48, .8, 1], outputRange: [geometry.switcherThumb, -space.xl, 0, -space.xs] }) },
        { rotate: t.interpolate({ inputRange: [0, .5, 1], outputRange: ['-14deg', '-4deg', '4deg'] }) }] }} />
    <Animated.View style={{ position: 'absolute', left: '8%', bottom: '12%', alignItems: 'flex-start',
      opacity: t.interpolate({ inputRange: [0, .3, .63, 1], outputRange: [0, 0, 1, 1] }) }}>
      <Text variant="greeting" style={{ color: guideArt.ivory }}>Welcome to</Text>
      <Image source={wordmark} accessibilityLabel="Merlin" resizeMode="contain"
        style={{ width: geometry.sidebar, height: geometry.paletteInput, tintColor: guideArt.ivory }} />
      <Pressable accessibilityRole="button" accessibilityLabel="Get started" onPress={onStart}
        style={({ pressed }) => ({ marginTop: space.xl, minHeight: geometry.rowTall, justifyContent: 'center',
          paddingHorizontal: space.xl, borderRadius: radius.pill, backgroundColor: guideArt.ivory, opacity: pressed ? .84 : 1 })}>
        <Text weight="semibold" style={{ color: guideArt.pine }}>Get started　→</Text>
      </Pressable>
    </Animated.View>
  </View>;
}

function WindowPrint({ ready }: { ready: boolean }) {
  const { colors, dark } = useTheme();
  const { modal } = useSnapshot();
  const side = modal.tabLayout !== 'top';
  return <View accessible accessibilityLabel="Live preview of your workspace" style={{ flex: 1, alignItems: 'center',
    justifyContent: 'center', backgroundColor: guideArt.sky, overflow: 'hidden', padding: space.xl }}>
    <Landscape dark={dark} />
    {ready ? <Image accessible={false} source={falcon} resizeMode="contain" style={{ width: geometry.startFalcon, height: geometry.startFalcon,
      alignSelf: 'center', marginBottom: geometry.switcherThumb, tintColor: dark ? guideArt.ivory : guideArt.pine }} /> :
      <Panel fill="contentBackground" elevation="dialog" radius="window" style={{ width: '100%', maxWidth: guideArt.preview }}>
        <View style={{ overflow: 'hidden', borderRadius: radius.window, backgroundColor: colors.accentSoft }}>
          <View style={{ height: geometry.controlCompact, alignItems: 'center', flexDirection: 'row', gap: space.xs, paddingHorizontal: space.md }}>
            {[0,1,2].map(i => <View key={i} style={{ width: space.xs, height: space.xs, borderRadius: radius.pill, backgroundColor: colors.iconSecondary }} />)}
          </View>
          <View style={{ flexDirection: side ? 'row' : 'column', padding: space.xs, gap: space.xs }}>
            <View style={{ flexDirection: side ? 'column' : 'row', gap: space.sm, padding: space.xs }}>
              <View style={{ backgroundColor: colors.contentBackground, borderRadius: radius.sm, padding: space.xs }}>
                <Text variant="micro">New Tab</Text>
              </View>
              <Icon name="plus" size="small" />
            </View>
            <View style={{ flexGrow: 1, minHeight: geometry.switcherThumb, borderRadius: radius.card, backgroundColor: colors.startBackground,
              alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
              <Image accessible={false} source={falcon} style={{ width: geometry.titlebar, height: geometry.titlebar, tintColor: colors.accent }} />
              <View style={{ width: '65%', height: space.md, borderRadius: radius.pill, borderWidth: geometry.hairline, borderColor: colors.borderDefault }} />
            </View>
          </View>
        </View>
      </Panel>}
  </View>;
}

function Heading({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return <View style={{ gap: space.md }}>
    <Text variant="greeting" accessibilityRole="header" style={{ letterSpacing: guideArt.tracking }}>{title}</Text>
    <Text variant="callout" tone="textSecondary">{children}</Text>
  </View>;
}

function Choices({ page, onError }: { page: 'appearance' | 'workspace' | 'ready'; onError(): void }) {
  const actions = useActions();
  const { appearance, modal } = useSnapshot();
  const { colors, dark } = useTheme();
  if (page === 'ready') return <>
    <Heading title="The browser is yours.">Open a tab and take it somewhere. These two shortcuts are a good place to start.</Heading>
    {([['⌘ T', 'Open a new tab'], ['⌘ L', 'Search or enter an address']] as const).map(([key, label]) =>
      <View key={key} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}><KeyCap>{key}</KeyCap><Text>{label}</Text></View>)}
    <Text variant="caption">Find the field guide again in Help › Keyboard Tutorial.</Text>
  </>;
  if (page === 'appearance') return <>
    <Heading title="Find your light.">Choose how Merlin looks. System follows your Mac from day to night.</Heading>
    <Segmented label="Appearance" value={appearance.mode} options={modes}
      onChange={mode => { void actions.setAppearance({ mode }).then(ok => { if (!ok) onError(); }); }} />
  </>;
  return <>
    <Heading title="Settle in.">Choose where your tabs live and a colour for your workspace.</Heading>
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
            <View style={{ width: geometry.iconLarge, height: geometry.iconLarge, borderRadius: radius.pill, backgroundColor: accentSwatch(dark ? 'dark' : 'light', name).fill }} />
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
  const pageTurn = (page: Exclude<Stage, 'intro'>, leaving: boolean) => {
    const shift = direction * frameWidth;
    return <Animated.View key={page} pointerEvents={leaving ? 'none' : 'auto'} accessibilityElementsHidden={leaving}
      style={[fill, { backgroundColor: colors.contentBackground, transform: [{ translateX: progress.interpolate({
        inputRange: [0, 1], outputRange: leaving ? [0, -shift] : [shift, 0],
      }) }] }]}>
      {page === 'practice' ?
        snapshot.welcomeTabId && snapshot.welcomeTabId === snapshot.activeTabId ? <PageArea /> :
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Button label="Return to the lesson" onPress={() => void advance('tutorial')} /></View>
        : <View style={{ flex: 1, flexDirection: compact ? 'column' : 'row' }}>
          {(!compact || size.height >= geometry.sheetHeight) && <View style={compact ? { height: geometry.switcherThumb } : { flex: 0.94 }}>
            <WindowPrint ready={page === 'ready'} />
          </View>}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center',
            padding: compact ? space.xl : guideArt.inset, gap: space.xl }}>
            <Choices page={page} onError={onError} />
          </ScrollView>
        </View>}
    </Animated.View>;
  };
  const next = stage === 'appearance' ? 'workspace' : stage === 'workspace' ? 'tutorial' : 'browse';
  return <View onLayout={e => { const { width, height } = e.nativeEvent.layout; setSize({ width, height }); }}
    style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: guideArt.pine }}>
    <Landscape dark={dark} distant />
    <View pointerEvents="none" style={[fill, { backgroundColor: guideArt.shade }]} />
    <DragRegion style={fill} />
    {stage === 'intro' ? <View style={fill}><Flight onStart={start} /></View> :
      <Animated.View style={{ width: frameWidth, height: Math.max(0, Math.min(guideArt.height, size.height - geometry.titlebar * 2)),
        opacity: exit.interpolate({ inputRange: [0,1], outputRange: [1,0] }),
        transform: [{ scale: exit.interpolate({ inputRange: [0,1], outputRange: [1, reduceMotion ? 1 : .97] }) }] }}>
      <Panel fill="contentBackground" radius="panel" elevation="dialog" style={{ flex: 1 }}>
        <View style={{ flex: 1, borderRadius: radius.panel, overflow: 'hidden' }}>
          <View style={{ minHeight: geometry.paletteInput, paddingHorizontal: compact ? space.lg : space.xl,
            flexDirection: 'row', gap: space.lg, alignItems: 'center', justifyContent: 'space-between',
            borderBottomWidth: geometry.hairline, borderColor: colors.borderDefault }}>
            <Image accessibilityLabel="Merlin" source={wordmark} resizeMode="contain" style={{ width: geometry.startFalcon, height: geometry.control, tintColor: colors.textPrimary }} />
            <View accessibilityLabel={titles[stage]} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              {stages.slice(1).map(s => <View key={s} style={{ width: s === stage ? geometry.iconButton : geometry.dot,
                height: geometry.dot, borderRadius: radius.pill, backgroundColor: stages.indexOf(s) <= stages.indexOf(stage) ? colors.accent : colors.borderDefault }} />)}
              <Text variant="label">{titles[stage]}</Text>
            </View>
          </View>
          <View style={{ flex: 1, overflow: 'hidden' }}>
            {outgoing && outgoing !== 'intro' && outgoing !== stage && pageTurn(outgoing, true)}
            {pageTurn(stage, false)}
          </View>
          {!!error && <Text align="center" tone="textDanger">{error}</Text>}
          <View style={{ minHeight: geometry.paletteInput, paddingHorizontal: compact ? space.md : space.xl, paddingVertical: space.sm,
            borderTopWidth: geometry.hairline, borderColor: colors.borderDefault, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            {stage === 'appearance' ? <Button variant="ghost" label="Skip setup" onPress={() => void advance('browse')} /> :
              stage === 'ready' ? <Button variant="ghost" label="Import bookmarks…" onPress={() => void advance('import')} /> :
              <Button variant="ghost" label="Back" icon="chevron.left" onPress={() => void advance(stage === 'workspace' ? 'appearance' : 'workspace')} />}
            {stage === 'practice' ? <Button label="Skip practice" onPress={() => void advance('ready')} /> :
              <Button variant="primary" size="large" trailingIcon="arrow.right" label={stage === 'appearance' ? 'Continue' : stage === 'workspace' ? 'Try the field guide' : 'Start browsing'}
                onPress={() => void advance(next)} />}
          </View>
        </View>
      </Panel></Animated.View>}
  </View>;
}
