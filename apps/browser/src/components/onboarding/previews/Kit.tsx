// The preview window's pieces, drawn to scale on its canvas. Adapted from
// Ardia's onboarding previews (Kit.tsx, Floating.tsx; Apache-2.0, see NOTICE)
// with Merlin's sidebar rows, tabs, toolbar and colour roles.
import React, { type ReactNode } from 'react';
import { Animated, Text as NativeText, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Glyph, Plate, WorkspaceTint, font, radius, setupMock as M, setupMockInk as ink, shadow, trafficLightColors, type SymbolName } from '../../ui';
import { Mark } from '../SetupMarks';
import { at, atRect, fill, hairline, NEW_TAB, rowY, tab, type Geo, type Look, type Rect, type Suggestion, type Tab } from './mock';

export type Styles = StyleProp<ViewStyle> | object;
export type Lit = Animated.AnimatedInterpolation<number> | Animated.Value | number;

export function Label({ g, size, color, weight = 'regular', serif, lines = 1, style, children }: {
  g: Geo; size: number; color: string; weight?: keyof typeof font.weight; serif?: boolean; lines?: number;
  style?: StyleProp<TextStyle>; children: ReactNode;
}) {
  return <NativeText numberOfLines={lines} style={[{ fontSize: size * g.s, lineHeight: size * 1.3 * g.s, color,
    fontWeight: font.weight[weight], fontFamily: serif ? font.serif : font.family }, style]}>{children}</NativeText>;
}

export function MockGlyph({ g, name, size, color, weight, box }: {
  g: Geo; name: SymbolName; size: number; color: string; weight?: 'regular' | 'medium' | 'semibold' | 'bold'; box?: number;
}) {
  const side = (box ?? size + 4) * g.s;
  return <View style={{ width: side, height: side, alignItems: 'center', justifyContent: 'center' }}>
    <Glyph name={name} size={size * g.s} color={color} weight={weight} />
  </View>;
}

/** The window behind the page: Merlin's shell, tinted with the workspace colour. */
export function Backdrop({ look }: { look: Look }) {
  return <View pointerEvents="none" style={[fill, { backgroundColor: look.c.windowBackground }]}>
    {look.theme ? <WorkspaceTint theme={look.theme} /> : <View style={[fill, { backgroundColor: look.c.shellTint }]} />}
  </View>;
}

export function Lights({ g, y = M.lights.toolbar, x = M.lights.x, style }: { g: Geo; y?: number; x?: number; style?: Styles }) {
  const size = M.lights.size;
  return <Animated.View pointerEvents="none" style={[at(g, x - size / 2, y - size / 2, M.lights.pitch * 2 + size, size), style as ViewStyle]}>
    {trafficLightColors.map((color, i) => <View key={color} style={[at(g, i * M.lights.pitch, 0, size, size),
      { borderRadius: size / 2 * g.s, backgroundColor: color, borderWidth: hairline, borderColor: ink.lightsRim }]} />)}
  </Animated.View>;
}

/** A tab's icon: the site's own where setup has it, else a tinted tile, as a page without one gets. */
export function Favicon({ g, t, look, size = M.row.favicon }: { g: Geo; t: Tab; look: Look; size?: number }) {
  if (t === NEW_TAB) return <MockGlyph g={g} name="plus" size={size * 0.8} color={look.c.iconSecondary} box={size} />;
  if (t.mark) return <Mark id={t.mark} size={size * g.s} />;
  return <View style={{ width: size * g.s, height: size * g.s, borderRadius: size * 0.25 * g.s, backgroundColor: t.color,
    alignItems: 'center', justifyContent: 'center' }}>
    <MockGlyph g={g} name={t.icon} size={size * 0.58} color={ink.glyphOnTint} weight="semibold" box={size} />
  </View>;
}

/** The selected row's card, as the sidebar draws it. */
export function Highlight({ g, look, x = M.row.x, y, w = M.row.w, h = M.row.h, style }: {
  g: Geo; look: Look; x?: number; y: number; w?: number; h?: number; style?: Styles;
}) {
  return <Animated.View pointerEvents="none" style={[at(g, x, y, w, h), style as ViewStyle]}>
    <Plate fill={look.c.tabActive} radius={radius.row * g.s} edge={look.c.tabActiveBorder}
      shadow={{ color: look.c.shadowColor, opacity: look.dark ? shadow.tab.opacity * 2 : shadow.tab.opacity, radius: shadow.tab.radius * g.s, offsetY: shadow.tab.offsetY * g.s }}
      style={fill} />
  </Animated.View>;
}

