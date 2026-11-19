// Preferences the shell keeps itself, through AppKit, rather than in the
// Chromium profile. They apply to every window, so one store is shared.
// Reading and saving them is in shellPrefsStorage.ts.
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { SiteEngines } from '../lib/engines';

export type InterfaceStyle = 'glass' | 'classic';
export type AddressBarPlace = 'sidebar' | 'toolbar';
export type CommandBarPlace = 'field' | 'centred';
export type TabGlow = 'full' | 'soft' | 'off';
export type ScrollBars = 'system' | 'thin';
export type BarSize = 'default' | 'large';
export type SearchPreference = 'website' | 'search';
export type UpdateChannel = 'stable' | 'beta';
/** When the bookmarks bar shows under the toolbar or over the page: Dia's and Ardia's three choices. */
export type BookmarksBarWhen = 'always' | 'newTab' | 'never';
export type NewTabPosition = 'end' | 'top';

export type ShellPrefs = {
  /** New tabs start as a pop-up over the current page instead of a page of their own. */
  newTabPopup: boolean;
  /** How the active tab and toolbar take the site's colour with tabs on top: "match", "soft", "vivid" or "white". */
  toolbarColor: 'match' | 'soft' | 'vivid' | 'white';
  /** The window shell takes the site's colour too, instead of the workspace colour. */
  shellFollowsSite: boolean;
  /** Sites with DRM-protected video (Netflix and the like) open in WebKit, which can play them. */
  protectedVideoInWebKit: boolean;
  /** Sites the person moved to the other engine by hand. */
  siteEngines: SiteEngines;

  // Appearance › Interface style (Ardia's), plus Merlin's transparency.
  /** Glass draws popovers, fields and buttons in Liquid Glass; Classic keeps them solid. */
  interfaceStyle: InterfaceStyle;
  /** The glass takes the workspace colour. */
  glassTintWithTheme: boolean;
  /** How much of the workspace colour, 0 to 1. */
  glassTintAmount: number;
  /** How see-through glass is: 0 frosted, 1 clear. */
  glassTransparency: number;
  // Appearance › Address bar.
  addressBar: AddressBarPlace;
  commandBarPlacement: CommandBarPlace;
  compactToolbar: boolean;
  // Appearance › Bookmarks.
  showBookmarks: boolean;
  bookmarksBar: BookmarksBarWhen;
  bookmarksBarSize: BarSize;
  /** The sidebar shows the Bookmarks bar folder under the pinned tabs. */
  sidebarBookmarks: boolean;
  /** That section is folded to its heading. */
  sidebarBookmarksFolded: boolean;
  // Appearance › Tabs.
  /** The sidebar's width in points, dragged at its edge. */
  sidebarWidth: number;
  /** Where Command-T and the New Tab buttons open a tab; Chromium reads MerlinShell.newTabPosition itself. */
  newTabPosition: NewTabPosition;
  // Appearance › Page frame.
  borderlessMode: boolean;
  /** Points between the page and the window's edges. */
  pageFrame: number;
  pageFrameZeroInFullScreen: boolean;
  pageFrameZeroWhenTabsHidden: boolean;
  // Appearance › Selected tab and Scroll bars.
  selectedTabGlow: TabGlow;
  pageScrollBars: ScrollBars;
  // General.
  warnBeforeQuitting: boolean;
  warnBeforeClosingWindow: boolean;
  searchPreference: SearchPreference;
  updateChecks: boolean;
  /** "auto" follows the running build: Beta while it is a pre-release, otherwise Stable. */
  updateChannel: UpdateChannel | 'auto';
};

export const PAGE_FRAME = { min: 0, max: 12, default: 8 } as const;
export const SIDEBAR_WIDTH = { min: 200, max: 400, default: 252 } as const;
export const GLASS_DEFAULTS = { tintAmount: 0.8, transparency: 0.5 } as const;

export const defaultShellPrefs: ShellPrefs = {
  newTabPopup: false, toolbarColor: 'match', shellFollowsSite: false, protectedVideoInWebKit: true, siteEngines: {},
  interfaceStyle: 'glass', glassTintWithTheme: false, glassTintAmount: GLASS_DEFAULTS.tintAmount,
  glassTransparency: GLASS_DEFAULTS.transparency,
  addressBar: 'sidebar', commandBarPlacement: 'field', compactToolbar: false,
  showBookmarks: true, bookmarksBar: 'newTab', bookmarksBarSize: 'default', sidebarBookmarks: true, sidebarBookmarksFolded: false,
  sidebarWidth: SIDEBAR_WIDTH.default, newTabPosition: 'end',
  borderlessMode: false, pageFrame: PAGE_FRAME.default, pageFrameZeroInFullScreen: false, pageFrameZeroWhenTabsHidden: false,
  selectedTabGlow: 'soft', pageScrollBars: 'system',
  warnBeforeQuitting: false, warnBeforeClosingWindow: true, searchPreference: 'website',
  updateChecks: false, updateChannel: 'auto',
};

export const shellPrefs = createStore<ShellPrefs>()(() => ({ ...defaultShellPrefs }));

export function useShellPrefs<T>(select: (prefs: ShellPrefs) => T): T {
  return useStore(shellPrefs, select);
}
