// Loads and saves the shell's own preferences in AppKit's defaults
// (MerlinShell.<key>). A default value is never written, so a key that is
// absent always means "the default", including for Chromium, which reads
// MerlinShell.warnBeforeClosingWindow itself.
import { parseSiteEngines, type PageEngine } from '../lib/engines';
import { parseFolders, type FavouriteFolder } from './favouriteFolders';
import {
  installQuitGuard, onPreferenceChanged, preference, setBookmarksMenuHidden, setPreference, setThinScrollBars, tidyMenuBar,
} from '../platform/shell';
import { defaultShellPrefs, PAGE_FRAME, SIDEBAR_WIDTH, shellPrefs, type ShellPrefs } from './shellPrefs';

type Codec<T> = { read(raw: string | null): T; write(value: T): string | null };

/** A switch saved as "on"/"off"; the default is not saved. */
const flag = (fallback: boolean): Codec<boolean> => ({
  read: raw => (raw === 'on' ? true : raw === 'off' ? false : fallback),
  write: value => (value === fallback ? null : value ? 'on' : 'off'),
});
const oneOf = <T extends string>(choices: readonly T[], fallback: T): Codec<T> => ({
  read: raw => (choices.includes(raw as T) ? (raw as T) : fallback),
  write: value => (value === fallback ? null : value),
});
const amount = (fallback: number, min = 0, max = 1): Codec<number> => ({
  read: raw => {
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  },
  write: value => (value === fallback ? null : String(value)),
});

const d = defaultShellPrefs;
/** Every simple preference, how it is saved, and its default. */
const codecs: { [K in Exclude<keyof ShellPrefs, 'siteEngines' | 'protectedVideoInWebKit' | 'favouriteFolders'>]: Codec<ShellPrefs[K]> } = {
  newTabPopup: flag(d.newTabPopup),
  // Unset is the default, Match. Soft was the default before it and saved
  // nothing, so those windows move to Match too.
  toolbarColor: oneOf(['match', 'soft', 'vivid', 'white'], d.toolbarColor),
  shellFollowsSite: flag(d.shellFollowsSite),
  interfaceStyle: oneOf(['glass', 'classic'], d.interfaceStyle),
  glassTintWithTheme: flag(d.glassTintWithTheme),
  glassTintAmount: amount(d.glassTintAmount),
  glassTransparency: amount(d.glassTransparency),
  addressBar: oneOf(['sidebar', 'toolbar'], d.addressBar),
  commandBarPlacement: oneOf(['field', 'centred'], d.commandBarPlacement),
  compactToolbar: flag(d.compactToolbar),
  showBookmarks: flag(d.showBookmarks),
  // Saved as "on"/"off" before it had three choices.
  bookmarksBar: {
    read: raw => (raw === 'on' ? 'always' : raw === 'off' ? 'never' : raw === 'always' || raw === 'newTab' || raw === 'never' ? raw : d.bookmarksBar),
    write: value => (value === d.bookmarksBar ? null : value),
  },
  sidebarBookmarks: flag(d.sidebarBookmarks),
  sidebarBookmarksFolded: flag(d.sidebarBookmarksFolded),
  sidebarWidth: amount(d.sidebarWidth, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max),
  newTabPosition: oneOf(['end', 'top'], d.newTabPosition),
  bookmarksBarSize: oneOf(['default', 'large'], d.bookmarksBarSize),
  borderlessMode: flag(d.borderlessMode),
  pageFrame: amount(d.pageFrame, PAGE_FRAME.min, PAGE_FRAME.max),
  pageFrameZeroInFullScreen: flag(d.pageFrameZeroInFullScreen),
  pageFrameZeroWhenTabsHidden: flag(d.pageFrameZeroWhenTabsHidden),
  selectedTabGlow: oneOf(['full', 'soft', 'off'], d.selectedTabGlow),
  pageScrollBars: oneOf(['system', 'thin'], d.pageScrollBars),
  warnBeforeQuitting: flag(d.warnBeforeQuitting),
  warnBeforeClosingWindow: flag(d.warnBeforeClosingWindow),
  searchPreference: oneOf(['website', 'search'], d.searchPreference),
  updateChecks: flag(d.updateChecks),
  updateChannel: oneOf(['auto', 'stable', 'beta'], d.updateChannel),
};
type SimpleKey = keyof typeof codecs;

