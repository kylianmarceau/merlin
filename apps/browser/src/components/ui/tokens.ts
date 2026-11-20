// Every colour, size, radius and shadow the shell draws with. This is the only
// file allowed to contain colour literals (see conventions.test.ts); features
// name a role, never a value. DESIGN.md describes how the roles are used.
//
// The look is "Tide": a workspace-tinted light shell, a neutral dark shell,
// glass popovers with uppercase section labels, and workspace accents for
// interactive states.

import type { Appearance } from '../../state/types';

export const space = { none: 0, hair: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 } as const;
export type Space = keyof typeof space;

export const radius = {
  none: 0, xs: 4, sm: 6, control: 8, row: 9, field: 10, tile: 10, tab: 10, card: 12, window: 12, panel: 16, popover: 18, dialog: 18,
  /** Anchored popovers and their rows, as in Ardia's panels (rows are concentric: 12 − 6). */
  bubble: 12, bubbleRow: 6,
  pill: 999,
} as const;
export type Radius = keyof typeof radius;

export const font = {
  family: 'System', mono: 'Menlo', serif: 'Georgia',
  size: { micro: 10, caption: 11, label: 12, body: 13, callout: 14, title: 15, input: 17, headline: 20, display: 30, greeting: 52 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  line: { micro: 13, caption: 14, label: 16, body: 18, row: 16, callout: 19, title: 20, input: 22, headline: 26, display: 36, greeting: 56 },
  tracking: { tight: -0.6, snug: -0.2, normal: 0, wide: 0.4, label: 0.8 },
} as const;

/** Sizes of recurring shell pieces, in points. */
export const geometry = {
  sidebar: 252, sidebarCollapsedInset: 84, stripTab: 173, stripTabMin: 96, stripTabIcon: 40, titlebar: 40, strip: 48, toolbar: 46,
  joinedTab: 38, joinedEar: 10,
  /** Crowded tabs on top, as in Dia: none narrower than this, and the active one never narrower than its own minimum. */
  stripTabFloor: 64, stripTabActive: 128,
  tabDragCardMax: 188, pageLinkMax: 172,
  /** A favourite's unread count, as a dock badge: this tall, and at least this wide. */
  unreadBadge: 15,
  /** A swipe back or forward's round arrow at the page's edge, and how far in it comes when letting go would navigate. */
  swipeChip: 40, swipeReach: 56,
  control: 28, controlLarge: 34, button: 30, row: 30, tabRow: 34, stripTabHeight: 32, address: 36, favourite: 44, favouriteSmall: 28,
  /** Dia's sidebar rhythm: 3 pt between tab rows (a 37 pt pitch), and the selected pinned tile's ring. */
  tabRowGap: 3, tileRing: 2.5,
  /** The new tab page's breathing area light: how tall its wash is. */
  areaLight: 420,
  /** A dashed rule's dashes and the gaps between them (under the favourite tiles, as in Ardia). */
  ruleDash: 3, ruleGap: 3,
  /** A playing tab's equaliser: each bar's width and the gap between them. */
  equaliserBar: 2.5, equaliserGap: 1.5,
  rowTall: 44, popoverRow: 32, icon: 16, iconSmall: 13, iconMedium: 15, iconLarge: 20,
  /** Every small icon button's hover square (each ×, a row's mute), and a hover card's action plates. */
  iconButton: 22, cardButton: 24, favicon: 16, tile: 28, round: 20, roundGlyph: 9, keycap: 18,
  toggleWidth: 28, toggleHeight: 16, toggleThumb: 12, progress: 4, focusRing: 2, hairline: 1, splitGap: 6, dot: 7,
  popover: 300, popoverWide: 340, menu: 240, dialog: 380, dialogWide: 520, palette: 620, paletteInput: 60, paletteRow: 42,
  /** Every centred pop-up (commands, new tab, Ctrl-Tab): the most rows its list shows, and its full height. */
  popupList: 336, popupHeight: 440, switcherCard: 176, switcherThumb: 110,
  /** Ardia's panel geometry: the arrow, row inset and padding, icon gap, downloads rows. */
  arrowWidth: 20, arrowHeight: 9, arrowGap: 1, popoverMargin: 8, panelRowInset: 6, panelRowPadding: 10, panelIconGap: 10,
  panelRow: 32, panelHeader: 24, panelSeparatorGap: 5, downloadRow: 40, fileIcon: 24, rowButton: 22, rowGlyph: 13, chevron: 9,
  slider: 160, sliderTrack: 4, sliderThumb: 16, pictureChoice: 128, pictureChoiceHeight: 80, appIcon: 56, popUpMin: 160, bookmarksBar: 28,
  bookmarksBarLarge: 34, toolbarCompact: 32, controlCompact: 24,
  /** Tab groups across the top: a chip with no title is its dot; titles are measured at about this much a character. */
  groupChip: 22, groupChipMax: 132, groupChipChar: 7, groupLine: 2,
  /** Peek's card over the page: its header. */
  peekHeader: 44,
  /** A tooltip's widest; a tab's hover card; the strip at the window's edge that brings hidden tabs in, and the room they keep around them. */
  tooltip: 280, hoverCard: 260, edgeStrip: 3, edgeStripWide: 8, peekSlack: 40, resizeHandle: 6, engineBadge: 11,
  /** A title's run before it fades: wider than any row, so the fade, not the text layout, ends it. */
  titleRun: 640,
  /** The downloads button's progress ring, the page-loading bar under the address, and the icon that flies to the button. */
  ringStroke: 2, loadingBar: 2, flyingIcon: 40,
  /** A dragged tab leaves the tabs for the page once it is this far outside them. */
  tearOff: 24,
  /** A drop zone's dashed edge: how far inside the card it is drawn, and how thick, at rest and under the tab; the card's own edge. */
  dropZoneInset: 9.5, dropZoneDash: 2, dropZoneDashActive: 2.33, dropZoneEdge: 0.5,
  sheetWidth: 840, sheetHeight: 640, sheetTall: 780, sheetNav: 208, settingsTab: 56, settingsTabHeight: 56, themePreview: 92, previewSidebar: 42, swatch: 30,
  suggestions: 8, fileWidth: 26, fileHeight: 32, fileFold: 8, findBar: 300, avatar: 30, historyHost: 170, timeColumn: 54, startColumn: 600, startInput: 48, siteCircle: 44, startLogo: 112, newTabInput: 52, newTabTop: 72, siteWidth: 64, toastWidth: 360, toastHeight: 40,
  /** A HUD's capsule, and how far below the window's top it sits. */
  hud: 36, hudTop: 16,
} as const;

/** Layer order inside the window, lowest first. */
export const layer = { content: 0, chrome: 1, sheet: 10, dialog: 20, popover: 30, toast: 40 } as const;

// Light keeps its sage-tinted neutrals. Dark uses an achromatic ramp.
const ink = {
  0: '#FFFFFF', 25: '#FBFCFB', 50: '#F6F8F6', 75: '#F1F3F1', 100: '#EAEEEB', 150: '#E1E6E2',
  300: '#B8C0BA', 400: '#979F99', 500: '#767E78', 600: '#5A615C', 700: '#434944', 800: '#2E332F',
  900: '#1F2421', 1000: '#000000',
} as const;
const darkInk = {
  0: '#FFFFFF', 25: '#FCFCFC', 50: '#F7F7F7', 100: '#EDEDED', 150: '#E5E5E5', 200: '#D6D6D6',
  300: '#BDBDBD', 400: '#9C9C9C', 500: '#828282', 700: '#474747', 800: '#303030', 850: '#262626',
  900: '#202020', 925: '#181818', 950: '#131313',
} as const;

// Keep the original IDs for saved appearances. Object order is picker order.
const accentScale = {
  graphite: {
    label: 'Graphite',
    light: { base: '#555555', hover: '#484848', pressed: '#3A3A3A', soft: '#E9E9E9', softText: '#414141', ring: '#818181', shell: 'rgba(228, 228, 228, 0.84)', swatch: '#C8C8C8' },
    dark: { base: '#C3C3C3', hover: '#D5D5D5', pressed: '#AAAAAA', soft: '#333333', softText: '#E1E1E1', ring: '#8E8E8E', swatch: '#575757' },
  },
  fern: {
    label: 'Sage',
    light: { base: '#2F6B58', hover: '#285D4C', pressed: '#214E40', soft: '#E2EEE8', softText: '#24544A', ring: '#7FB39E', shell: 'rgba(222, 232, 225, 0.84)', swatch: '#B8D4C3' },
    dark: { base: '#86C5A9', hover: '#9DD3BA', pressed: '#72B497', soft: '#1C3329', softText: '#BFE3D1', ring: '#4F8F75', swatch: '#3C5A4C' },
  },
  ocean: {
    label: 'Ocean',
    light: { base: '#1F6688', hover: '#1A5875', pressed: '#154A62', soft: '#DDEBF3', softText: '#164E69', ring: '#74AFCB', shell: 'rgba(219, 231, 239, 0.84)', swatch: '#9FD0EA' },
    dark: { base: '#79BCDD', hover: '#93CAE5', pressed: '#62AACF', soft: '#16303D', softText: '#B5DDF0', ring: '#4A8AAA', swatch: '#2F5266' },
  },
  iris: {
    label: 'Ember',
    light: { base: '#A4532E', hover: '#8F4727', pressed: '#7A3C21', soft: '#F5E4DA', softText: '#7E3E20', ring: '#D69A7B', shell: 'rgba(240, 229, 220, 0.84)', swatch: '#F6B49A' },
    dark: { base: '#E59A72', hover: '#ECAD8B', pressed: '#D9875D', soft: '#3A2419', softText: '#F5CDB7', ring: '#B36D4B', swatch: '#6B4232' },
  },
  gold: {
    label: 'Gold',
    light: { base: '#795400', hover: '#694800', pressed: '#593D00', soft: '#F6EBD1', softText: '#634600', ring: '#AE801B', shell: 'rgba(244, 235, 214, 0.84)', swatch: '#EDCF80' },
    dark: { base: '#E9BE62', hover: '#F0CE82', pressed: '#D7AC4E', soft: '#392D17', softText: '#F6DEA5', ring: '#C0943D', swatch: '#635022' },
  },
  teal: {
    label: 'Teal',
    light: { base: '#006765', hover: '#005856', pressed: '#004A48', soft: '#DCEFEB', softText: '#00504E', ring: '#45958F', shell: 'rgba(216, 235, 232, 0.84)', swatch: '#9DD8CF' },
    dark: { base: '#68CDBF', hover: '#8FDACE', pressed: '#54B9AA', soft: '#163531', softText: '#AAE6DD', ring: '#52A69A', swatch: '#2C6259' },
  },
  indigo: {
    label: 'Indigo',
    light: { base: '#414CA2', hover: '#37408C', pressed: '#2D3576', soft: '#E6E9F9', softText: '#353D83', ring: '#7F89CB', shell: 'rgba(224, 228, 245, 0.84)', swatch: '#B5BFF1' },
    dark: { base: '#A5ADF8', hover: '#BDC3FC', pressed: '#8E99EC', soft: '#292D49', softText: '#D0D4FA', ring: '#828CD3', swatch: '#424974' },
  },
  lavender: {
    label: 'Lavender',
    light: { base: '#70449B', hover: '#603985', pressed: '#502F70', soft: '#EFE6F7', softText: '#5C367F', ring: '#9D78BF', shell: 'rgba(234, 224, 242, 0.84)', swatch: '#D9BAED' },
    dark: { base: '#C7A3EF', hover: '#D8BCF5', pressed: '#B68DDD', soft: '#362843', softText: '#E7D0F8', ring: '#A781CA', swatch: '#584068' },
  },
  rose: {
    label: 'Rose',
    light: { base: '#98416C', hover: '#84365D', pressed: '#702C4E', soft: '#F7E5EE', softText: '#793255', ring: '#BB749B', shell: 'rgba(244, 224, 235, 0.84)', swatch: '#ECB2D2' },
    dark: { base: '#E8A0CA', hover: '#F2B9DB', pressed: '#D78AB7', soft: '#402636', softText: '#F5CDE6', ring: '#C678A7', swatch: '#633D55' },
  },
  ruby: {
    label: 'Ruby',
    light: { base: '#A13749', hover: '#8B2E3E', pressed: '#752633', soft: '#F8E5E8', softText: '#812C3A', ring: '#C86D7C', shell: 'rgba(245, 224, 226, 0.84)', swatch: '#EDADB5' },
    dark: { base: '#F299A8', hover: '#F7B1BD', pressed: '#E78394', soft: '#43252C', softText: '#F9CBD3', ring: '#D07888', swatch: '#6B3B45' },
  },
} as const satisfies Record<Appearance['accent'], unknown>;
export type AccentName = Appearance['accent'];

/** The order and names the Settings sheet shows. */
export const accents: readonly AccentName[] = Object.keys(accentScale) as AccentName[];
export const accentLabel = (name: AccentName) => accentScale[name].label;

type Mode = 'light' | 'dark';
/** The colours a workspace swatch shows, whichever colour is active. */
export function accentSwatch(mode: Mode, name: AccentName) {
  const a = accentScale[name][mode];
  return { fill: a.swatch, accent: a.base };
}

/** The colours of the small window drawn on a colour-scheme choice in Settings. */
export function themePreview(mode: Mode, name: AccentName) {
  const a = accentScale[name].light;
  return mode === 'light'
    ? { shell: a.soft, bar: 'rgba(255, 255, 255, 0.75)', card: ink[0] }
    : { shell: darkInk[925], bar: darkInk[700], card: darkInk[850] };
}

function roles(mode: Mode, accentName: AccentName) {
  const light = mode === 'light';
  const a = accentScale[accentName][mode];
  const pick = (l: string, d: string) => (light ? l : d);
  const shell = light ? accentScale[accentName].light.shell : withAlpha(darkInk[925], 0.86);
  return {
    // Window structure. The shell is drawn over vibrancy, so it tints rather than fills.
    windowBackground: pick(ink[100], darkInk[925]),
    shellTint: shell,
    sidebarTint: shell,
    sidebarFallback: pick(ink[100], darkInk[925]),
    /** Over the shell while the window isn't in front: it turns more opaque and a little lighter, as Dia's and macOS sidebars do. */
    shellInactive: pick('rgba(246, 248, 246, 0.55)', 'rgba(56, 56, 56, 0.55)'),
    sidebarRule: pick('rgba(30, 55, 42, 0.12)', 'rgba(255, 255, 255, 0.08)'),
    contentBackground: pick(ink[0], darkInk[900]),
    contentBorder: pick('rgba(20, 40, 30, 0.12)', 'rgba(255, 255, 255, 0.07)'),
    toolbarBackground: pick(ink[0], darkInk[900]),
    toolbarDivider: pick('rgba(20, 40, 30, 0.07)', 'rgba(255, 255, 255, 0.06)'),
    titlebarBackground: pick(ink[75], darkInk[925]),
    startBackground: pick(ink[25], darkInk[900]),
    /** The new tab page's breathing area light. */
    areaLight: light ? withAlpha(a.ring, 0.3) : withAlpha(darkInk[700], 0.24),

    // Text.
    textPrimary: pick(ink[900], darkInk[50]),
    textSecondary: pick('#646A66', darkInk[300]),
    textTertiary: pick(ink[500], darkInk[500]),
    textDisabled: pick(ink[300], darkInk[700]),
    textInverse: pick(ink[0], darkInk[950]),
    textOnAccent: pick(ink[0], darkInk[950]),
    textAccent: a.base,
    textLink: a.softText,
    textDanger: pick('#B42335', '#FF8E9B'),
    textWarning: pick('#8A5A00', '#F2C26B'),
    textSuccess: pick('#2F7D55', '#86D9A5'),

    // Icons follow text roles but sit slightly lighter.
    iconPrimary: pick('#474D49', darkInk[150]),
    iconSecondary: pick(ink[500], darkInk[400]),
    iconDisabled: pick(ink[300], darkInk[700]),

    // Interactive fills. On the tinted shell, hover and selection are white washes.
    fillHover: pick('rgba(30, 45, 36, 0.06)', 'rgba(255, 255, 255, 0.07)'),
    fillPressed: pick('rgba(30, 45, 36, 0.10)', 'rgba(255, 255, 255, 0.11)'),
    fillSelected: pick('rgba(30, 45, 36, 0.075)', 'rgba(255, 255, 255, 0.10)'),
    fillSelectedStrong: pick(ink[0], 'rgba(255, 255, 255, 0.14)'),
    fillControl: pick('rgba(30, 45, 36, 0.07)', 'rgba(255, 255, 255, 0.08)'),
    fillControlHover: pick('rgba(30, 45, 36, 0.11)', 'rgba(255, 255, 255, 0.11)'),
    fillControlPressed: pick('rgba(30, 45, 36, 0.15)', 'rgba(255, 255, 255, 0.15)'),
    fillField: pick('#F4F6F4', 'rgba(255, 255, 255, 0.06)'),
    fillFieldHover: pick(ink[100], 'rgba(255, 255, 255, 0.08)'),
    fillFieldFocus: pick(ink[0], darkInk[850]),
    fillTrack: pick('rgba(30, 45, 36, 0.18)', darkInk[700]),
    fillThumb: pick(ink[0], darkInk[50]),
    fillBadge: pick(ink[150], darkInk[800]),
    fillTransparent: 'transparent',
    fillShellHover: pick('rgba(255, 255, 255, 0.45)', 'rgba(255, 255, 255, 0.06)'),
    fillShellControl: pick('rgba(255, 255, 255, 0.55)', 'rgba(255, 255, 255, 0.08)'),
    fillShellControlActive: pick('rgba(255, 255, 255, 0.85)', 'rgba(255, 255, 255, 0.13)'),
    fillShellGroup: pick('rgba(255, 255, 255, 0.38)', 'rgba(255, 255, 255, 0.05)'),

    // Primary buttons are dark ink pills; the accent stays for focus and selection.
    buttonPrimary: pick(ink[900], darkInk[50]),
    buttonPrimaryHover: pick(ink[800], darkInk[0]),
    buttonPrimaryPressed: pick(ink[1000], darkInk[200]),
    textOnPrimary: pick(ink[0], darkInk[900]),
    roundFill: pick(ink[800], darkInk[100]),
    roundGlyph: pick(ink[0], darkInk[900]),
    roundSoft: pick('rgba(30, 45, 36, 0.10)', 'rgba(255, 255, 255, 0.12)'),
    roundSoftGlyph: pick(ink[800], darkInk[100]),

    // Accent.
    accent: a.base,
    accentHover: a.hover,
    accentPressed: a.pressed,
    accentSoft: a.soft,
    accentSoftText: a.softText,
    focusRing: a.ring,
    // Selected text in fields: light enough that the text stays readable.
    textSelection: a.swatch,

    // Borders.
    borderSubtle: pick('rgba(30, 45, 36, 0.09)', 'rgba(255, 255, 255, 0.07)'),
    borderDefault: pick('rgba(30, 45, 36, 0.12)', 'rgba(255, 255, 255, 0.10)'),
    borderStrong: pick('rgba(30, 45, 36, 0.20)', 'rgba(255, 255, 255, 0.18)'),
    borderField: pick('rgba(30, 45, 36, 0.10)', 'rgba(255, 255, 255, 0.12)'),
    borderFocus: a.base,
    borderGlass: pick('rgba(255, 255, 255, 0.70)', 'rgba(255, 255, 255, 0.10)'),

    // Raised surfaces. Popovers and menus are glass: vibrancy under this tint.
    surfacePopover: pick('rgba(243, 247, 244, 0.78)', withAlpha(darkInk[850], 0.8)),
    surfaceMenu: pick('rgba(243, 247, 244, 0.82)', withAlpha(darkInk[850], 0.84)),
    surfaceSolid: pick('#F5F7F5', darkInk[850]),
    // Classic popovers: solid, with an edge and a shadow, nothing showing through.
    surfacePopoverSolid: pick(ink[0], darkInk[850]),
    // Rows in popovers and menus, as in Ardia's panels.
    rowHover: pick('rgba(0, 0, 0, 0.06)', 'rgba(255, 255, 255, 0.07)'),
    rowPressed: pick('rgba(0, 0, 0, 0.10)', 'rgba(255, 255, 255, 0.12)'),
    surfaceDialog: pick('rgba(246, 249, 247, 0.90)', withAlpha(darkInk[850], 0.92)),
    surfaceSheet: pick(ink[0], darkInk[900]),
    surfaceSheetNav: pick(ink[0], darkInk[925]),
    surfaceSheetBody: pick('#F9FAF9', darkInk[900]),
    surfacePalette: pick(ink[0], darkInk[850]),
    surfaceToast: pick(ink[900], darkInk[100]),
    surfaceCard: pick(ink[0], 'rgba(255, 255, 255, 0.04)'),
    surfaceCardHover: pick(ink[75], 'rgba(255, 255, 255, 0.07)'),
    surfaceInset: pick('rgba(255, 255, 255, 0.55)', 'rgba(255, 255, 255, 0.05)'),
    surfaceBorder: pick('rgba(20, 40, 30, 0.13)', 'rgba(255, 255, 255, 0.10)'),
    scrim: pick('rgba(0, 0, 0, 0.18)', 'rgba(0, 0, 0, 0.50)'),
    textOnToast: pick(ink[50], darkInk[900]),

    // Status.
    danger: pick('#C42B3F', '#FF7A8A'),
    dangerHover: pick('#AD2437', '#FF95A2'),
    dangerSoft: pick('#FBE5E8', '#3F1C22'),
    warning: pick('#B97A00', '#F2B84B'),
    warningSoft: pick('#FBF0D9', '#3A2D12'),
    success: pick('#2F7D55', '#6FCF97'),
    successSoft: pick('#DFF2E6', '#173322'),
    notice: pick('#FF8A7A', '#FF8A7A'),
    // A favourite's unread count, red as macOS's dock badges are, whatever the workspace colour.
    unreadBadge: pick('#E5484D', '#E5484D'),
    textOnUnread: pick(ink[0], darkInk[0]),
    /** A muted or paused tab's badge on its icon: a chip in the opposite of the shell's tone, as a dock badge stands out. */
    soundBadge: pick(ink[700], darkInk[200]),
    textOnSoundBadge: pick(ink[0], darkInk[900]),
    info: a.base,
    infoSoft: a.soft,

    // Tabs on the shell.
    tabHover: pick('rgba(255, 255, 255, 0.45)', 'rgba(255, 255, 255, 0.06)'),
    // The soft pill under an inactive tab on hover, inset from the joined tab's outline.
    tabHoverInset: pick('rgba(255, 255, 255, 0.38)', 'rgba(255, 255, 255, 0.07)'),
    tabDivider: pick('rgba(20, 40, 30, 0.13)', 'rgba(255, 255, 255, 0.12)'),
    tabActive: pick(ink[0], 'rgba(255, 255, 255, 0.12)'),
    tabActiveBorder: pick('rgba(20, 40, 30, 0.06)', 'rgba(255, 255, 255, 0.06)'),
    tabText: pick('#2A2F2C', darkInk[200]),
    tabTextActive: pick(ink[900], darkInk[25]),
    tabLoading: a.base,
    tilePinned: pick('rgba(255, 255, 255, 0.40)', 'rgba(255, 255, 255, 0.06)'),
    // A pinned tile lights almost to white under the pointer and a little more while pressed, as Dia's do.
    tilePinnedHover: pick('rgba(255, 255, 255, 0.78)', 'rgba(255, 255, 255, 0.15)'),
    tilePinnedPressed: pick('rgba(255, 255, 255, 0.92)', 'rgba(255, 255, 255, 0.24)'),
    // A sidebar row under a press: Dia's pressed fill, deeper than the hover wash.
    tabPressed: pick('rgba(255, 255, 255, 0.70)', 'rgba(255, 255, 255, 0.14)'),
    // The disc behind a WebKit tab's Safari badge, and the line where a dragged tab will land.
    engineBadge: pick(ink[0], darkInk[800]),
    tabDropLine: a.base,
    // The address pill's edge in Insert mode, with modal browsing on.
    modeInsert: a.ring,
    tilePinnedActive: pick(ink[0], 'rgba(255, 255, 255, 0.14)'),
    sectionLabel: pick('#7F8681', darkInk[400]),
    groupLabel: pick('#565C58', darkInk[300]),

    // Address field and suggestions.
    omniboxIdle: pick('#F4F6F4', 'rgba(255, 255, 255, 0.06)'),
    omniboxHover: pick(ink[100], 'rgba(255, 255, 255, 0.08)'),
    omniboxActive: pick(ink[0], darkInk[850]),
    omniboxCompletion: pick(ink[400], darkInk[500]),
    suggestionHover: pick('rgba(30, 45, 36, 0.05)', 'rgba(255, 255, 255, 0.06)'),
    suggestionSelected: pick('rgba(30, 45, 36, 0.075)', 'rgba(255, 255, 255, 0.10)'),
    suggestionSelectedText: pick(ink[900], darkInk[25]),
    paletteSelected: a.base,
    paletteSelectedText: pick(ink[0], darkInk[950]),

    // Site security.
    siteSecure: pick(ink[600], darkInk[300]),
    siteInsecure: pick('#B97A00', '#F2B84B'),
    siteDangerous: pick('#C42B3F', '#FF7A8A'),

    // Link hints and split view.
    hintFill: pick('#FFD45C', '#FFD45C'),
    hintText: pick(ink[900], darkInk[900]),
    hintBorder: pick('rgba(0, 0, 0, 0.18)', 'rgba(0, 0, 0, 0.30)'),
    splitFocus: a.base,
    splitDim: pick('rgba(255, 255, 255, 0.35)', 'rgba(0, 0, 0, 0.35)'),
    // A split view's tabs across the top sit on one soft pill.
    splitChip: pick('rgba(255, 255, 255, 0.42)', 'rgba(255, 255, 255, 0.07)'),
    // Drop zones over the page for a dragged tab, as in Ardia: a frosted card
    // with a dashed edge; the one under the tab takes the accent.
    dropZoneFill: pick('rgba(255, 255, 255, 0.45)', 'rgba(255, 255, 255, 0.04)'),
    dropZoneBorder: pick('rgba(0, 0, 0, 0.08)', 'rgba(255, 255, 255, 0.08)'),
    dropZoneDash: pick('rgba(0, 0, 0, 0.1)', 'rgba(255, 255, 255, 0.1)'),
    dropZoneText: pick('rgba(0, 0, 0, 0.55)', 'rgba(255, 255, 255, 0.6)'),
    dropZoneActive: withAlpha(a.base, light ? 0.12 : 0.16),
    dropZoneActiveText: a.base,

    // Progress and keycaps.
    progressTrack: pick('rgba(30, 45, 36, 0.11)', darkInk[800]),
    progressFill: a.base,
    keycapFill: pick('#EFF1EF', darkInk[800]),
    keycapBorder: pick('transparent', 'transparent'),
    keycapText: pick('#565C58', darkInk[300]),

    // Tab groups: Chromium's nine group colours, softened to sit on the shell.
    groupGrey: pick('#7A817C', '#A6A6A6'),
    groupBlue: pick('#3D7BD9', '#8DB5F2'),
    groupRed: pick('#D2483D', '#F0928A'),
    groupYellow: pick('#D9A21B', '#F2D06B'),
    groupGreen: pick('#3E9258', '#8CCB9C'),
    groupPink: pick('#CC4A93', '#F19BCB'),
    groupPurple: pick('#8A55D6', '#C7A9F5'),
    groupCyan: pick('#1F8F99', '#7DD3DE'),
    groupOrange: pick('#E07A35', '#F5B07A'),

    // Shadows (colour only; geometry is in `shadow`).
    shadowColor: pick('#14281E', '#000000'),
  } as const;
}
export type ColorRole = keyof ReturnType<typeof roles>;
export type Palette = Record<ColorRole, string>;

/** A tab group's colour, by the names Chromium and workspace files use. */
export type GroupColorName = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';
export const groupColorRoles: Record<GroupColorName, ColorRole> = {
  grey: 'groupGrey', blue: 'groupBlue', red: 'groupRed', yellow: 'groupYellow', green: 'groupGreen', pink: 'groupPink',
  purple: 'groupPurple', cyan: 'groupCyan', orange: 'groupOrange',
};

export function palette(mode: Mode, accent: AccentName): Palette {
  return roles(mode, accent);
}

/** Native layer shadows, drawn by the Surface view (React Native's shadow props do not work on macOS). */
export const shadow = {
  none: { opacity: 0, radius: 0, offsetY: 0 },
  card: { opacity: 0.10, radius: 12, offsetY: 4 },
  tab: { opacity: 0.12, radius: 2, offsetY: 1 },
  /** Settings › Appearance › Glow around the selected tab: Full, as in Ardia and Dia. */
  tabGlow: { opacity: 0.14, radius: 12, offsetY: 0 },
  popover: { opacity: 0.17, radius: 22, offsetY: 12 },
  menu: { opacity: 0.16, radius: 18, offsetY: 8 },
  dialog: { opacity: 0.30, radius: 36, offsetY: 20 },
  toast: { opacity: 0.25, radius: 16, offsetY: 8 },
} as const;
export type ShadowName = keyof typeof shadow;

/** How far the tabs fade while the window isn't in front, as a macOS sidebar's contents do. */
export const inactiveTabs = 0.62;
/** How strongly refused input flashes red when motion is reduced (instead of shaking). */
export const flashOpacity = 0.22;

/** Opacity for disabled and pressed controls. */
export const opacity = { disabled: 0.4, pressed: 0.75, dim: 0.6, groupWash: 0.16, sleeping: 0.5 } as const;

// Site colours. In the tabs-on-top layout the active tab joins the toolbar,
// and both take a colour from the site. Four treatments, chosen in Settings:
//   match  exactly the colour the page draws along its top edge (sampled by
//          the engine), so the toolbar continues the page; ink is light or
//          dark to suit it
//   soft   the site's brand colour (its theme-color, else its icon's main
//          colour) mixed with 86% white, ink from the same hue
//   vivid  that brand colour darkened until white text reaches 4.5:1
//   white  the plain toolbar, whatever the site
// A new tab page always uses white. Everything here returns roles to patch
// over the palette (see PaletteScope), so components keep naming roles.

export type ToolbarColor = 'match' | 'soft' | 'vivid' | 'white';
export const toolbarColors: readonly ToolbarColor[] = ['match', 'soft', 'vivid', 'white'];
export const toolbarColorLabels: Record<ToolbarColor, string> = { match: 'Match', soft: 'Soft', vivid: 'Vivid', white: 'White' };

type Rgb = [number, number, number];
const channels = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as Rgb;
};
const hexOf = (c: number[]) => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
/** `a` moved towards `b` by `t` (0 to 1). Both "#RRGGBB". */
export function mixColor(a: string, b: string, t: number) {
  const A = channels(a), B = channels(b);
  return hexOf(A.map((v, i) => v + (B[i] - v) * t));
}
const withAlpha = (hex: string, alpha: number) => {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
/**
 * The selected pinned tile, tinted with its site's colour (the icon's main
 * colour, "#RRGGBB"), as Dia does; null without one, for the plain white card.
 */
export function pinnedTileTint(site: string | undefined, dark: boolean) {
  return site && /^#[0-9A-Fa-f]{6}$/.test(site) ? withAlpha(site, dark ? 0.3 : 0.2) : null;
}
/**
 * The ring around the selected pinned tile, in its site's colour as Dia
 * draws it. A near-black colour would vanish on the dark shell and a
 * near-white one on the light shell, so those get a neutral ring instead,
 * as Dia does for ChatGPT's black and Notion's white. Null without a colour.
 */
export function pinnedTileRing(site: string | undefined, dark: boolean) {
  if (!site || !/^#[0-9A-Fa-f]{6}$/.test(site)) return null;
  const l = luminance(site);
  if (dark && l < tileRingLimits.nearBlack) return 'rgba(255, 255, 255, 0.3)';
  if (!dark && l > tileRingLimits.nearWhite) return 'rgba(0, 0, 0, 0.18)';
  return withAlpha(site, dark ? 0.85 : 0.7);
}
const tileRingLimits = { nearBlack: 0.02, nearWhite: 0.88 } as const;
function luminance(hex: string) {
  const [r, g, b] = channels(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two "#RRGGBB" colours. */
export function contrastRatio(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** `fg` moved towards `toward` until it reaches `min` contrast on `bg`. */
function readable(fg: string, bg: string, toward: string, min: number) {
  let colour = fg;
  for (let t = 0.05; contrastRatio(colour, bg) < min && t <= 1; t += 0.05) colour = mixColor(fg, toward, t);
  return colour;
}
const white = ink[0], black = ink[1000];

export type SiteChrome = {
  /** The joined tab and the toolbar under it. */
  bar: string;
  /** The window shell when it follows the site; null keeps the workspace tint. */
  shell: string | null;
  /** Roles to patch over the palette inside the toolbar and the active tab. */
  roles: Partial<Palette>;
  /** The bar is the page's own colour, so no rule separates them. */
  seamless?: boolean;
};

const hex = /^#[0-9A-Fa-f]{6}$/;
/**
 * `site` is the site's brand colour and `surface` the colour along the top of
 * the page, each "#RRGGBB" when the engine has one.
 */
export function siteChrome(mode: Mode, site: string | null | undefined, style: ToolbarColor, followShell: boolean,
  surface?: string | null): SiteChrome {
  const light = mode === 'light';
  const plain = light ? ink[0] : darkInk[900];
  const tint = (colour: string) => followShell
    ? (light ? withAlpha(mixColor(colour, white, 0.72), 0.86) : withAlpha(mixColor(colour, darkInk[950], 0.8), 0.88))
    : null;
  if (style === 'match') return surface && hex.test(surface) ? matchChrome(surface, tint(surface)) : { bar: plain, shell: null, roles: {} };
  if (!site || !hex.test(site) || style === 'white') return { bar: plain, shell: null, roles: {} };
  const shell = tint(site);
  if (style === 'vivid') {
    let bar = site;
    for (let t = 0.04; contrastRatio(white, bar) < 4.5 && t <= 1; t += 0.04) bar = mixColor(site, black, t);
    const muted = readable(mixColor(white, bar, 0.28), bar, white, 4.5);
    return { bar, shell, roles: {
      textPrimary: white, textSecondary: muted, textTertiary: muted, tabText: white, tabTextActive: white,
      iconPrimary: white, iconSecondary: mixColor(white, bar, 0.18), iconDisabled: mixColor(white, bar, 0.55),
      siteSecure: muted, omniboxCompletion: muted,
      omniboxIdle: withAlpha(white, 0.16), omniboxHover: withAlpha(white, 0.22), omniboxActive: mixColor(bar, black, 0.22),
      textSelection: withAlpha(white, 0.32), borderDefault: withAlpha(white, 0.28),
      fillHover: withAlpha(white, 0.14), fillPressed: withAlpha(white, 0.22), fillSelected: withAlpha(white, 0.18),
      focusRing: withAlpha(white, 0.75), tabLoading: white,
    } };
  }
  const bar = light ? mixColor(site, white, 0.86) : mixColor(site, darkInk[900], 0.8);
  const toward = light ? black : white;
  const text = light ? readable(mixColor(site, black, 0.5), bar, black, 4.5) : readable(mixColor(site, white, 0.75), bar, white, 7);
  const icon = light ? readable(mixColor(site, black, 0.4), bar, black, 3) : readable(mixColor(site, white, 0.6), bar, white, 3);
  const muted = readable(mixColor(text, bar, 0.35), bar, toward, 4.5);
  return { bar, shell, roles: {
    textPrimary: text, textSecondary: muted, textTertiary: muted, tabText: text, tabTextActive: text,
    iconPrimary: icon, iconSecondary: readable(mixColor(icon, bar, 0.25), bar, toward, 3), iconDisabled: mixColor(icon, bar, 0.55),
    siteSecure: muted, omniboxCompletion: muted, tabLoading: icon,
    omniboxIdle: light ? withAlpha(white, 0.66) : withAlpha(white, 0.08),
    omniboxHover: light ? withAlpha(white, 0.82) : withAlpha(white, 0.11),
    fillHover: withAlpha(light ? text : white, light ? 0.07 : 0.08),
    fillPressed: withAlpha(light ? text : white, light ? 0.12 : 0.13),
    fillSelected: withAlpha(light ? text : white, light ? 0.1 : 0.11),
  } };
}

/**
 * The toolbar in the page's own colour. Ink is near-white or near-black,
 * whichever reads better on it, so a white page gets the plain toolbar's
 * ink and a black one the dark theme's, whatever Merlin's own mode.
 */
function matchChrome(bar: string, shell: string | null): SiteChrome {
  const onDark = contrastRatio(white, bar) >= contrastRatio(ink[900], bar);
  const toward = onDark ? white : black;
  const text = readable(onDark ? darkInk[25] : ink[900], bar, toward, 7);
  const muted = readable(mixColor(text, bar, 0.35), bar, toward, 4.5);
  const icon = readable(mixColor(text, bar, 0.12), bar, toward, 4.5);
  const wash = (alpha: number) => withAlpha(onDark ? white : ink[900], alpha);
  return { bar, shell, seamless: true, roles: {
    textPrimary: text, textSecondary: muted, textTertiary: muted, tabText: text, tabTextActive: text,
    iconPrimary: icon, iconSecondary: readable(mixColor(icon, bar, 0.25), bar, toward, 3), iconDisabled: mixColor(icon, bar, 0.55),
    siteSecure: muted, omniboxCompletion: muted, tabLoading: icon,
    omniboxIdle: wash(onDark ? 0.09 : 0.05), omniboxHover: wash(onDark ? 0.13 : 0.08),
    omniboxActive: onDark ? mixColor(bar, white, 0.1) : mixColor(bar, white, 0.7),
    textSelection: wash(onDark ? 0.3 : 0.18), borderDefault: wash(onDark ? 0.2 : 0.12),
    fillHover: wash(onDark ? 0.1 : 0.06), fillPressed: wash(onDark ? 0.16 : 0.1), fillSelected: wash(onDark ? 0.13 : 0.08),
    focusRing: wash(onDark ? 0.6 : 0.45),
  } };
}

// Glass. Settings › Appearance › Interface style: Glass draws popovers and
// menus in macOS Liquid Glass (macOS 26 and later); Classic draws them solid.
// Liquid Glass has two fixed looks, regular (frosted) and clear, and its tint
// barely changes the regular one, so a tint alone can't make a slider. Measured
// in a test window, Transparency runs in two even halves instead: below the
// middle a colour layer over the glass thickens it towards a solid panel;
// above it the regular glass fades into the clear one. The middle is plain
// regular glass, Ardia's look.

export type GlassLook = {
  /** Glass is chosen and macOS can draw it. */
  on: boolean;
  /** Glass is chosen: the shell shows the desktop through it, even before macOS 26. */
  translucent: boolean;
  /** How much of the workspace colour the glass takes, 0 to 1; 0 is neutral. */
  tint: number;
  /** 0 frosted, 1 clear. */
  transparency: number;
};
export const classicLook: GlassLook = { on: false, translucent: true, tint: 0, transparency: 0.5 };

const glassCurve = { solid: 0.95, middle: 0.5, tintAlpha: 0.25, accentShare: 0.55 } as const;
/**
 * The least colour layer a centred pop-up's glass takes, whatever the
 * Transparency: it sits over the page undimmed, and plain glass over a white
 * page in dark mode (or a dark page in light mode) left its text grey on grey.
 */
export const legibleGlass = 0.72;
/**
 * The least colour layer an anchored popover's glass takes: enough that a
 * saturated page (Hacker News's orange bar) no longer smears through its
 * text, and that dark-mode text keeps its contrast, while it still reads as
 * glass at the clear end of Transparency.
 */
export const anchoredGlass = 0.82;
const glassBase = { light: ink[0], dark: darkInk[850] } as const;
const controlAlpha = { rest: 0, lit: 0.05, pressed: 0.1, active: 0.22 } as const;
export type GlassState = keyof typeof controlAlpha;

function glassHue(mode: Mode, accent: AccentName, tint: number) {
  return tint > 0 ? mixColor(glassBase[mode], accentScale[accent][mode].base, tint * glassCurve.accentShare) : glassBase[mode];
}

const thousandths = (v: number) => Math.round(v * 1000) / 1000;

/**
 * A popover or panel in glass: `fill` is the colour layer over the glass,
 * `fade` how far the regular glass has faded into clear (0 to 1), and `tint`
 * the workspace colour the glass itself takes, if any.
 */
export function panelGlass(mode: Mode, accent: AccentName, look: GlassLook, floor = 0) {
  const t = Math.min(1, Math.max(0, look.transparency));
  const { middle } = glassCurve;
  const solid = Math.max(floor, t < middle ? glassCurve.solid * (middle - t) / middle : 0);
  const fade = t > middle ? (t - middle) / (1 - middle) : 0;
  return {
    fill: withAlpha(glassHue(mode, accent, look.tint), thousandths(solid)),
    fade: thousandths(fade),
    tint: look.tint > 0 ? withAlpha(glassHue(mode, accent, 1), thousandths(look.tint * glassCurve.tintAlpha)) : undefined,
  };
}

/** A control's glass plate (a lit button, the address field, a pinned tile). */
export function controlGlass(mode: Mode, accent: AccentName, look: GlassLook, state: GlassState) {
  const lift = (1 - look.transparency) * controlAlpha.lit;
  return withAlpha(glassHue(mode, accent, look.tint), controlAlpha[state] + (state === 'rest' ? 0 : lift));
}

/** The window shell's tint over its vibrancy: more transparent glass shows more of the desktop; Classic is opaque. */
export function shellTintFor(tint: string, look: GlassLook) {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(tint);
  if (!m) return tint;
  const alpha = look.translucent ? Math.min(1, Number(m[4]) + (0.5 - look.transparency) * 0.28) : 1;
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${Math.round(alpha * 1000) / 1000})`;
}
