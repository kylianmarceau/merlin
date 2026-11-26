// What each setup choice plays in the preview window, on a loop. The scenes
// and their timing follow Ardia's onboarding previews (scenes/*.tsx;
// Apache-2.0, see NOTICE), drawn as Merlin.
import React, { useMemo, type ReactNode } from 'react';
import { Animated, View } from 'react-native';
import {
  Plate, font, linearEase, radius, space, setupMock as M, setupMockInk as ink, setupScene, tracker, useArrival, useTheme, type Tracker,
} from '../../ui';
import { Mark } from '../SetupMarks';
import {
  Backdrop, Caret, Lights, Crumb, Cursor, Divider, FloatPanel, Highlight, InputRow, Keycap, Label, MockGlyph, Pill, Rows, SelectedUrl,
  SuggestionRow, TabRow, Toolbar, WindowFrame, type Lit, type Styles,
} from './Kit';
import { NewTabPage, Page } from './Pages';
import { SelectedChip, WindowState, chipY, type SiteTint, type WindowSlots } from './WindowState';
import {
  BLANK, CURRENT, FRESH, NEW_TAB, NOTES, TRIP, atRect, hairline, chipStep, chipX, fill, lookFor, restCard, restChipCount, restRowCount, rowY, tab,
  type Geo, type Look, type Rect, type SceneOpts, type Suggestion, type Tab,
} from './mock';

export type SceneProps = { g: Geo; look: Look; p: Animated.Value; opts: SceneOpts };
export type Scene = (props: SceneProps) => ReactNode;

export function Rest({ g, look, opts, site, ...slots }: { g: Geo; look: Look; opts: SceneOpts; site?: SiteTint } & WindowSlots) {
  const values = useMemo(() => ({ lay: new Animated.Value(opts.top ? 1 : 0), addr: new Animated.Value(opts.addressInSidebar ? 1 : 0),
    site: new Animated.Value(opts.siteColor ? 1 : 0) }), [opts.top, opts.addressInSidebar, opts.siteColor]);
  const tint = typeof site === 'number' ? new Animated.Value(site) : site;
  return <WindowState g={g} look={look} lay={values.lay} addr={values.addr} site={tint ?? values.site} frame={opts.frame} slots={slots} />;
}

const cardOf = (g: Geo, opts: SceneOpts) => restCard(g, opts.top, opts.frame);
const tabCount = (g: Geo, opts: SceneOpts) => (opts.top ? restChipCount(g) : restRowCount(g));
const pitchOf = (opts: SceneOpts) => (opts.top ? chipStep : M.row.pitch);
const along = (opts: SceneOpts, value: Animated.AnimatedInterpolation<number>) => (opts.top ? [{ translateX: value }] : [{ translateY: value }]);
const tabsSlot = (opts: SceneOpts, node: ReactNode): WindowSlots => (opts.top ? { chips: node } : { rows: node });

function ListItem({ g, look, opts, t, i, lit, selected, style }: {
  g: Geo; look: Look; opts: SceneOpts; t: Tab; i: number; lit?: Lit; selected?: boolean; style?: Styles;
}) {
  if (opts.top) return <TabRow g={g} look={look} t={t} x={chipX(i)} y={chipY} w={M.chip.w} lit={lit} style={style} />;
  return <TabRow g={g} look={look} t={t} y={rowY(i)} lit={lit} selected={selected} style={style} />;
}

function Selected({ g, look, opts, i = 0, site, style }: { g: Geo; look: Look; opts: SceneOpts; i?: number; site?: SiteTint; style?: Styles }) {
  if (opts.top) return <SelectedChip g={g} look={look} x={chipX(i)} site={site ?? (opts.siteColor ? 1 : 0)} style={style} />;
  return <Highlight g={g} look={look} y={rowY(i)} style={style} />;
}

function NewTabRow({ g, look, opts, i, style }: { g: Geo; look: Look; opts: SceneOpts; i: number; style?: Styles }) {
  if (opts.top) return null;
  return <TabRow g={g} look={look} t={NEW_TAB} y={rowY(i)} style={style} />;
}

function KeyPress({ g, look, t, label, ms, back }: { g: Geo; look: Look; t: Tracker; label: string; ms: number; back: number }) {
  return <Keycap g={g} look={look} label={label} style={{ opacity: t.pulse(ms, back, 160, 200),
    transform: [{ scale: t([[ms, 0.82], [ms + 260, 1], [back, 1], [back + 200, 0.92]]) }] }} />;
}