export function TabRow({ g, look, t, x = M.row.x, y, w = M.row.w, selected, lit, style }: {
  g: Geo; look: Look; t: Tab; x?: number; y: number; w?: number; selected?: boolean; lit?: Lit; style?: Styles;
}) {
  const title = (color: string, strong: boolean) => <Label g={g} size={font.size.body} color={color} weight={strong ? 'medium' : 'regular'}>{t.title}</Label>;
  const c = look.c;
  return <Animated.View style={[at(g, x, y, w, M.row.h), style as ViewStyle]}>
    {selected && <Highlight g={g} look={look} x={0} y={0} w={w} />}
    <View style={[fill, { flexDirection: 'row', alignItems: 'center', paddingLeft: M.row.inset * g.s, paddingRight: M.row.inset * g.s, gap: M.row.gap * g.s }]}>
      <Favicon g={g} t={t} look={look} />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {title(t === NEW_TAB ? c.textSecondary : selected ? c.tabTextActive : c.tabText, !!selected)}
        {lit !== undefined && <Animated.View style={[fill, { justifyContent: 'center', opacity: lit }]}>{title(c.tabTextActive, true)}</Animated.View>}
      </View>
    </View>
  </Animated.View>;
}

export function Rows({ g, look, from = 0, n, sel, top = M.row.top, newTab = true }: {
  g: Geo; look: Look; from?: number; n: number; sel?: number; top?: number; newTab?: boolean;
}) {
  return <>
    {Array.from({ length: n }, (_, i) => <TabRow key={i} g={g} look={look} t={tab(from + i)} y={rowY(i, top)} selected={i === sel} />)}
    {newTab && <TabRow g={g} look={look} t={NEW_TAB} y={rowY(n, top)} />}
  </>;
}

export function NavIcons({ g, color, xs, y, names = ['sidebar.left', 'chevron.left', 'chevron.right', 'arrow.clockwise'], style }: {
  g: Geo; color: string; xs: readonly number[]; y: number; names?: readonly SymbolName[]; style?: Styles;
}) {
  const box = M.glyph.navBox;
  return <Animated.View pointerEvents="none" style={[fill, style as ViewStyle]}>
    {xs.map((x, i) => <View key={i} style={[at(g, x - box / 2, y - box / 2, box, box), { alignItems: 'center', justifyContent: 'center' }]}>
      <MockGlyph g={g} name={names[i] ?? 'circle.fill'} size={M.glyph.nav} color={color} box={box} />
    </View>)}
  </Animated.View>;
}

/** The address as Merlin shows it at rest: the site, then the page's title. */
export function Crumb({ g, look, t, style }: { g: Geo; look: Look; t: Tab; style?: Styles }) {
  const c = look.c;
  return <Animated.View style={[{ flexDirection: 'row', alignItems: 'center' }, style as ViewStyle]}>
    <Label g={g} size={font.size.body} color={c.textPrimary} weight="medium" style={{ flexShrink: 1 }}>
      {t.host.replace(/^www\./, '')}
      <NativeText style={{ color: c.textSecondary, fontWeight: font.weight.regular }}>{`  /  ${t.title}`}</NativeText>
    </Label>
  </Animated.View>;
}

export function ToolbarBand({ g, h = M.toolbar, background, divider, dividerStyle, style, children }: {
  g: Geo; h?: number; background?: string; divider?: string; dividerStyle?: Styles; style?: Styles; children?: ReactNode;
}) {
  return <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: h * g.s, backgroundColor: background }, style as ViewStyle]}>
    {children}
    {divider && <Animated.View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, height: hairline, backgroundColor: divider }, dividerStyle as ViewStyle]} />}
  </Animated.View>;
}

