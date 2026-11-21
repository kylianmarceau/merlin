import React, { useCallback, useRef, useState } from 'react';
import { Animated, Image, ScrollView, View, useWindowDimensions } from 'react-native';
import { useActions, useSnapshot } from '../../state/window';
import { Swatch, ThemeChoice } from '../settings/Previews';
import {
  Button, DragRegion, Icon, Panel, Text, accents, flightColors, geometry,
  radius, space, useTheme, useWelcomeFlight,
} from '../ui';

const falcon = require('../start/merlin-logo.png');

function Flight({ onLand }: { onLand(): void }) {
  const { dark, reduceMotion } = useTheme();
  const [width, setWidth] = useState(0);
  const time = useWelcomeFlight(reduceMotion, onLand);
  const ink = dark ? flightColors.moon : flightColors.ink;
  return <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ flex: 1, alignItems: 'center',
    paddingTop: geometry.newTabTop, backgroundColor: dark ? flightColors.night : flightColors.paper }}>
    <Image accessible={false} resizeMode="stretch" source={require('./hills.png')}
      style={{ position: 'absolute', bottom: 0, width: '100%', height: '40%', tintColor: ink }} />
    <DragRegion style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} />
    <Animated.View pointerEvents="none" style={{ opacity: time.interpolate({ inputRange: [0, 0.08, 1], outputRange: [0, 1, 1] }),
      transform: [
        { translateX: time.interpolate({ inputRange: [0, 0.28, 0.48, 0.58, 1], outputRange: [-width / 2, -width / 8, space.xs, 0, 0] }) },
        { translateY: time.interpolate({ inputRange: [0, 0.28, 0.48, 0.58, 1], outputRange: [geometry.areaLight, space.huge, -space.xs, 0, 0] }) },
        { rotate: time.interpolate({ inputRange: [0, 0.28, 0.58, 1], outputRange: ['-12deg', '-6deg', '0deg', '0deg'] }) },
      ] }}>
      <Image accessible={false} source={falcon} resizeMode="contain"
        style={{ width: geometry.startFalcon, height: geometry.startFalcon, tintColor: ink }} />
    </Animated.View>
    <Animated.View style={{ marginTop: space.md, opacity: time.interpolate({ inputRange: [0, 0.48, 0.7, 1], outputRange: [0, 0, 1, 1] }) }}>
      <Image source={require('./merlin-wordmark.png')} accessibilityLabel="Merlin" resizeMode="contain"
        style={{ width: geometry.slider, height: geometry.titlebar, tintColor: ink }} />
    </Animated.View>
    <View style={{ position: 'absolute', bottom: space.xl, right: space.xl }}>
      <Button label="Skip intro" onPress={onLand} />
    </View>
  </View>;
}

function WindowPreview() {
  const { colors } = useTheme();
  return <View accessible accessibilityLabel="Preview of your Merlin window" style={{ backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center', padding: space.xl, borderRadius: radius.panel, flexGrow: 1 }}>
    <Panel fill="sidebarFallback" border="borderDefault" radius="window" elevation="card" style={{ width: '100%', maxWidth: geometry.palette }}>
      <View style={{ height: geometry.titlebar, flexDirection: 'row', gap: space.xs, alignItems: 'center', paddingHorizontal: space.md }}>
        {[0, 1, 2].map(i => <View key={i} style={{ width: space.sm, height: space.sm, borderRadius: radius.pill, backgroundColor: colors.iconSecondary }} />)}
      </View>
      <View style={{ flexDirection: 'row', padding: space.sm, gap: space.sm }}>
        <View style={{ flex: 1, gap: space.md }}>
          <View style={{ padding: space.sm, backgroundColor: colors.accentSoft, borderRadius: radius.tab }}><Text weight="semibold">New Tab</Text></View>
          <View style={{ flexDirection: 'row', gap: space.xs, paddingHorizontal: space.sm }}><Icon name="bookmark" size="small" /><Text variant="label">Bookmarks</Text></View>
        </View>
        <View style={{ flex: 2, backgroundColor: colors.contentBackground, alignItems: 'center', justifyContent: 'center',
          minHeight: geometry.pictureChoice, borderRadius: radius.card, gap: space.sm, padding: space.sm }}>
          <Image accessible={false} source={falcon} resizeMode="contain" style={{ width: geometry.titlebar, height: geometry.titlebar, tintColor: colors.accent }} />
          <View style={{ borderRadius: radius.field, borderWidth: geometry.hairline, borderColor: colors.borderDefault, padding: space.sm }}>
            <Text variant="label" tone="textSecondary">Search or enter an address</Text>
          </View>
        </View>
      </View>
    </Panel>
  </View>;
}

export function Welcome({ stage }: { stage: 'intro' | 'appearance' }) {
  const actions = useActions();
  const { appearance } = useSnapshot();
  const { colors } = useTheme();
  const [width, setWidth] = useState(useWindowDimensions().width);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const advance = useCallback(async (next: Parameters<typeof actions.advanceWelcome>[0]) => {
    if (pending.current) return;
    pending.current = true;
    const ok = await actions.advanceWelcome(next);
    if (!ok) setError('Merlin couldn’t open that step. Try again or start browsing.');
    pending.current = false;
  }, [actions]);
  const land = useCallback(() => { void advance('appearance'); }, [advance]);
  if (stage === 'intro') return <Flight onLand={land} />;
  const wide = width >= geometry.sheetWidth;
  return <View style={{ flex: 1, backgroundColor: colors.windowBackground }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
    <DragRegion style={{ height: geometry.titlebar }} />
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: wide ? space.huge : space.lg }}>
      <View style={{ width: '100%', maxWidth: geometry.sheetWidth + geometry.sidebar, alignSelf: 'center',
        flexDirection: wide ? 'row' : 'column', gap: space.xxl }}>
        <View style={{ flexGrow: 1, flexBasis: wide ? geometry.sidebar : 'auto', gap: space.xl }}>
          <Text variant="display">Make Merlin yours</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={{ flexDirection: 'row', gap: space.sm }}>
            {(['system', 'light', 'dark'] as const).map(mode => <ThemeChoice key={mode} mode={mode} accent={appearance.accent}
              selected={appearance.mode === mode} onPress={() => void actions.setAppearance({ mode })} />)}
          </View>
          <View style={{ gap: space.md }}>
            <Text variant="title">Workspace colour</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Workspace colour" style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md }}>
              {accents.map(name => <Swatch key={name} name={name} selected={name === appearance.accent}
                onPress={() => void actions.setAppearance({ accent: name })} />)}
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Button variant="primary" label="Try link hints" onPress={() => void advance('tutorial')} />
            <Button label="Skip tutorial" onPress={() => void advance('browse')} />
          </View>
          <View style={{ alignSelf: 'flex-start' }}><Button variant="ghost" label="Bring bookmarks over…" onPress={() => void advance('import')} /></View>
          {!!error && <Text tone="textDanger">{error}</Text>}
        </View>
        <View style={{ flexGrow: 1, flexBasis: wide ? geometry.sidebar : 'auto' }}><WindowPreview /></View>
      </View>
    </ScrollView>
  </View>;
}
