import React from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { useSnapshot } from '../../state/window';
import { Icon, Panel, Text, geometry, guideArt, radius, space, useGuideSelection, useTheme } from '../ui';

const dawn = require('../../../../../packages/shell/macos/Onboarding/MerlinDawn.jpg');
const nightCoast = require('../../../../../packages/shell/macos/Onboarding/MerlinNight.jpg');
const falcon = require('../start/merlin-logo.png');
const fill = StyleSheet.absoluteFillObject;

export function cue(value: Animated.Value, start: number, end: number, from = 0, to = 1) {
  return value.interpolate({ inputRange: [start, end], outputRange: [from, to], extrapolate: 'clamp' });
}

function Scenery({ night }: { night: Animated.Value }) {
  return <View pointerEvents="none" style={fill}>
    <Image accessible={false} source={dawn} resizeMode="cover" style={styles.photo} />
    <Animated.Image accessible={false} source={nightCoast} resizeMode="cover" style={[styles.photo, { opacity: night }]} />
  </View>;
}
const styles = StyleSheet.create({ photo: { position: 'absolute', width: '100%', height: '100%' } });

/** Keep one window on screen through both questions. Moving its actual tab labels
 * makes the change between sidebar and top tabs legible during the transition. */
export function WorkspacePreview({ compact }: { compact: boolean }) {
  const { colors, dark, reduceMotion } = useTheme();
  const { modal } = useSnapshot();
  const top = useGuideSelection(modal.tabLayout === 'top', reduceMotion);
  const night = useGuideSelection(dark, reduceMotion);
  const rail = compact ? geometry.paletteInput : guideArt.tabWidth;
  const row = guideArt.tabHeight;
  return <View accessible accessibilityLabel="Live preview of Merlin with your appearance, tab placement and colour"
    style={{ flex: 1, overflow: 'hidden', borderRadius: radius.panel, alignItems: 'center', justifyContent: 'center',
      backgroundColor: dark ? guideArt.charcoal : guideArt.paper }}>
    <View style={[fill, { opacity: dark ? .38 : .57 }]}><Scenery night={night} /></View>
    <Panel radius="window" fill="contentBackground" elevation="dialog" style={{ width: compact ? '74%' : '86%', maxWidth: guideArt.preview }}>
      <View style={{ height: compact ? geometry.switcherThumb : guideArt.browserHeight, overflow: 'hidden',
        borderRadius: radius.window, backgroundColor: colors.accentSoft, padding: space.sm }}>
        <View style={{ height: row, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          {[0, 1, 2].map(i => <View key={i} style={{ width: space.xs, height: space.xs, borderRadius: radius.pill, backgroundColor: colors.iconSecondary }} />)}
        </View>
        <View style={{ flex: 1, marginTop: space.xs, overflow: 'hidden', borderRadius: radius.control, backgroundColor: colors.startBackground }}>
          <Animated.View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm,
            transform: [{ translateX: cue(top, 0, 1, rail / 2, 0) }] }}>
            <Image accessible={false} source={falcon} resizeMode="contain" style={{ width: compact ? geometry.control : geometry.toolbar,
              height: compact ? geometry.control : geometry.toolbar, tintColor: colors.accent }} />
            {!compact && <View style={{ width: '57%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: space.xs, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.contentBackground,
              borderWidth: geometry.hairline, borderColor: colors.borderDefault }}>
              <Icon name="magnifyingglass" size="small" /><Text variant="micro" lines={1}>Search or enter an address</Text>
            </View>}
          </Animated.View>
        </View>
        <Animated.View style={{ position: 'absolute', top: geometry.row, bottom: space.sm, left: space.sm, width: rail,
          backgroundColor: colors.accentSoft, opacity: cue(top, 0, .56, 1, 0), transform: [{ translateX: cue(top, 0, 1, 0, -rail) }] }} />
        {['New Tab', 'Field guide'].map((name, i) => <Animated.View key={name} style={{ position: 'absolute', left: space.sm,
          top: geometry.row + i * (row + space.xs), width: rail - space.xs, height: row, paddingHorizontal: space.xs,
          gap: space.xs, flexDirection: 'row', alignItems: 'center', borderRadius: radius.xs,
          backgroundColor: i ? colors.accentSoft : colors.contentBackground,
          transform: [{ translateX: cue(top, 0, 1, 0, space.xxl + i * rail) }, { translateY: cue(top, 0, 1, 0, space.sm - geometry.row - i * (row + space.xs)) }] }}>
          <Icon name={i ? 'leaf' : 'globe'} size="small" tone="iconSecondary" /><Text variant="micro" lines={1}>{name}</Text>
        </Animated.View>)}
      </View>
    </Panel>
  </View>;
}

export function Lookout() {
  const { dark, reduceMotion } = useTheme();
  const night = useGuideSelection(dark, reduceMotion);
  return <View accessible accessibilityLabel="The coastal lookout" style={{ flex: 1, overflow: 'hidden', borderRadius: radius.panel }}>
    <Scenery night={night} />
  </View>;
}
