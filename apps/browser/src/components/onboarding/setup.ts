import { appearanceAccents, appearanceModes, type Appearance, type WelcomeProgress } from '../../state/types';
import { parseWorkspaceTheme, type WorkspaceTheme } from '../../state/workspaceTheme';
import type { ShellPrefs } from '../../state/shellPrefs';

export const screens = {
  source: 1,
  layout: 2, address: 2, command: 2,
  newTab: 3, position: 3, tidy: 3, startup: 3, sharing: 3, habits: 3,
  color: 4, appearance: 4, material: 4, frame: 4, siteColor: 4, details: 4,
  search: 5, privacy: 5,
  favorites: 6,
  system: 7, links: 7,
  cli: 8,
  finish: 9,
} as const;
export type Screen = keyof typeof screens;
export const screenOrder = Object.keys(screens) as Screen[];

export const browsers = [
  { id: 'arc', name: 'Arc', bundle: 'company.thebrowser.Browser' },
  { id: 'dia', name: 'Dia', bundle: 'company.thebrowser.dia' },
  { id: 'chrome', name: 'Chrome', bundle: 'com.google.Chrome' },
  { id: 'safari', name: 'Safari', bundle: 'com.apple.Safari' },
  { id: 'firefox', name: 'Firefox', bundle: 'org.mozilla.firefox' },
  { id: 'zen', name: 'Zen', bundle: 'app.zen-browser.zen' },
  { id: 'brave', name: 'Brave', bundle: 'com.brave.Browser' },
  { id: 'edge', name: 'Edge', bundle: 'com.microsoft.edgemac' },
  { id: 'helium', name: 'Helium', bundle: 'net.imput.helium' },
] as const;
export type BrowserId = typeof browsers[number]['id'];
export type Source = BrowserId | 'fresh' | '';