export function Toolbar({ g, look, w, t, crumbX = M.crumbX, icons = M.toolbarIcons }: {
  g: Geo; look: Look; w: number; t: Tab; crumbX?: number; icons?: readonly number[];
}) {
  return <ToolbarBand g={g} background={look.c.toolbarBackground} divider={look.c.toolbarDivider}>
    <NavIcons g={g} color={look.c.iconSecondary} xs={icons} y={M.toolbar / 2}
      names={icons.length === 3 ? ['chevron.left', 'chevron.right', 'arrow.clockwise'] : icons.length === 2 ? ['chevron.left', 'chevron.right'] : undefined} />
    <Crumb g={g} look={look} t={t} style={at(g, crumbX, M.crumbTop, w - crumbX - M.crumbTrailing, M.crumbH)} />
  </ToolbarBand>;
}

/** The address field in the sidebar. */
export function FieldPlate({ g, look, style, children }: { g: Geo; look: Look; style?: Styles; children?: ReactNode }) {
  return <Animated.View style={[{ position: 'absolute', borderRadius: radius.field * g.s, backgroundColor: look.c.omniboxIdle }, style as ViewStyle]}>{children}</Animated.View>;
}

/** The page's card inside the window. */
export function Card({ g, look, rect, style, children }: { g: Geo; look: Look; rect?: Rect; style?: Styles; children?: ReactNode }) {
  return <Animated.View style={[rect ? atRect(g, rect) : { position: 'absolute' }, { borderRadius: M.cardRadius * g.s,
    backgroundColor: look.c.contentBackground, borderWidth: hairline, borderColor: look.c.contentBorder, overflow: 'hidden' }, style as ViewStyle]}>
    {children}
  </Animated.View>;
}

/** The selected tab across the top, joined to the toolbar under it. */
export function TopTabPlate({ g, look, x, style, children }: { g: Geo; look: Look; x: number; style?: Styles; children?: ReactNode }) {
  return <Animated.View style={[at(g, x, M.chip.top - 2, M.chip.w, M.strip - M.chip.top + 2), { borderTopLeftRadius: radius.tab * g.s,
    borderTopRightRadius: radius.tab * g.s, overflow: 'hidden', backgroundColor: look.c.toolbarBackground }, style as ViewStyle]}>
    {children}
  </Animated.View>;
}

/** The window itself: rounded, edged and shadowed, its contents clipped to its corners. */
export function WindowFrame({ g, look, style, children }: { g: Geo; look: Look; style?: Styles; children?: ReactNode }) {
  const r = M.windowRadius * g.s;
  const drop = M.shadowWindow;
  return <View style={style as ViewStyle}>
    <Plate fill={look.c.windowBackground} radius={r} edge={pick2(look, ink.windowEdge)} style={fill}
      shadow={{ color: ink.shadow, opacity: look.dark ? drop.dark : drop.light, radius: drop.radius * g.s, offsetY: drop.offsetY * g.s }} />
    <View style={[fill, { borderRadius: r, overflow: 'hidden' }]}>{children}</View>
  </View>;
}
const pick2 = (look: Look, pair: { dark: string; light: string }) => (look.dark ? pair.dark : pair.light);

/** A floating panel over the window: the command bar, a pill. */
export function Floating({ g, look, radius: r, style, children }: { g: Geo; look: Look; radius: number; style?: Styles; children?: ReactNode }) {
  const drop = M.shadowFloat;
  return <Plate fill={look.c.surfacePopoverSolid} radius={r * g.s} edge={look.c.surfaceBorder} style={style as ViewStyle}
    shadow={{ color: ink.shadow, opacity: look.dark ? drop.dark : drop.light, radius: drop.radius * g.s, offsetY: drop.offsetY * g.s }}>
    {children}
  </Plate>;
}

export function FloatPanel({ g, look, rect, r = M.panel.radius, style, children }: {
  g: Geo; look: Look; rect: Rect; r?: number; style?: Styles; children?: ReactNode;
}) {
  return <Animated.View style={[atRect(g, rect), style as ViewStyle]}>
    <Floating g={g} look={look} radius={r} style={fill} />
    <View style={[fill, { borderRadius: r * g.s, overflow: 'hidden' }]}>{children}</View>
  </Animated.View>;
}