/** What a preference changes outside React: macOS scroll bars, the menu bar. */
function applyNative(key: SimpleKey, prefs: ShellPrefs) {
  if (key === 'pageScrollBars') void setThinScrollBars(prefs.pageScrollBars === 'thin').catch(() => {});
  if (key === 'showBookmarks') void setBookmarksMenuHidden(!prefs.showBookmarks).catch(() => {});
}

let loaded = false;
/** Reads the saved values once; until then the defaults apply. */
export function loadShellPrefs() {
  if (loaded) return;
  loaded = true;
  for (const key of Object.keys(codecs) as SimpleKey[]) {
    preference(key).then(raw => {
      shellPrefs.setState({ [key]: codecs[key].read(raw) } as Partial<ShellPrefs>);
      applyNative(key, shellPrefs.getState());
    }, () => {});
  }
  preference('favouriteFolders').then(raw => shellPrefs.setState({ favouriteFolders: parseFolders(raw) }), () => {});
  void installQuitGuard().catch(() => {});
  void tidyMenuBar().catch(() => {});
  try {
    // "Don't ask again" on the quit question clears the preference natively.
    onPreferenceChanged((key, raw) => {
      if (key in codecs) shellPrefs.setState({ [key]: codecs[key as SimpleKey].read(raw) } as Partial<ShellPrefs>);
      // Another window changed the folders.
      if (key === 'favouriteFolders') shellPrefs.setState({ favouriteFolders: parseFolders(raw) });
    });
  } catch { /* An older host without the event. */ }
  void loadEnginePrefs();
}

/** Shows a value in every window without saving it, while it is being dragged (the sidebar's width); setShellPref saves it. */
export function previewShellPref<K extends SimpleKey>(key: K, value: ShellPrefs[K]) {
  shellPrefs.setState({ [key]: value } as Partial<ShellPrefs>);
}

/** Changes one preference in every window and saves it. */
export function setShellPref<K extends SimpleKey>(key: K, value: ShellPrefs[K]) {
  shellPrefs.setState({ [key]: value } as Partial<ShellPrefs>);
  applyNative(key, shellPrefs.getState());
  return setPreference(key, codecs[key].write(value));
}

let enginePrefs: Promise<void> | null = null;
/**
 * Reads which engine shows which sites, once. Tabs move to WebKit only after
 * this, so a site the person keeps in Chromium never opens in WebKit first.
 */
export function loadEnginePrefs(): Promise<void> {
  enginePrefs ??= Promise.all([
    preference('protectedVideoInWebKit').then(value => shellPrefs.setState({ protectedVideoInWebKit: value !== 'off' }), () => {}),
    preference('siteEngines').then(value => shellPrefs.setState({ siteEngines: parseSiteEngines(value) }), () => {}),
  ]).then(() => {});
  return enginePrefs;
}

export const setNewTabPopup = (on: boolean) => setShellPref('newTabPopup', on);
export const setToolbarColor = (style: ShellPrefs['toolbarColor']) => setShellPref('toolbarColor', style);
export const setShellFollowsSite = (on: boolean) => setShellPref('shellFollowsSite', on);

export function setProtectedVideoInWebKit(on: boolean) {
  shellPrefs.setState({ protectedVideoInWebKit: on });
  return setPreference('protectedVideoInWebKit', on ? null : 'off');
}

/** Remembers which engine shows a site (an origin), or forgets the choice with null. */
export function setSiteEngine(site: string, engine: PageEngine | null) {
  const siteEngines = { ...shellPrefs.getState().siteEngines };
  if (engine) siteEngines[site] = engine;
  else delete siteEngines[site];
  shellPrefs.setState({ siteEngines });
  return setPreference('siteEngines', Object.keys(siteEngines).length ? JSON.stringify(siteEngines) : null);
}

export function forgetSiteEngines() {
  shellPrefs.setState({ siteEngines: {} });
  return setPreference('siteEngines', null);
}

/** Saves the favourite folders for every window; none saves nothing. */
export function setFavouriteFolders(folders: FavouriteFolder[]) {
  shellPrefs.setState({ favouriteFolders: folders });
  return setPreference('favouriteFolders', folders.length ? JSON.stringify(folders) : null);
}
