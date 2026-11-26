// Glass or Classic, seen up close: Merlin's painted coast drifts behind its
// controls, so Liquid Glass bends and lights it as it goes; Classic shows the
// same controls as solid plates. The layout of the controls follows Ardia's
// StylePreview (Apache-2.0, see NOTICE).
import React from 'react';
import { Animated, View } from 'react-native';
import { GlassFill, setupMock as M, setupMockInk as ink, useStageDrift, useTheme, type SymbolName } from '../../ui';
import { Favicon, Label, Lights, MockGlyph } from './Kit';
import { fill, hairline, tab, type Geo, type Look } from './mock';

const S = M.stage;
const NATIVE: Geo = { s: 1, W: S.width, H: S.height };
const INNER_W = S.width - S.pad * 2;
const TILE_W = (INNER_W - S.tileGap * (S.tileCount - 1)) / S.tileCount;
const PILL_X = S.pad + 3 * (S.button + S.buttonGap);
const at = (left: number, top: number, width: number, height: number) => ({ position: 'absolute' as const, left, top, width, height });

// Merlin's coast by day, or by night in dark mode, drifting behind the glass.
const paintings = {
  light: require('../../../../../../packages/shell/macos/Onboarding/MerlinDawn.jpg'),
  dark: require('../../../../../../packages/shell/macos/Onboarding/MerlinNight.jpg'),
};
/** The painting, fitted to the `seen` part of the stage the window shows. */
function Painting({ dark, seen }: { dark: boolean; seen: { top: number; height: number } }) {
  const { reduceMotion } = useTheme();
  const drift = useStageDrift(reduceMotion);
  const height = seen.height * S.paintZoom;
  const width = Math.max(S.width, height * S.paintAspect);
  return <View pointerEvents="none" style={fill}>
    <Animated.Image accessible={false} source={paintings[dark ? 'dark' : 'light']} resizeMode="cover" style={{ position: 'absolute', left: 0, top: seen.top + seen.height - height, width, height,
      transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, S.width - width] }) }] }} />
  </View>;
}

function Face({ glass, dark, r, children }: { glass: boolean; dark: boolean; r: number; children?: React.ReactNode }) {
  const c = dark ? ink.stage.dark : ink.stage.light;
  return <View style={[fill, { borderRadius: r, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.buttonGap / 2 }]}>
    {glass ? <GlassFill radius={r} state="rest" dark={dark} strength={1} />
      : <View pointerEvents="none" style={[fill, { borderRadius: r, backgroundColor: c.classic, borderWidth: hairline, borderColor: c.classicEdge }]} />}
    {children}
  </View>;
}

function Controls({ look, glass }: { look: Look; glass: boolean }) {
  const c = look.dark ? ink.stage.dark : ink.stage.light;
  return <>
    <Lights g={NATIVE} x={S.lightsX} y={S.lightsY} />
    {Array.from({ length: S.tileCount }, (_, i) => <View key={i} style={at(S.pad + i * (TILE_W + S.tileGap), S.tilesTop, TILE_W, S.tileH)}>
      <Face glass={glass} dark={look.dark} r={S.tileRadius}><Favicon g={NATIVE} t={tab(i + 1)} look={look} size={S.tileIcon} /></Face>
    </View>)}
    <View style={at(S.pad, S.fieldTop, INNER_W, S.fieldH)}>
      <Face glass={glass} dark={look.dark} r={S.fieldRadius}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: S.buttonGap, paddingHorizontal: S.pad - S.buttonGap / 2 }}>
          <Favicon g={NATIVE} t={tab(0)} look={look} size={S.favicon} />
          <Label g={NATIVE} size={S.label} color={c.ink} weight="semibold">{tab(0).host}</Label>
        </View>
      </Face>
    </View>
    {(['chevron.left', 'chevron.right', 'arrow.clockwise'] as SymbolName[]).map((name, i) =>
      <View key={name} style={at(S.pad + i * (S.button + S.buttonGap), S.buttonsTop, S.button, S.button)}>
        <Face glass={glass} dark={look.dark} r={S.button / 2}><MockGlyph g={NATIVE} name={name} size={S.glyph} color={c.ink} weight="semibold" box={S.glyphBox} /></Face>
      </View>)}
    <View style={at(PILL_X, S.buttonsTop, S.width - S.pad - PILL_X, S.button)}>
      <Face glass={glass} dark={look.dark} r={S.button / 2}>
        <MockGlyph g={NATIVE} name="plus" size={S.glyph - 2} color={c.ink} weight="semibold" box={S.glyphBox - 2} />
        <Label g={NATIVE} size={S.label} color={c.ink} weight="semibold">New Tab</Label>
      </Face>
    </View>
  </>;
}

/** The stage, scaled to cover a window `g` wide and tall. */
export function GlassStage({ g, look, glass }: { g: Geo; look: Look; glass: boolean }) {
  const scale = Math.max((g.W * g.s) / S.width, (g.H * g.s) / S.height);
  const seenH = Math.min(S.height, (g.H * g.s) / scale);
  return <View style={{ position: 'absolute', left: 0, top: 0, width: S.width, height: S.height, transform: [
    { translateX: (S.width * (scale - 1)) / 2 }, { translateY: (S.height * (scale - 1)) / 2 }, { scale }] }}>
    <View style={{ width: S.width, height: S.height, overflow: 'hidden' }}>
      <Painting dark={look.dark} seen={{ top: (S.height - seenH) / 2, height: seenH }} />
      <Controls look={look} glass={glass} />
    </View>
  </View>;
}