function CrumbSwap({ g, look, t, a, b, ms, back }: { g: Geo; look: Look; t: Tracker; a: Tab; b: Tab; ms: number; back: number }) {
  const leave = 120, arrive = 200, slide = 8 * g.s;
  return <>
    <Crumb g={g} look={look} t={a} style={[fill, {
      opacity: t([[ms, 1], [ms + leave, 0], [back + leave, 0], [back + leave + arrive, 1]]),
      transform: [{ translateX: t([[ms, 0], [ms + leave, -slide], [back + leave, slide], [back + leave + arrive, 0]]) }] }]} />
    <Crumb g={g} look={look} t={b} style={[fill, {
      opacity: t([[ms + leave, 0], [ms + leave + arrive, 1], [back, 1], [back + leave, 0]]),
      transform: [{ translateX: t([[ms + leave, slide], [ms + leave + arrive, 0], [back, 0], [back + leave, -slide], [back + leave + arrive, slide]]) }] }]} />
  </>;
}

function PageSwap({ g, look, t, ms, back }: { g: Geo; look: Look; t: Tracker; ms: number; back: number }) {
  return <>
    <Page g={g} look={look} a={NOTES} top={M.toolbar} />
    <Animated.View style={[fill, { opacity: t.pulse(ms, back, 280) }]}><Page g={g} look={look} a={TRIP} top={M.toolbar} /></Animated.View>
  </>;
}

function SuggestionList({ g, look, t, rows, ms }: { g: Geo; look: Look; t: Tracker; rows: Suggestion[]; ms: number }) {
  return <View style={{ paddingHorizontal: M.suggestion.listX * g.s, paddingTop: M.suggestion.listX / 2 * g.s }}>
    {rows.map((s, i) => <SuggestionRow key={i} g={g} look={look} s={s} selected={i === 0}
      style={{ opacity: t.in(ms + i * 50, 200), transform: [{ translateY: t([[ms + i * 50, -3 * g.s], [ms + i * 50 + 220, 0]]) }] }} />)}
  </View>;
}

const PANEL_H = M.suggestion.input + 3 * M.suggestion.height + 14;

function centredFrame(g: Geo, opts: SceneOpts): Rect {
  const c = cardOf(g, opts);
  const w = Math.min(c.w - 28, M.panel.maxWidth);
  return { x: c.x + (c.w - w) / 2, y: c.y + Math.max(12, Math.round(c.h * 0.22)), w, h: PANEL_H };
}

function growTrip(t: Tracker, g: Geo, from: Rect, to: Rect, ms: number, back: number, dur = 260) {
  const sx = from.w / to.w, sy = from.h / to.h;
  const dx = (from.x - to.x - (to.w * (1 - sx)) / 2) * g.s;
  const dy = (from.y - to.y - (to.h * (1 - sy)) / 2) * g.s;
  return {
    opacity: t([[ms, 0], [ms + 90, 1], [back + dur - 90, 1], [back + dur, 0]]),
    transform: [{ translateX: t.trip(dx, 0, ms, back, dur) }, { translateY: t.trip(dy, 0, ms, back, dur) },
      { scaleX: t.trip(sx, 1, ms, back, dur) }, { scaleY: t.trip(sy, 1, ms, back, dur) }],
  };
}

const dropTrip = (t: Tracker, g: Geo, ms: number, back: number) => ({
  opacity: t.pulse(ms, back, 200, 220),
  transform: [{ translateY: t.trip(-10 * g.s, 0, ms, back, 300, 220) }, { scale: t.trip(0.97, 1, ms, back, 300, 220) }],
});

// Tabs: the selection moves two tabs down (or along) and back, the page and address following.
export const TabSwitch: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, setupScene.tabs);
  const GO = 420, BACK = 1760, TO = 2;
  const n = tabCount(g, opts);
  const move = t.trip(0, TO * pitchOf(opts) * g.s, GO, BACK, 300, 320);
  const lit = (i: number) => (i === 0 ? t.trip(1, 0, GO, BACK, 300, 320) : i === TO ? t.pulse(GO, BACK, 300, 320) : undefined);
  const list = <>
    <Selected g={g} look={look} opts={opts} style={{ transform: along(opts, move) }} />
    {Array.from({ length: n }, (_, i) => <ListItem key={i} g={g} look={look} opts={opts} t={tab(i)} i={i} lit={lit(i)} />)}
    <NewTabRow g={g} look={look} opts={opts} i={n} />
  </>;
  return <Rest g={g} look={look} opts={opts} {...tabsSlot(opts, list)}
    crumb={<CrumbSwap g={g} look={look} t={t} a={tab(0)} b={tab(TO)} ms={GO + 40} back={BACK} />}
    page={<PageSwap g={g} look={look} t={t} ms={GO + 80} back={BACK} />} />;
};