export function SuggestionRow({ g, look, s, selected, style }: { g: Geo; look: Look; s: Suggestion; selected?: boolean; style?: Styles }) {
  const c = look.c;
  const S = M.suggestion;
  return <Animated.View style={[{ height: S.height * g.s, borderRadius: radius.bubbleRow * g.s * 1.4, paddingHorizontal: S.padX * g.s,
    flexDirection: 'row', alignItems: 'center', gap: S.gap * g.s, backgroundColor: selected ? c.suggestionSelected : c.fillTransparent }, style as ViewStyle]}>
    {s.fav ? <Favicon g={g} t={s.fav} look={look} /> : <MockGlyph g={g} name={s.icon ?? 'magnifyingglass'} size={S.icon} color={c.textSecondary} box={S.iconBox} />}
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
      <Label g={g} size={font.size.title} color={c.textPrimary}>
        {s.title}{s.detail ? <NativeText style={{ color: c.textTertiary }}>{`  ${s.detail}`}</NativeText> : null}
      </Label>
    </View>
    {s.hint && <Label g={g} size={font.size.label} color={c.textTertiary}>{s.hint}</Label>}
  </Animated.View>;
}

export function InputRow({ g, look, height = M.suggestion.input, children }: { g: Geo; look: Look; height?: number; children?: ReactNode }) {
  return <View style={{ height: height * g.s, flexDirection: 'row', alignItems: 'center', paddingLeft: M.pill.height / 2 * g.s,
    paddingRight: M.pill.padX * g.s, gap: M.suggestion.gap * g.s }}>
    <MockGlyph g={g} name="magnifyingglass" size={M.glyph.nav + 1} color={look.c.textPrimary} box={M.suggestion.iconBox} />
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>{children}</View>
  </View>;
}

export function Divider({ g, look }: { g: Geo; look: Look }) {
  return <View style={{ height: hairline, marginHorizontal: M.pill.height / 2 * g.s, backgroundColor: look.c.borderDefault }} />;
}

/** A key being pressed, in the window's corner. */
export function Keycap({ g, look, label, style }: { g: Geo; look: Look; label: string; style?: Styles }) {
  const k = M.keycap;
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: k.right * g.s, top: (g.H - k.bottom) * g.s,
    height: k.height * g.s, paddingHorizontal: k.padX * g.s, borderRadius: k.radius * g.s, justifyContent: 'center',
    backgroundColor: look.c.keycapFill, borderWidth: hairline, borderColor: look.c.borderStrong }, style as ViewStyle]}>
    <Label g={g} size={k.size} color={look.c.keycapText} weight="semibold">{label}</Label>
  </Animated.View>;
}

/** A small floating label: the appearance, the time passing. */
export function Pill({ g, look, place, style, children }: { g: Geo; look: Look; place?: ViewStyle; style?: Styles; children: ReactNode }) {
  const P = M.pill;
  const corner = place ?? { left: M.crumbTrailing * g.s, bottom: M.crumbTrailing * g.s };
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute' }, corner, style as ViewStyle]}>
    <Floating g={g} look={look} radius={P.height / 2} style={{ height: P.height * g.s, paddingHorizontal: P.padX * g.s, flexDirection: 'row', alignItems: 'center', gap: P.gap * g.s }}>
      {children}
    </Floating>
  </Animated.View>;
}

export function Cursor({ g, style }: { g: Geo; style?: Styles }) {
  const box = M.suggestion.iconBox;
  return <Animated.View pointerEvents="none" style={[at(g, 0, 0, box, box), style as ViewStyle]}>
    <View style={[fill, { left: hairline * 2, top: hairline * 2 }]}><MockGlyph g={g} name="cursorarrow" size={M.glyph.nav + 1} color={ink.cursorRim} weight="bold" box={box} /></View>
    <MockGlyph g={g} name="cursorarrow" size={M.glyph.nav + 1} color={ink.cursor} weight="regular" box={box} />
  </Animated.View>;
}

/** The text cursor in a field. */
export function Caret({ g, look, style }: { g: Geo; look: Look; style?: Styles }) {
  return <Animated.View style={[{ width: hairline * 2.4, height: M.crumbH * g.s, borderRadius: hairline, backgroundColor: look.c.accent }, style as ViewStyle]} />;
}

/** The address selected in the command bar, as ⌘L leaves it. */
export function SelectedUrl({ g, look }: { g: Geo; look: Look }) {
  return <View style={{ flexShrink: 1, flexDirection: 'row' }}>
    <View style={{ flexShrink: 1, backgroundColor: look.c.textSelection, borderRadius: radius.xs / 2 * g.s }}>
      <Label g={g} size={font.size.title} color={look.c.textPrimary}>fieldnotes.blog/first-light</Label>
    </View>
  </View>;
}

export { at, atRect, fill };
