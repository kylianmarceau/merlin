import React from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { useSnapshot } from '../../state/window';
import {
  Icon, Panel, Text, geometry, guideArt as art, radius, space, useAreaLight, useGuideSelection, useTheme,
} from '../ui';

export const daylight = require('../../../../../packages/shell/macos/Onboarding/MerlinCoast.jpg');
export const moonlight = require('../../../../../packages/shell/macos/Onboarding/MerlinNight.jpg');
const falcon = require('../start/merlin-logo.png');
const fill = StyleSheet.absoluteFillObject;

export function cue(value: Animated.Value, start: number, end: number, from = 0, to = 1) {
  return value.interpolate({ inputRange: [start, end], outputRange: [from, to], extrapolate: 'clamp' });
}

/** The two prints occupy the same mount so the night exposure dissolves over the day. */
export function Coast({ night }: { night: Animated.Value }) {
  return <View accessible={false} pointerEvents="none" style={fill}>
    <Image accessible={false} source={daylight} resizeMode="cover" style={styles.photo} />
    <Animated.Image accessible={false} source={moonlight} resizeMode="cover" style={[styles.photo, { opacity: night }]} />
  </View>;
}

const styles = StyleSheet.create({
  photo: { position: 'absolute', width: '100%', height: '100%' },
  mount: { position: 'absolute', borderRadius: radius.sm, borderWidth: geometry.hairline, borderColor: art.mountLine,
    backgroundColor: art.mount, padding: art.frame },
  crop: { flex: 1, overflow: 'hidden', borderRadius: radius.xs },
});

/** Two offset prints swing out behind the front one. The prints, bird and title share a clock. */
export function PrintFan({ time, width, night }: { time: Animated.Value; width: number; night: Animated.Value }) {
  const { reduceMotion } = useTheme();
  const air = useAreaLight(reduceMotion);
  const height = width * art.printHeight / art.printWidth;
  return <View pointerEvents="none" accessibilityElementsHidden style={{ width: '100%', height: height + space.xxl,
    alignItems: 'center', justifyContent: 'center' }}>
    {([-1, 1, 0] as const).map((side, index) => {
      const begin = index * .065;
      return <Animated.View key={side} style={[styles.mount, { width, height, opacity: cue(time, begin, begin + .24),
        transform: [
          { translateY: time.interpolate({ inputRange: [begin, begin + .22, begin + .42, 1], outputRange: [height * .58, -space.sm, Math.abs(side) * space.sm, Math.abs(side) * space.sm], extrapolate: 'clamp' }) },
          { translateX: cue(time, .15, .55, 0, side * width * .29) },
          { rotate: time.interpolate({ inputRange: [begin, .55, 1], outputRange: [side ? '0deg' : '-8deg', side * 11 + 'deg', side * 11 + 'deg'], extrapolate: 'clamp' }) },
        ] }]}>
        <View style={styles.crop}>{side ? <Image accessible={false} source={side < 0 ? moonlight : daylight} resizeMode="cover" style={styles.photo} /> : <>
          <Coast night={night} />
          <Animated.View style={{ position: 'absolute', left: '46%', top: '19%', opacity: cue(time, .28, .45),
            transform: [{ translateX: cue(time, .25, .75, -width * .6, space.sm) }, { translateY: cue(air, .55, 1, -space.xs, space.xs) },
              { rotate: time.interpolate({ inputRange: [.25, .75], outputRange: ['-16deg', '4deg'], extrapolate: 'clamp' }) }] }}>
            <Image accessible={false} source={falcon} resizeMode="contain" style={{ width: geometry.titlebar, height: geometry.titlebar, tintColor: art.ivory }} />
          </Animated.View>
        </>}</View>
      </Animated.View>;
    })}
  </View>;
}