// ⌘L: the command bar grows out of the address, or drops into the middle of the page.
const OPEN = 380, CLOSE = 1900;

function fieldPanel(g: Geo, opts: SceneOpts): { from: Rect; to: Rect } {
  const F = M.field;
  if (opts.addressInSidebar) return { from: F, to: { x: F.x, y: F.y, w: F.w + 160, h: M.suggestion.inputField + 3 * M.suggestion.height + 14 } };
  const c = cardOf(g, opts);
  const crumbX = opts.top ? M.crumbXTop : M.crumbX;
  return {
    from: { x: c.x + crumbX - 8, y: c.y + 6, w: 300, h: 30 },
    to: { x: c.x + crumbX - 40, y: c.y + 0.5, w: Math.min(M.panel.fieldMax, c.w - crumbX + 28), h: PANEL_H },
  };
}

export const CmdlField: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, setupScene.commandBar);
  const { from, to } = fieldPanel(g, opts);
  const field = opts.addressInSidebar;
  return <Rest g={g} look={look} opts={opts} over={<>
    <FloatPanel g={g} look={look} rect={to} r={field ? M.panel.fieldRadius : M.panel.radius} style={growTrip(t, g, from, to, OPEN, CLOSE)}>
      <InputRow g={g} look={look} height={field ? M.suggestion.inputField : undefined}><SelectedUrl g={g} look={look} /></InputRow>
      <Divider g={g} look={look} />
      <SuggestionList g={g} look={look} t={t} rows={CURRENT} ms={OPEN + 160} />
    </FloatPanel>
    <KeyPress g={g} look={look} t={t} label="⌘L" ms={OPEN - 240} back={CLOSE} />
  </>} />;
};

export const CmdlCentred: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, setupScene.commandBar);
  return <Rest g={g} look={look} opts={opts} over={<>
    <FloatPanel g={g} look={look} rect={centredFrame(g, opts)} style={dropTrip(t, g, OPEN, CLOSE)}>
      <InputRow g={g} look={look}><SelectedUrl g={g} look={look} /></InputRow>
      <Divider g={g} look={look} />
      <SuggestionList g={g} look={look} t={t} rows={CURRENT} ms={OPEN + 160} />
    </FloatPanel>
    <KeyPress g={g} look={look} t={t} label="⌘L" ms={OPEN - 240} back={CLOSE} />
  </>} />;
};

// ⌘T: a new tab slides into the list, or the command bar opens empty.
function InsertedList({ g, look, opts, t, at, ms, back }: { g: Geo; look: Look; opts: SceneOpts; t: Tracker; at: number; ms: number; back: number }) {
  const n = tabCount(g, opts);
  const step = pitchOf(opts) * g.s;
  const push = t.trip(0, step, ms, back + 80, 300, 300);
  const arrive = t.pulse(ms + 100, back, 240, 200);
  const enter = opts.top ? [{ translateY: t.trip(-8 * g.s, 0, ms + 100, back, 300, 200) }] : [{ translateX: t.trip(-12 * g.s, 0, ms + 100, back, 300, 200) }];
  const oldSelected = t.trip(1, 0, ms + 100, back, 220, 220);
  const pushedOut = (i: number) => (opts.top && i + 1 >= n ? { opacity: t.trip(1, 0, ms, back + 80, 300, 300) } : null);
  return <>
    <Selected g={g} look={look} opts={opts} style={{ opacity: oldSelected, transform: along(opts, at === 0 ? push : t.trip(0, 0, ms, back)) }} />
    <Selected g={g} look={look} opts={opts} i={at} style={{ opacity: arrive, transform: enter }} />
    {Array.from({ length: n }, (_, i) => <ListItem key={i} g={g} look={look} opts={opts} t={tab(i)} i={i} lit={i === 0 ? oldSelected : undefined}
      style={[i >= at ? { transform: along(opts, push) } : null, pushedOut(i)]} />)}
    <ListItem g={g} look={look} opts={opts} t={BLANK} i={at} lit={arrive} style={{ opacity: arrive, transform: enter }} />
    <NewTabRow g={g} look={look} opts={opts} i={n} style={{ transform: along(opts, push) }} />
  </>;
}

