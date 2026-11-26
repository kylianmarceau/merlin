// The preview window at rest, gliding between its layouts: the sidebar slides
// away as the page grows to the window's width and the tabs drop in along
// the top; the address moves between the toolbar and the sidebar. Adapted
// from Ardia's onboarding previews (WindowState.tsx; Apache-2.0, see NOTICE).
import React, { memo, type ReactNode } from 'react';
import { Animated, View } from 'react-native';
import { setupMock as M, useFadeBetween, useTheme } from '../../ui';
import { Backdrop, Card, Crumb, FieldPlate, Lights, NavIcons, Rows, TabRow, ToolbarBand, TopTabPlate, type Styles } from './Kit';
import { Page } from './Pages';
import { cardRadius, chipStep, fill, hairline, restChipCount, restRowCount, tab, type Geo, type Look } from './mock';

export type SiteTint = Animated.Value | Animated.AnimatedInterpolation<number> | number;

/** The toolbar in the site's colour, faded in by `site`. */
export function SiteBand({ look, site }: { look: Look; site: SiteTint }) {
  return <Animated.View style={[fill, { opacity: site }]}><View style={[fill, { backgroundColor: look.site }]} /></Animated.View>;
}

export function SelectedChip({ g, look, site, x = M.chip.x, style }: { g: Geo; look: Look; site: SiteTint; x?: number; style?: Styles }) {
  return <TopTabPlate g={g} look={look} x={x} style={style}><SiteBand look={look} site={site} /></TopTabPlate>;
}

/** A tab across the top: a row the height of the strip's plates. */
export const chipY = M.chip.top - (M.row.h - M.chip.h) / 2 + 1;

export function RestChips({ g, look, site, from = 0 }: { g: Geo; look: Look; site: SiteTint; from?: number }) {
  return <>
    <SelectedChip g={g} look={look} site={site} />
    {Array.from({ length: restChipCount(g) }, (_, i) =>
      <TabRow key={i} g={g} look={look} t={tab(from + i)} x={M.chip.x + i * chipStep} y={chipY} w={M.chip.w} lit={i === 0 ? 1 : undefined} />)}
  </>;
}

/** The workspace colour behind the window, crossfading when it changes. */
function FadingBackdrop({ look }: { look: Look }) {
  const { reduceMotion } = useTheme();
  const { layers, fade } = useFadeBetween(look, reduceMotion);
  return <View style={fill} pointerEvents="none">
    {layers.below && <Backdrop look={layers.below} />}
    <Animated.View style={[fill, { opacity: layers.below ? fade : 1 }]}><Backdrop look={layers.above} /></Animated.View>
  </View>;
}

export type WindowSlots = { rows?: ReactNode; chips?: ReactNode; page?: ReactNode; crumb?: ReactNode; card?: ReactNode; over?: ReactNode };

type Props = { g: Geo; look: Look; lay: Animated.Value; addr: Animated.Value; site: Animated.Value | Animated.AnimatedInterpolation<number>; frame: number; slots?: WindowSlots };

