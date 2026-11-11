// Every colour, size, radius and shadow the shell draws with. This is the only
// file allowed to contain colour literals (see conventions.test.ts); features
// name a role, never a value. DESIGN.md describes how the roles are used.

export const space = { none: 0, hair: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 } as const;
export type Space = keyof typeof space;

export const radius = { none: 0, xs: 4, sm: 6, control: 8, row: 8, field: 10, card: 12, popover: 12, panel: 14, window: 12, pill: 999 } as const;
export type Radius = keyof typeof radius;

export const font = {
  family: 'System', mono: 'Menlo',
  size: { micro: 10, caption: 11, label: 12, body: 13, callout: 14, title: 15, headline: 20, display: 30 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  line: { micro: 13, caption: 14, label: 16, body: 18, callout: 19, title: 20, headline: 26, display: 36 },
  tracking: { tight: -0.6, snug: -0.2, normal: 0, wide: 0.4 },
} as const;

/** Sizes of recurring shell pieces, in points. */
export const geometry = {
  sidebar: 248, sidebarCollapsedInset: 84, titlebar: 40, toolbar: 46, control: 28, controlLarge: 34, row: 30,
  rowTall: 44, icon: 16, iconSmall: 13, iconLarge: 20, favicon: 16, tile: 28, keycap: 18, toggleWidth: 32,
  toggleHeight: 18, toggleThumb: 14, progress: 3, focusRing: 2, hairline: 1, splitGap: 6,
  popover: 320, popoverWide: 380, menu: 240, dialog: 400, dialogWide: 520, palette: 600,
  sheetWidth: 860, sheetHeight: 600, sheetNav: 196, suggestions: 8, startColumn: 600, toastWidth: 360,
} as const;

/** Layer order inside the window, lowest first. */
export const layer = { content: 0, chrome: 1, sheet: 10, dialog: 20, popover: 30, toast: 40 } as const;

// Neutral ramps. Roles below pick from these; nothing else should.
const ink = {
  0: '#FFFFFF', 25: '#FBFBFC', 50: '#F6F7F8', 75: '#F0F2F4', 100: '#E9ECEF', 150: '#E0E4E8', 200: '#D3D8DD',
  300: '#B9C0C7', 400: '#98A1AA', 500: '#77818B', 600: '#5B646D', 700: '#434A52', 800: '#2E343A', 850: '#24292E',
  900: '#1B1F23', 925: '#16191C', 950: '#111315', 1000: '#000000',
} as const;

const accentScale = {
  ocean: { light: { base: '#0A6E8F', hover: '#085E7A', pressed: '#074F66', soft: '#D8EEF5', softText: '#06506A', ring: '#5CB3D1' },
    dark: { base: '#5DBEDE', hover: '#7ACCE7', pressed: '#49A9C9', soft: '#123542', softText: '#A9E0F1', ring: '#3C8FAD' } },
  iris: { light: { base: '#5B4BC4', hover: '#4E3FAE', pressed: '#423597', soft: '#E6E2F9', softText: '#3F3399', ring: '#9C90E5' },
    dark: { base: '#A99BF5', hover: '#BBB0F8', pressed: '#9585EC', soft: '#28234A', softText: '#D3CCFB', ring: '#7466D2' } },
  fern: { light: { base: '#2F7A50', hover: '#286A45', pressed: '#215A3A', soft: '#DCEFE3', softText: '#1F5A39', ring: '#76BE93' },
    dark: { base: '#7CCB9C', hover: '#94D7AF', pressed: '#66BA88', soft: '#173526', softText: '#B8E7CA', ring: '#4F9C6F' } },
} as const;
export type AccentName = keyof typeof accentScale;

type Mode = 'light' | 'dark';
function roles(mode: Mode, accentName: AccentName) {
  const light = mode === 'light';
  const a = accentScale[accentName][mode];
  const pick = (l: string, d: string) => (light ? l : d);
  return {
    // Window structure. The sidebar is drawn over vibrancy, so it tints rather than fills.
    windowBackground: pick(ink[100], ink[925]),
    sidebarTint: pick('rgba(246, 247, 248, 0.55)', 'rgba(22, 25, 28, 0.45)'),
    sidebarFallback: pick(ink[75], ink[900]),
    contentBackground: pick(ink[0], ink[900]),
    contentBorder: pick('rgba(0, 0, 0, 0.08)', 'rgba(255, 255, 255, 0.07)'),
    toolbarBackground: pick(ink[0], ink[900]),
    toolbarDivider: pick('rgba(0, 0, 0, 0.06)', 'rgba(255, 255, 255, 0.06)'),
    titlebarBackground: pick(ink[75], ink[925]),

    // Text.
    textPrimary: pick(ink[900], ink[50]),
    textSecondary: pick(ink[600], ink[300]),
    textTertiary: pick(ink[500], ink[500]),
    textDisabled: pick(ink[300], ink[700]),
    textInverse: pick(ink[0], ink[950]),
    textOnAccent: pick(ink[0], ink[950]),
    textAccent: a.base,
    textLink: a.base,
    textDanger: pick('#B42335', '#FF8E9B'),
    textWarning: pick('#8A5A00', '#F2C26B'),
    textSuccess: pick('#1F6B40', '#86D9A5'),

    // Icons follow text roles but sit slightly lighter.
    iconPrimary: pick(ink[800], ink[150]),
    iconSecondary: pick(ink[500], ink[400]),
    iconDisabled: pick(ink[300], ink[700]),

    // Interactive fills.
    fillHover: pick('rgba(0, 0, 0, 0.05)', 'rgba(255, 255, 255, 0.07)'),
    fillPressed: pick('rgba(0, 0, 0, 0.09)', 'rgba(255, 255, 255, 0.11)'),
    fillSelected: pick('rgba(0, 0, 0, 0.07)', 'rgba(255, 255, 255, 0.10)'),
    fillSelectedStrong: pick(ink[0], 'rgba(255, 255, 255, 0.14)'),
    fillControl: pick('rgba(0, 0, 0, 0.045)', 'rgba(255, 255, 255, 0.07)'),
    fillControlHover: pick('rgba(0, 0, 0, 0.075)', 'rgba(255, 255, 255, 0.10)'),
    fillControlPressed: pick('rgba(0, 0, 0, 0.11)', 'rgba(255, 255, 255, 0.14)'),
    fillField: pick(ink[75], 'rgba(255, 255, 255, 0.06)'),
    fillFieldHover: pick(ink[100], 'rgba(255, 255, 255, 0.08)'),
    fillFieldFocus: pick(ink[0], ink[850]),
    fillTrack: pick(ink[200], ink[700]),
    fillThumb: pick(ink[0], ink[50]),
    fillBadge: pick(ink[150], ink[800]),
    fillTransparent: 'transparent',

    // Accent.
    accent: a.base,
    accentHover: a.hover,
    accentPressed: a.pressed,
    accentSoft: a.soft,
    accentSoftText: a.softText,
    focusRing: a.ring,

    // Borders.
    borderSubtle: pick('rgba(0, 0, 0, 0.06)', 'rgba(255, 255, 255, 0.06)'),
    borderDefault: pick('rgba(0, 0, 0, 0.10)', 'rgba(255, 255, 255, 0.10)'),
    borderStrong: pick('rgba(0, 0, 0, 0.18)', 'rgba(255, 255, 255, 0.18)'),
    borderField: pick('rgba(0, 0, 0, 0.12)', 'rgba(255, 255, 255, 0.12)'),
    borderFocus: a.base,

    // Raised surfaces.
    surfacePopover: pick('rgba(252, 252, 253, 0.97)', 'rgba(36, 40, 44, 0.97)'),
    surfaceMenu: pick('rgba(250, 250, 251, 0.98)', 'rgba(40, 44, 48, 0.98)'),
    surfaceDialog: pick(ink[0], ink[850]),
    surfaceSheet: pick(ink[0], ink[900]),
    surfaceSheetNav: pick(ink[50], ink[925]),
    surfaceToast: pick(ink[900], ink[150]),
    surfaceCard: pick(ink[50], 'rgba(255, 255, 255, 0.04)'),
    surfaceCardHover: pick(ink[75], 'rgba(255, 255, 255, 0.07)'),
    surfaceInset: pick(ink[75], ink[950]),
    surfaceBorder: pick('rgba(0, 0, 0, 0.09)', 'rgba(255, 255, 255, 0.10)'),
    scrim: pick('rgba(20, 24, 28, 0.28)', 'rgba(0, 0, 0, 0.50)'),
    textOnToast: pick(ink[50], ink[900]),

    // Status.
    danger: pick('#C42B3F', '#FF7A8A'),
    dangerHover: pick('#AD2437', '#FF95A2'),
    dangerSoft: pick('#FBE5E8', '#3F1C22'),
    warning: pick('#B97A00', '#F2B84B'),
    warningSoft: pick('#FBF0D9', '#3A2D12'),
    success: pick('#2A8150', '#6FCF97'),
    successSoft: pick('#DFF2E6', '#173322'),
    info: a.base,
    infoSoft: a.soft,

    // Tabs in the sidebar.
    tabHover: pick('rgba(0, 0, 0, 0.045)', 'rgba(255, 255, 255, 0.06)'),
    tabActive: pick('rgba(255, 255, 255, 0.92)', 'rgba(255, 255, 255, 0.12)'),
    tabActiveBorder: pick('rgba(0, 0, 0, 0.06)', 'rgba(255, 255, 255, 0.06)'),
    tabText: pick(ink[700], ink[200]),
    tabTextActive: pick(ink[900], ink[25]),
    tabLoading: a.base,
    tilePinned: pick('rgba(255, 255, 255, 0.55)', 'rgba(255, 255, 255, 0.06)'),
    tilePinnedActive: pick(ink[0], 'rgba(255, 255, 255, 0.14)'),
    sectionLabel: pick(ink[500], ink[500]),

    // Address field and suggestions.
    omniboxIdle: pick(ink[75], 'rgba(255, 255, 255, 0.06)'),
    omniboxHover: pick(ink[100], 'rgba(255, 255, 255, 0.08)'),
    omniboxActive: pick(ink[0], ink[850]),
    omniboxCompletion: pick(ink[400], ink[500]),
    suggestionHover: pick('rgba(0, 0, 0, 0.04)', 'rgba(255, 255, 255, 0.06)'),
    suggestionSelected: a.soft,
    suggestionSelectedText: a.softText,

    // Site security.
    siteSecure: pick(ink[600], ink[300]),
    siteInsecure: pick('#B97A00', '#F2B84B'),
    siteDangerous: pick('#C42B3F', '#FF7A8A'),

    // Link hints and split view.
    hintFill: a.base,
    hintText: pick(ink[0], ink[950]),
    hintBorder: pick(ink[0], ink[900]),
    splitFocus: a.base,
    splitDim: pick('rgba(255, 255, 255, 0.35)', 'rgba(0, 0, 0, 0.35)'),

    // Progress and keycaps.
    progressTrack: pick(ink[150], ink[800]),
    progressFill: a.base,
    keycapFill: pick(ink[0], ink[800]),
    keycapBorder: pick(ink[200], ink[700]),
    keycapText: pick(ink[600], ink[300]),

    // Shadows (colour only; geometry is in `shadow`).
    shadowColor: pick('#0B1520', '#000000'),
  } as const;
}
export type ColorRole = keyof ReturnType<typeof roles>;
export type Palette = Record<ColorRole, string>;

export function palette(mode: Mode, accent: AccentName): Palette {
  return roles(mode, accent);
}
export const accents: readonly AccentName[] = ['ocean', 'iris', 'fern'];

/** Native layer shadows, drawn by the Surface view (React Native's shadow props do not work on macOS). */
export const shadow = {
  none: { opacity: 0, radius: 0, offsetY: 0 },
  card: { opacity: 0.06, radius: 3, offsetY: 1 },
  tab: { opacity: 0.08, radius: 2, offsetY: 1 },
  popover: { opacity: 0.18, radius: 18, offsetY: 8 },
  menu: { opacity: 0.16, radius: 14, offsetY: 6 },
  dialog: { opacity: 0.26, radius: 28, offsetY: 14 },
  toast: { opacity: 0.22, radius: 16, offsetY: 6 },
} as const;
export type ShadowName = keyof typeof shadow;

/** Opacity for disabled and pressed controls. */
export const opacity = { disabled: 0.4, pressed: 0.75, dim: 0.6 } as const;