function NewTabArrives({ g, look, opts, t, ms, back }: { g: Geo; look: Look; opts: SceneOpts; t: Tracker; ms: number; back: number }) {
  return <>
    <Page g={g} look={look} top={M.toolbar} />
    <Animated.View style={[fill, { opacity: t.pulse(ms, back, 300, 240) }]}>
      <NewTabPage g={g} look={look} width={cardOf(g, opts).w} top={M.toolbar} />
    </Animated.View>
  </>;
}

const FadingCrumb = ({ g, look, t, ms, back }: { g: Geo; look: Look; t: Tracker; ms: number; back: number }) =>
  <Crumb g={g} look={look} t={tab(0)} style={[fill, { opacity: t.trip(1, 0, ms, back, 160, 240) }]} />;

const endSlot = (g: Geo, opts: SceneOpts) => (opts.top ? tabCount(g, opts) - 1 : tabCount(g, opts));

export const NewTabOpensPage: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, setupScene.newTab);
  return <Rest g={g} look={look} opts={opts}
    {...tabsSlot(opts, <InsertedList g={g} look={look} opts={opts} t={t} at={endSlot(g, opts)} ms={OPEN} back={CLOSE} />)}
    crumb={<FadingCrumb g={g} look={look} t={t} ms={OPEN + 100} back={CLOSE} />}
    page={<NewTabArrives g={g} look={look} opts={opts} t={t} ms={OPEN + 160} back={CLOSE} />}
    over={<KeyPress g={g} look={look} t={t} label="⌘T" ms={OPEN - 240} back={CLOSE} />} />;
};

export const NewTabOpensBar: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, setupScene.newTab);
  return <Rest g={g} look={look} opts={opts} over={<>
    <FloatPanel g={g} look={look} rect={centredFrame(g, opts)} style={dropTrip(t, g, OPEN, CLOSE)}>
      <InputRow g={g} look={look}>
        <Caret g={g} look={look} style={{ marginRight: space.hair * g.s }} />
        <Label g={g} size={font.size.input} color={look.c.textTertiary}>Search or enter an address</Label>
      </InputRow>
      <Divider g={g} look={look} />
      <SuggestionList g={g} look={look} t={t} rows={FRESH} ms={OPEN + 160} />
    </FloatPanel>
    <KeyPress g={g} look={look} t={t} label="⌘T" ms={OPEN - 240} back={CLOSE} />
  </>} />;
};

export function newTabAt(where: 'top' | 'end' | 'adjacent'): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, setupScene.newTabPosition);
    const slot = where === 'top' ? 0 : where === 'adjacent' ? 1 : endSlot(g, opts);
    return <Rest g={g} look={look} opts={opts}
      {...tabsSlot(opts, <InsertedList g={g} look={look} opts={opts} t={t} at={slot} ms={OPEN} back={CLOSE - 300} />)}
      crumb={<FadingCrumb g={g} look={look} t={t} ms={OPEN + 100} back={CLOSE - 300} />}
      over={<KeyPress g={g} look={look} t={t} label="⌘T" ms={OPEN - 240} back={CLOSE - 300} />} />;
  };
}