export const WindowState = memo(function WindowState({ g, look, lay, addr, site, frame, slots = {} }: Props) {
  const s = g.s;
  const c = look.c;
  const sideCardX = M.sidebar + Math.max(0, frame - M.row.x);
  const lightsY = frame + M.lights.toolbar;
  const lerp = (v: Animated.Value, a: number, b: number) => v.interpolate({ inputRange: [0, 1], outputRange: [a * s, b * s] });
  const fade = (v: Animated.Value | Animated.AnimatedInterpolation<number>, a: number, b: number) => v.interpolate({ inputRange: [0, 1], outputRange: [a, b] });
  const sideCardW = g.W - sideCardX - frame;
  const F = M.field, FC = M.fieldCrumb;
  const crumbLeft = Animated.add(lerp(lay, sideCardX + M.crumbX, frame + M.crumbXTop), lerp(addr, 0, F.x + FC.x - (sideCardX + M.crumbX)));
  const crumbTop = Animated.add(lerp(lay, frame + M.crumbTop, M.strip + M.crumbTop), lerp(addr, 0, F.y + FC.y - (frame + M.crumbTop)));
  return <View style={fill}>
    <FadingBackdrop look={look} />
    <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: M.chip.x * s, height: M.strip * s, transform: [
      { translateX: lerp(lay, 0, M.lights.strip - M.lights.x) },
      { translateY: Animated.add(lerp(lay, lightsY - M.lights.toolbar, M.lights.strip - M.lights.toolbar), lerp(addr, 0, M.lights.field - lightsY)) },
    ] }}>
      <Lights g={g} />
    </Animated.View>
    {/* The sidebar: its buttons beside the lights, the address field and the tabs. */}
    <Animated.View style={[fill, { opacity: fade(lay, 1, 0), transform: [{ translateX: lerp(lay, 0, -M.sidebar / 3) }] }]}>
      <NavIcons g={g} color={c.iconSecondary} xs={M.sidebarIcons} y={M.lights.field} names={['sidebar.left', 'chevron.left', 'chevron.right']}
        style={{ opacity: fade(addr, 0, 1) }} />
      <Animated.View style={[fill, { transform: [{ translateY: lerp(addr, 0, M.row.topWithField - M.row.top) }] }]}>
        {slots.rows !== undefined ? slots.rows : <Rows g={g} look={look} n={restRowCount(g)} sel={0} />}
      </Animated.View>
      <FieldPlate g={g} look={look} style={{ left: Animated.add(crumbLeft, -FC.x * s), top: Animated.add(crumbTop, -FC.y * s),
        width: lerp(addr, F.w * 1.8, F.w), height: F.h * s, opacity: fade(addr, 0, 1) }} />
    </Animated.View>
    {/* The tabs along the top. */}
    <Animated.View style={[fill, { opacity: lay, transform: [{ translateY: lerp(lay, -M.chip.h / 4, 0) }] }]}>
      {slots.chips !== undefined ? slots.chips : <RestChips g={g} look={look} site={site} />}
    </Animated.View>
    <Card g={g} look={look} style={{ left: lerp(lay, sideCardX, frame), top: lerp(lay, frame, M.strip), width: lerp(lay, sideCardW, g.W - 2 * frame),
      height: lerp(lay, g.H - 2 * frame, g.H - M.strip - frame), borderRadius: cardRadius(frame) * s,
      borderWidth: frame ? hairline : 0 }}>
      <Animated.View style={[fill, { transform: [{ translateY: lerp(addr, 0, -M.toolbar) }] }]}>
        {slots.page !== undefined ? slots.page : <Page g={g} look={look} top={M.toolbar} />}
      </Animated.View>
      <ToolbarBand g={g} background={c.toolbarBackground} divider={c.toolbarDivider} dividerStyle={{ opacity: fade(site, 1, 0) }} style={{ opacity: fade(addr, 1, 0) }}>
        <SiteBand look={look} site={site} />
        <Animated.View style={[fill, { opacity: fade(lay, 1, 0) }]}>
          <NavIcons g={g} color={c.iconSecondary} xs={M.toolbarIcons} y={M.toolbar / 2} />
        </Animated.View>
        <Animated.View style={[fill, { opacity: lay }]}>
          <NavIcons g={g} color={c.iconSecondary} xs={M.topIcons} y={M.toolbar / 2} names={['chevron.left', 'chevron.right', 'arrow.clockwise']} />
        </Animated.View>
      </ToolbarBand>
      {slots.card}
    </Card>
    <Animated.View style={{ position: 'absolute', left: crumbLeft, top: crumbTop, width: lerp(addr, F.w * 1.7, FC.w), height: M.crumbH * s, overflow: 'hidden' }}>
      {slots.crumb !== undefined ? slots.crumb : <Crumb g={g} look={look} t={tab(0)} />}
    </Animated.View>
    {slots.over}
  </View>;
});