function BrowserPrint({ side, compact }: { side: boolean; compact: boolean }) {
  const { colors, reduceMotion } = useTheme();
  const top = useGuideSelection(!side, reduceMotion);
  return <Panel radius="window" fill="contentBackground" elevation="dialog" style={{ width: '86%', maxWidth: art.preview }}>
    <View style={{ height: compact ? geometry.switcherThumb - space.md : art.browserHeight, overflow: 'hidden', borderRadius: radius.window, padding: space.sm, backgroundColor: colors.accentSoft }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: art.tabHeight, gap: space.xs }}>
        {[0, 1, 2].map(i => <View key={i} style={{ width: space.xs, height: space.xs, borderRadius: radius.pill, backgroundColor: colors.iconSecondary }} />)}
      </View>
      <View style={{ flex: 1, borderRadius: radius.sm, overflow: 'hidden', marginTop: space.xs, backgroundColor: colors.contentBackground }}>
        <Animated.View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md,
          transform: [{ translateX: cue(top, 0, 1, art.tabWidth / 2, 0) }] }}>
          <Image accessible={false} source={falcon} resizeMode="contain" style={{ width: geometry.titlebar, height: geometry.titlebar, tintColor: colors.accent }} />
          <View style={{ width: '44%', height: space.lg, borderRadius: radius.pill, borderWidth: geometry.hairline, borderColor: colors.borderDefault }} />
        </Animated.View>
      </View>
      <Animated.View style={{ position: 'absolute', top: geometry.row, bottom: space.sm, left: space.sm, width: art.tabWidth,
        backgroundColor: colors.accentSoft, opacity: cue(top, 0, .52, 1, 0), transform: [{ translateX: cue(top, 0, 1, 0, -art.tabWidth) }] }} />
      {['New Tab', 'Field guide'].map((name, index) => <Animated.View key={name} style={{ position: 'absolute', left: space.sm, top: geometry.row + index * (art.tabHeight + space.xs),
        width: art.tabWidth - space.xs, height: art.tabHeight, paddingHorizontal: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.xs,
        backgroundColor: index ? colors.accentSoft : colors.contentBackground, borderRadius: radius.xs,
        transform: [{ translateX: cue(top, 0, 1, 0, space.xxl + index * art.tabWidth) },
          { translateY: cue(top, 0, 1, 0, space.sm - geometry.row - index * (art.tabHeight + space.xs)) }] }}>
        <View style={{ width: space.xs, height: space.xs, borderRadius: radius.pill, backgroundColor: colors.accent }} />
        <Text variant="micro" lines={1}>{name}</Text>
      </Animated.View>)}
    </View>
  </Panel>;
}

export function Scene({ page, compact, time }: { page: 'appearance' | 'workspace' | 'ready'; compact: boolean; time: Animated.Value }) {
  const { dark, reduceMotion } = useTheme();
  const { modal } = useSnapshot();
  const night = useGuideSelection(dark, reduceMotion);
  const air = useAreaLight(reduceMotion);
  return <View accessible accessibilityLabel={page === 'workspace' ? 'Live tab layout preview' : dark ? 'The moonlit coast' : 'The coast at sunrise'}
    style={{ flex: 1, overflow: 'hidden', borderRadius: radius.card, backgroundColor: art.pine, justifyContent: 'center', alignItems: 'center' }}>
    <Animated.View style={[fill, { transform: [{ scale: cue(air, .55, 1, 1.02, 1.065) },
      { translateX: cue(air, .55, 1, -space.xs, space.xs) }] }]}><Coast night={night} /></Animated.View>
    {page === 'workspace' && <BrowserPrint compact={compact} side={modal.tabLayout !== 'top'} />}
    {page === 'ready' && <Animated.View style={{ transform: [{ translateY: cue(time, .08, .9, space.xxl, 0) },
      { rotate: time.interpolate({ inputRange: [0, 1], outputRange: ['-16deg', '0deg'] }) }],
      width: geometry.paletteInput, height: geometry.paletteInput, alignItems: 'center', justifyContent: 'center',
      borderRadius: radius.pill, backgroundColor: art.mount }}>
      <Icon name="checkmark" size="large" tone="textSuccess" />
    </Animated.View>}
    {(!compact || page !== 'workspace') && <View style={{ position: 'absolute', bottom: space.md, left: space.md, paddingHorizontal: space.md, paddingVertical: space.xs,
      borderRadius: radius.pill, backgroundColor: art.mount }}>
      <Text variant="caption" style={{ color: art.printInk }}>{page === 'ready' ? 'The lookout' : dark ? 'Coast by moonlight' : 'Coast at first light'}</Text>
    </View>}
  </View>;
}