// Inactive tabs: time passes and the ones left alone fold away.
const STALE = new Set([1, 3, 4]);
export function tidy(auto: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, setupScene.tidy);
    const c = cardOf(g, opts);
    const n = tabCount(g, opts);
    const pitch = pitchOf(opts) * g.s;
    const back = 2500;
    const stale = (i: number) => STALE.has(i) && i < n;
    const above = (i: number) => [...STALE].filter(o => o < i && o < n).length;
    const gone = auto ? { opacity: t([[850, 1], [1000, 0.4], [1060, 0.4], [1300, 0], [back, 0], [back + 400, 1]]),
      transform: [{ scale: t([[1060, 1], [1300, 0.92], [back, 0.92], [back + 400, 1]]) }] } : null;
    const rise = (k: number) => (auto && k ? { transform: along(opts, t([[1140, 0], [1460, -k * pitch], [back, -k * pitch], [back + 400, 0]])) } : null);
    const list = <>
      {opts.top && <Selected g={g} look={look} opts={opts} />}
      {Array.from({ length: n }, (_, i) => <ListItem key={i} g={g} look={look} opts={opts} t={tab(i)} i={i} selected={i === 0}
        lit={opts.top && i === 0 ? 1 : undefined} style={stale(i) ? gone : rise(above(i))} />)}
      <NewTabRow g={g} look={look} opts={opts} i={n} style={rise(above(n))} />
    </>;
    return <Rest g={g} look={look} opts={opts} {...tabsSlot(opts, list)} over={
      <Pill g={g} look={look} place={{ right: (g.W - c.x - c.w + 16) * g.s, top: (c.y + 54) * g.s }}
        style={{ opacity: t.pulse(120, back + 200, 220, 260), transform: [{ translateY: t.trip(-6 * g.s, 0, 120, back + 200, 280, 260) }] }}>
        <Animated.View style={{ transform: [{ rotate: t.deg([[200, 0], [900, 360]]) }] }}>
          <MockGlyph g={g} name="clock" size={13} color={look.c.textPrimary} box={16} />
        </Animated.View>
        <Label g={g} size={font.size.body} color={look.c.textPrimary} weight="medium">12 hours later</Label>
      </Pill>} />;
  };
}

// Quit and come back: the same tabs, or one new tab.
export function quit(fresh: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, setupScene.quit);
    const c = cardOf(g, opts);
    const leave = 360, arrive = 900, leaveAgain = 2100, returnAt = 2600;
    const back = fresh ? returnAt : arrive;
    const window = { opacity: t([[leave, 1], [leave + 240, 0], [back, 0], [back + 320, 1]]),
      transform: [{ scale: t([[leave, 1], [leave + 240, 0.97], [back, 0.97], [back + 320, 1]]) }] };
    const blank = { opacity: t([[arrive, 0], [arrive + 320, 1], [leaveAgain, 1], [leaveAgain + 240, 0]]),
      transform: [{ scale: t([[arrive, 0.97], [arrive + 320, 1], [leaveAgain, 1], [leaveAgain + 240, 0.97]]) }] };
    return <>
      <Desktop look={look} />
      <Animated.View style={[fill, window]}><Rest g={g} look={look} opts={opts} /></Animated.View>
      {fresh && <Animated.View style={[fill, blank]}>
        <Rest g={g} look={look} opts={opts} crumb={null} page={<NewTabPage g={g} look={look} width={c.w} top={M.toolbar} />}
          {...tabsSlot(opts, <>
            {opts.top && <Selected g={g} look={look} opts={opts} />}
            <ListItem g={g} look={look} opts={opts} t={BLANK} i={0} selected lit={opts.top ? 1 : undefined} />
            <NewTabRow g={g} look={look} opts={opts} i={1} />
          </>)} />
      </Animated.View>}
      <KeyPress g={g} look={look} t={t} label="⌘Q" ms={leave - 260} back={leave + 300} />
    </>;
  };
}

function Desktop({ look }: { look: Look }) {
  const [a] = look.dark ? ink.desktop.dark : ink.desktop.light;
  return <View style={[fill, { backgroundColor: a }]} />;
}

// Two windows: with shared tabs, choosing a tab in one shows it as open in the other.
const MINI_SIDE = 150;
function MiniMerlin({ g, look, rect, tabs, sel, dim, extra, content }: {
  g: Geo; look: Look; rect: Rect; tabs: Tab[]; sel?: number; dim?: (i: number) => object | null; extra?: ReactNode; content?: ReactNode;
}) {
  const card: Rect = { x: MINI_SIDE + M.defaultFrame - M.row.x, y: M.defaultFrame, w: rect.w - MINI_SIDE - 2 * M.defaultFrame + M.row.x, h: rect.h - 2 * M.defaultFrame };
  return <WindowFrame g={g} look={look} style={atRect(g, rect)}>
    <Backdrop look={look} />
    <Lights g={g} y={M.lights.strip} />
    {extra}
    {tabs.map((tb, i) => <TabRow key={i} g={g} look={look} t={tb} y={rowY(i)} w={MINI_SIDE - 12} selected={i === sel} style={dim?.(i)} />)}
    <Animated.View style={[atRect(g, card), { borderRadius: M.cardRadius * g.s, overflow: 'hidden', backgroundColor: look.c.contentBackground }]}>
      <Toolbar g={g} look={look} w={card.w} t={tabs[sel ?? 0] ?? tab(0)} icons={[21, 56]} crumbX={84} />
      {content ?? <Page g={g} look={look} top={M.toolbar} />}
    </Animated.View>
  </WindowFrame>;
}