export const favorites = [
  { id: 'gmail', label: 'Gmail', url: 'https://mail.google.com/' },
  { id: 'calendar', label: 'Calendar', url: 'https://calendar.google.com/' },
  { id: 'slack', label: 'Slack', url: 'https://app.slack.com/' },
  { id: 'notion', label: 'Notion', url: 'https://www.notion.so/' },
  { id: 'figma', label: 'Figma', url: 'https://www.figma.com/' },
  { id: 'github', label: 'GitHub', url: 'https://github.com/' },
  { id: 'linear', label: 'Linear', url: 'https://linear.app/' },
  { id: 'docs', label: 'Docs', url: 'https://docs.google.com/' },
  { id: 'drive', label: 'Drive', url: 'https://drive.google.com/' },
  { id: 'outlook', label: 'Outlook', url: 'https://outlook.office.com/mail/' },
  { id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/' },
  { id: 'spotify', label: 'Spotify', url: 'https://open.spotify.com/' },
] as const;

export type Progress = WelcomeProgress & { screen: Screen; source: Source };

export function readProgress(value?: Partial<WelcomeProgress>): Progress {
  const favoriteIds = new Set<string>(favorites.map(f => f.id));
  return {
    screen: screenOrder.find(screen => screen === value?.screen) ?? 'source',
    source: browsers.find(browser => browser.id === value?.source)?.id ??
      (value?.source === 'fresh' ? 'fresh' : ''),
    custom: value?.custom !== false,
    favorites: [...new Set(value?.favorites?.filter(id => favoriteIds.has(id)) ?? [])],
  };
}

export function route(progress: Progress, layout: 'side' | 'top', glass: boolean) {
  const preset = progress.source && progress.source !== 'fresh' && !progress.custom;
  return screenOrder.filter(screen => {
    if (screen === 'address' && layout === 'top' || screen === 'material' && !glass) return false;
    return !preset || presetScreens.has(screen);
  });
}

const presetScreens = new Set<Screen>(['source', 'color', 'material', 'frame', 'privacy', 'favorites', 'system', 'cli', 'finish']);

export function nextScreen(current: Screen, route: Screen[], move: 'next' | 'back' | 'skip'): Screen {
  const index = screenOrder.indexOf(current);
  if (move === 'back') return route.filter(screen => screenOrder.indexOf(screen) < index).at(-1) ?? current;
  return route.find(screen => screenOrder.indexOf(screen) > index &&
    (move !== 'skip' || screens[screen] > screens[current])) ?? 'finish';
}

export type SetupPreferences = Pick<ShellPrefs, 'addressBar' | 'commandBarPlacement' | 'newTabPopup' | 'newTabPosition' |
  'tabTidyHours' | 'sharedTabs' | 'adaptiveFavorites' | 'peekModifier' | 'undoReopensTab' | 'groupLinkTabs' |
  'interfaceStyle' | 'glassTintWithTheme' | 'glassTintAmount' | 'borderlessMode' | 'pageFrame' |
  'toolbarColor' | 'hideToolbarOnScroll' | 'bookmarksBar' | 'externalLinks'>;

export function browserPreset(source: BrowserId): { layout: 'side' | 'top'; shell: Partial<SetupPreferences>; engine: string } {
  const arc = source === 'arc';
  const dia = source === 'dia';
  const zen = source === 'zen';
  const sidebar = arc || dia || zen;
  return {
    layout: sidebar ? 'side' : 'top',
    engine: source === 'brave' ? 'brave' : source === 'edge' ? 'bing' : 'google',
    shell: {
      addressBar: arc || zen ? 'sidebar' : 'toolbar',
      commandBarPlacement: arc || zen ? 'centred' : 'field',
      newTabPopup: arc || zen, newTabPosition: arc || zen ? 'top' : 'end',
      tabTidyHours: arc ? '12' : 'off', sharedTabs: arc, adaptiveFavorites: arc || zen,
      peekModifier: sidebar && !zen ? 'shift' : 'option', undoReopensTab: arc, groupLinkTabs: dia,
      toolbarColor: dia || source === 'safari' ? 'match' : 'white',
      hideToolbarOnScroll: arc || dia, bookmarksBar: sidebar || source === 'safari' ? 'never' : 'newTab',
      externalLinks: arc || dia ? 'compact' : 'tab',
    },
  };
}

export const searchEngines = [
  ['google', 'Google'], ['bing', 'Bing'], ['duckduckgo', 'DuckDuckGo'], ['ecosia', 'Ecosia'],
  ['brave', 'Brave Search'], ['kagi', 'Kagi'], ['startpage', 'Startpage'],
] as const;

const allowedValues = {
  addressBar: ['sidebar', 'toolbar'], commandBarPlacement: ['field', 'centred'],
  newTabPopup: [true, false], newTabPosition: ['top', 'end', 'adjacent'],
  tabTidyHours: ['off', '12', '24', '168'], sharedTabs: [true, false],
  adaptiveFavorites: [true, false], peekModifier: ['off', 'shift', 'option'],
  undoReopensTab: [true, false], groupLinkTabs: [true, false],
  interfaceStyle: ['glass', 'classic'], glassTintWithTheme: [true, false], glassTintAmount: 'amount',
  borderlessMode: [true, false], pageFrame: 'frame', toolbarColor: ['match', 'soft', 'vivid', 'workspace', 'white'],
  hideToolbarOnScroll: [true, false], bookmarksBar: ['always', 'newTab', 'never'], externalLinks: ['tab', 'compact'],
} as const satisfies Record<keyof SetupPreferences, readonly unknown[] | 'amount' | 'frame'>;

const codePrefix = 'MERLIN1:';
type SetupCode = {
  layout: 'side' | 'top'; startup: 'last' | 'start'; mode: Appearance['mode']; accent: Appearance['accent'];
  engine?: string; blocking?: { enabled: boolean; automatic: boolean }; favorites: string[]; theme: WorkspaceTheme | null; shell: Partial<SetupPreferences>;
};

export function makeSetupCode(options: Omit<SetupCode, 'shell'>, prefs: ShellPrefs) {
  const shell = Object.fromEntries(Object.keys(allowedValues).map(key => [key, prefs[key as keyof SetupPreferences]]));
  return codePrefix + encodeURIComponent(JSON.stringify({ ...options, shell }));
}

export function readSetupCode(input: string): SetupCode | null {
  const code = input.trim();
  if (!code.startsWith(codePrefix) || code.length > 8192) return null;
  try {
    const data: unknown = JSON.parse(decodeURIComponent(code.slice(codePrefix.length)));
    if (!data || typeof data !== 'object') return null;
    const v = data as Partial<SetupCode>;
    if ((v.layout !== 'side' && v.layout !== 'top') || (v.startup !== 'last' && v.startup !== 'start') ||
        !v.mode || !appearanceModes.includes(v.mode) || !v.accent || !appearanceAccents.includes(v.accent) ||
        !v.shell || typeof v.shell !== 'object' || Array.isArray(v.shell) ||
        !Array.isArray(v.favorites) || v.favorites.length > favorites.length ||
        !v.favorites.every(id => favorites.some(site => site.id === id)) ||
        (v.engine !== undefined && !searchEngines.some(([id]) => id === v.engine))) return null;
    if (v.blocking !== undefined && (!v.blocking || typeof v.blocking.enabled !== 'boolean' ||
        typeof v.blocking.automatic !== 'boolean' || Object.keys(v.blocking).length !== 2)) return null;
    const theme = parseWorkspaceTheme(v.theme);
    if (v.theme !== null && !theme) return null;
    const shell = Object.entries(v.shell).filter(([key, value]) => {
      if (!Object.prototype.hasOwnProperty.call(allowedValues, key)) return false;
      const allowed = allowedValues[key as keyof SetupPreferences];
      if (allowed === 'amount') return typeof value === 'number' && value >= 0 && value <= 1;
      if (allowed === 'frame') return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 12;
      return (allowed as readonly unknown[]).includes(value);
    });
    if (shell.length !== Object.keys(v.shell).length) return null;
    return { layout: v.layout, startup: v.startup, mode: v.mode, accent: v.accent, engine: v.engine,
      ...(v.blocking ? { blocking: v.blocking } : {}), favorites: [...new Set(v.favorites)], theme, shell: Object.fromEntries(shell) };
  } catch {
    return null;
  }
}