export function windows(shared: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, setupScene.windows);
    const w = (g.W - 50) / 2, h = g.H - 56;
    const a: Rect = { x: 18, y: 26, w, h };
    const b: Rect = { x: 32 + w, y: 30, w, h };
    const list = [tab(0), tab(1), tab(2), tab(3)];
    const other = shared ? list : [tab(4), tab(5), tab(6)];
    const from = { x: a.x + w * 0.62, y: a.y + h * 0.78 };
    const to = { x: a.x + 70, y: a.y + rowY(2) + 14 };
    const click = 1100, back = 3000, out = 300;
    const dimB = (i: number) => {
      if (!shared) return null;
      if (i === 0) return { opacity: t([[click + 40, 0.4], [click + 300, 1]]) };
      if (i === 2) return { opacity: t([[click + 40, 1], [click + 300, 0.4]]) };
      return null;
    };
    return <>
      <Desktop look={look} />
      <Animated.View style={[fill, { opacity: t.trip(1, 0, out, back + 260, 240, 300), transform: [{ scale: t.trip(1, 0.96, out, back + 260, 240, 300) }] }]}>
        <Rest g={g} look={look} opts={opts} />
      </Animated.View>
      <Animated.View style={[fill, { opacity: t.pulse(out + 200, back, 300, 240) }]}>
        <MiniMerlin g={g} look={look} rect={a} tabs={list} dim={i => (shared && i === 1 ? { opacity: 0.4 } : null)}
          extra={<Highlight g={g} look={look} y={rowY(0)} w={MINI_SIDE - 12} style={{ transform: [{ translateY: t([[click, 0], [click + 300, 2 * M.row.pitch * g.s]]) }] }} />}
          content={<>
            <Animated.View style={[fill, { opacity: t.out(click + 40, 200) }]}><Page g={g} look={look} top={M.toolbar} /></Animated.View>
            <Animated.View style={[fill, { opacity: t.in(click + 80, 260) }]}><Page g={g} look={look} a={TRIP} top={M.toolbar} /></Animated.View>
          </>} />
        <MiniMerlin g={g} look={look} rect={b} tabs={other} sel={shared ? 1 : 0} dim={dimB} />
        <Cursor g={g} style={{ opacity: t([[600, 0], [760, 1], [back - 400, 1], [back - 160, 0]]), transform: [
          { translateX: t([[600, from.x * g.s], [click - 40, to.x * g.s]]) },
          { translateY: t([[600, from.y * g.s], [click - 40, to.y * g.s]]) },
          { scale: t([[click - 20, 1], [click + 20, 0.85], [click + 140, 1]], linearEase) },
        ] }} />
      </Animated.View>
    </>;
  };
}

// Appearance: a pill names it; Automatic turns the window from one to the other.
export function appearance(mode: 'system' | 'light' | 'dark'): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, setupScene.appearance);
    const flip = lookFor(!look.dark, opts.accent, opts.theme);
    const turn = 700, back = 2000;
    const named = (dark: boolean) => (mode === 'system' ? `Auto · ${dark ? 'Dark' : 'Light'} like your Mac` : dark ? 'Dark' : 'Light');
    const pill = (l: Look, opacity: Animated.AnimatedInterpolation<number>) =>
      <Pill g={g} look={l} style={{ opacity, transform: [{ translateY: t.trip(6 * g.s, 0, 300, back + 300, 280, 240) }] }}>
        <Animated.View style={{ transform: [{ rotate: t.deg([[340, -90], [780, 0]]) }] }}>
          <MockGlyph g={g} name={l.dark ? 'moon.fill' : 'sun.max.fill'} size={M.pill.glyph} color={l.dark ? ink.moon : ink.sun} box={18} />
        </Animated.View>
        <Label g={g} size={font.size.body} color={l.c.textPrimary} weight="medium">{named(l.dark)}</Label>
      </Pill>;
    if (mode !== 'system') return <Rest g={g} look={look} opts={opts} over={pill(look, t.pulse(300, back + 300, 220, 240))} />;
    return <>
      <Rest g={g} look={look} opts={opts} />
      <Animated.View style={[fill, { opacity: t.pulse(turn, back, 420, 420) }]}><Rest g={g} look={flip} opts={opts} /></Animated.View>
      {pill(look, t([[300, 0], [520, 1], [turn, 1], [turn + 200, 0], [back + 200, 0], [back + 420, 1], [back + 600, 1], [back + 800, 0]]))}
      {pill(flip, t([[turn + 200, 0], [turn + 420, 1], [back, 1], [back + 200, 0]]))}
    </>;
  };
}

// The toolbar's colour: a page loads and the toolbar takes on its colour, or keeps the workspace's.
export function siteColor(on: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, setupScene.siteColor);
    const load = 500, loaded = 1100;
    const tint = on ? t([[load, 1], [load + 200, 0], [loaded + 120, 0], [loaded + 520, 1]]) : 0;
    return <Rest g={g} look={look} opts={{ ...opts, siteColor: on }} site={tint} page={<>
      <View style={[fill, { top: M.toolbar * g.s, backgroundColor: look.c.contentBackground }]} />
      <Animated.View style={[fill, { opacity: t([[load, 1], [load + 200, 0], [loaded, 0], [loaded + 320, 1]]),
        transform: [{ translateY: t([[load + 200, 0], [loaded, 6 * g.s], [loaded + 340, 0]]) }] }]}>
        <Page g={g} look={look} top={M.toolbar} />
      </Animated.View>
    </>} />;
  };
}

// Links from other apps: a message's link opens a small window over the desktop, or a tab in Merlin.
export function links(compact: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, setupScene.links);
    const click = 900, back = 3000;
    const bubble: Rect = { x: 40, y: g.H - 190, w: 300, h: 130 };
    const small: Rect = { x: g.W * 0.38, y: 70, w: g.W * 0.56, h: g.H * 0.62 };
    const message = <FloatPanel g={g} look={look} rect={bubble} r={radius.popover} style={{ opacity: t.pulse(200, back, 260, 260),
      transform: [{ translateY: t.trip(12 * g.s, 0, 200, back, 300, 260) }] }}>
      <View style={{ padding: space.lg * g.s, gap: space.sm * g.s }}>
        <Label g={g} size={font.size.body} color={look.c.textPrimary} weight="semibold">Messages</Label>
        <View style={{ alignSelf: 'flex-start', paddingHorizontal: space.md * g.s, paddingVertical: space.sm * g.s, borderRadius: radius.popover * g.s, backgroundColor: look.c.accentSoft }}>
          <Label g={g} size={font.size.body} color={look.c.textPrimary}>The route for Saturday</Label>
          <Label g={g} size={font.size.label} color={look.c.textLink} weight="medium">↗  maps.trails.no</Label>
        </View>
      </View>
    </FloatPanel>;
    if (compact) return <>
      <Rest g={g} look={look} opts={opts} />
      {message}
      <Animated.View style={[atRect(g, small), { opacity: t.pulse(click, back - 200, 280, 240), transform: [{ scale: t.trip(0.9, 1, click, back - 200, 320, 240) }] }]}>
        <WindowFrame g={g} look={look} style={fill}>
          <Backdrop look={look} />
          <View style={[fill, { left: M.defaultFrame * g.s, right: M.defaultFrame * g.s, top: (M.toolbar - 4) * g.s, bottom: M.defaultFrame * g.s,
            borderRadius: M.cardRadius * g.s, overflow: 'hidden', backgroundColor: look.c.contentBackground }]}>
            <Page g={g} look={look} a={TRIP} />
          </View>
          <View style={{ position: 'absolute', left: M.chip.x * g.s, top: M.crumbTop * g.s * 0.9 }}><Crumb g={g} look={look} t={tab(2)} /></View>
          <Lights g={g} y={M.lights.strip} />
        </WindowFrame>
      </Animated.View>
    </>;
    return <Rest g={g} look={look} opts={opts}
      {...tabsSlot(opts, <InsertedList g={g} look={look} opts={opts} t={t} at={endSlot(g, opts)} ms={click} back={back - 200} />)}
      crumb={<CrumbSwap g={g} look={look} t={t} a={tab(0)} b={tab(2)} ms={click + 60} back={back - 200} />}
      page={<PageSwap g={g} look={look} t={t} ms={click + 100} back={back - 200} />}
      over={message} />;
  };
}

/** A still window, for choices whose effect is the window itself. */
export const Still: Scene = ({ g, look, opts }) => <Rest g={g} look={look} opts={opts} />;

// Favourites: the sites you pin sit above your tabs, as the sidebar's tiles or
// the strip's pinned tabs. Each one springs in as you choose it, as pinning does.
const P = M.pins;

function PinTile({ g, look, id, x, y, w, h, icon, r }: { g: Geo; look: Look; id: string; x: number; y: number; w: number; h: number; icon: number; r: number }) {
  const { reduceMotion } = useTheme();
  const scale = useArrival(true, reduceMotion);
  return <Animated.View style={[atRect(g, { x, y, w, h }), { alignItems: 'center', justifyContent: 'center', transform: [{ scale }] }]}>
    <Plate fill={look.c.tilePinned} radius={r * g.s} style={fill} />
    <Mark id={id} size={icon * g.s} />
  </Animated.View>;
}

function DashedLine({ g, look, y }: { g: Geo; look: Look; y: number }) {
  const count = Math.floor((M.row.w + P.dash) / (P.dash * 2));
  return <View pointerEvents="none" style={[atRect(g, { x: M.row.x, y, w: M.row.w, h: 1 }), { flexDirection: 'row', gap: P.dash * g.s, overflow: 'hidden' }]}>
    {Array.from({ length: count }, (_, i) => <View key={i} style={{ width: P.dash * g.s, height: hairline, backgroundColor: look.c.sidebarRule }} />)}
  </View>;
}


function SidebarPins({ g, look, ids }: { g: Geo; look: Look; ids: readonly string[] }) {
  const columns = Math.max(1, Math.min(P.columns, ids.length));
  const w = (M.row.w - P.gap * (columns - 1)) / columns;
  const rows = Math.ceil(ids.length / columns);
  const below = ids.length ? M.row.top + rows * (P.tileH + P.gap) - P.gap + P.rule : M.row.top;
  return <>
    {ids.map((id, i) => <PinTile key={id} g={g} look={look} id={id} x={M.row.x + (i % columns) * (w + P.gap)} y={M.row.top + Math.floor(i / columns) * (P.tileH + P.gap)}
      w={w} h={P.tileH} icon={P.icon} r={radius.tile} />)}
    {!!ids.length && <DashedLine g={g} look={look} y={below - P.rule / 2} />}
    <Rows g={g} look={look} n={Math.max(1, restRowCount(g) - rows)} sel={0} top={below} />
  </>;
}

function StripPins({ g, look, ids, site }: { g: Geo; look: Look; ids: readonly string[]; site: number }) {
  const dockW = ids.length ? ids.length * P.strip + (ids.length - 1) * P.stripGap + 2 * P.dockPad : 0;
  const from = M.chip.x + (ids.length ? dockW + space.xs + space.hair / 2 : 0);
  const n = Math.max(1, Math.min(4, Math.floor((g.W - from - 2 * M.crumbTrailing) / chipStep)));
  return <>
    {!!ids.length && <View style={[atRect(g, { x: M.chip.x, y: M.chip.top, w: dockW, h: M.chip.h }), { borderRadius: radius.tab * g.s,
      backgroundColor: look.c.fillShellGroup, borderWidth: hairline, borderColor: look.c.tabDivider }]} />}
    {ids.map((id, i) => <PinTile key={id} g={g} look={look} id={id} x={M.chip.x + P.dockPad + i * (P.strip + P.stripGap)} y={M.chip.top + P.dockPad}
      w={P.strip} h={M.chip.h - 2 * P.dockPad} icon={P.stripIcon} r={radius.tab - P.dockPad} />)}
    <SelectedChip g={g} look={look} x={from} site={site} />
    {Array.from({ length: n }, (_, i) => <TabRow key={i} g={g} look={look} t={tab(i)} x={from + i * chipStep} y={chipY} w={M.chip.w} lit={i === 0 ? 1 : undefined} />)}
  </>;
}

export const Favourites: Scene = ({ g, look, opts }) => {
  const ids = opts.favorites.slice(0, opts.top ? 6 : 8);
  return <Rest g={g} look={look} opts={opts} {...tabsSlot(opts, opts.top ? <StripPins g={g} look={look} ids={ids} site={opts.siteColor ? 1 : 0} /> : <SidebarPins g={g} look={look} ids={ids} />)} />;
};
