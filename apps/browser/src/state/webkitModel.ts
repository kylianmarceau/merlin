// The rules for tabs shown in WebKit, without native code (state/webkit.ts
// runs them). Chromium keeps owning every tab: its place, ID and history
// before the site. When a tab reaches a site that opens in WebKit, the shell
// loads it in a WebKit page, moves Chromium's own tab back off the site, and
// shows the WebKit page, with its title and address, in the tab's place.
import { siteOf, type PageEngine } from '../lib/engines';
import { isStartUrl } from '../lib/format';
import type { Snapshot, Tab } from '../platform/protocol';

export type WebKitTab = {
  url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; crashed: boolean;
  color?: string; surface?: string;
  /** The page's icon as a data URL, and the favicon key it is shown under. */
  favicon?: string; faviconKey?: string;
  /** The window that has the tab now. */
  windowId: string;
  /**
   * What Chromium's own tab shows behind the WebKit page once it has left
   * the site: the page before it, or the start page. Null until it has.
   */
  base: string | null;
  /** When the shell last asked Chromium to leave the site, in ms. */
  leavingSince: number;
  /** How many times it has asked Chromium to go back or to a blank page since. */
  leaveTries: number;
};

/** How long Chromium has to settle on the site before the shell asks again. */
export const leaveTimeoutMs = 3000;
/** After this many tries a tab with no page before the site goes to a blank page, even mid-load. */
const blankAfterTries = 2;

export type Step =
  | { kind: 'none' }
  /** Show the tab in WebKit at `url`, then move Chromium's tab off it. */
  | { kind: 'open'; url: string }
  /** Chromium has left the site; `base` is where it is now. */
  | { kind: 'settle'; base: string }
  /**
   * Chromium is on the site: go back to the page before it, or to a blank
   * page if it has none, or (`stop`) stop a load that may not have committed.
   */
  | { kind: 'leave'; how: 'back' | 'blank' | 'stop' }
  /** Chromium went to another WebKit site (Forward, say): WebKit loads it, Chromium leaves again. */
  | { kind: 'follow'; url: string }
  /** Chromium went elsewhere by itself (Back, a bookmark, a command): its page shows again. */
  | { kind: 'close' };

const none: Step = { kind: 'none' };

/** What to do about one of Chromium's tabs, given the shell's WebKit page for it, if any. */
export function decide(tab: Tab, wk: WebKitTab | undefined, engineOf: (url: string) => PageEngine, now: number): Step {
  const wanted = engineOf(tab.url) === 'webkit';
  if (!wk) return wanted && !tab.crashed ? { kind: 'open', url: tab.url } : none;
  if (wk.base === null) {
    if (!wanted) return { kind: 'settle', base: tab.url };
    // A navigation Chromium hasn't committed shows its address too, but has
    // no page to go back from yet: wait until it has loaded, or for a while.
    const settled = !tab.loading && wk.leaveTries === 0;
    if (!settled && now - wk.leavingSince <= leaveTimeoutMs) return none;
    // Still loading after a while: it may not have committed, and Back would
    // then skip the page before it. Stop it first; go back on the next try.
    if (tab.loading && wk.leaveTries === 0) return { kind: 'leave', how: 'stop' };
    if (tab.canGoBack) return { kind: 'leave', how: 'back' };
    return { kind: 'leave', how: tab.loading && wk.leaveTries < blankAfterTries ? 'stop' : 'blank' };
  }
  if (tab.url === wk.base) return none;
  if (wanted) return { kind: 'follow', url: tab.url };
  // The page behind changed its own address (a script, a redirect, the start
  // page's own address): still the same page as far as the person can tell.
  if (isStartUrl(tab.url) ? isStartUrl(wk.base) : siteOf(tab.url) === siteOf(wk.base)) return { kind: 'settle', base: tab.url };
  return { kind: 'close' };
}

/** Whether Back on a WebKit page with no history of its own goes to a page of Chromium's. */
export const backLeavesWebKit = (wk: WebKitTab) => !wk.canGoBack && wk.base !== null && !isStartUrl(wk.base);

const hostTitle = (url: string) => siteOf(url)?.replace(/^https?:\/\//, '').replace(/^www\./, '') ?? url;

/** One of Chromium's tabs as its WebKit page shows it. */
export function overlayTab(tab: Tab, wk: WebKitTab): Tab {
  const url = wk.url || tab.url;
  return {
    ...tab, url, title: wk.title || hostTitle(url), loading: wk.loading, crashed: wk.crashed,
    canGoBack: wk.canGoBack || backLeavesWebKit(wk), canGoForward: wk.canGoForward,
    // Chromium's tab behind is on another page, or the start page; none of its state shows.
    audible: false, start: false, color: wk.color, surface: wk.surface, favicon: wk.faviconKey ?? '', engine: 'webkit',
  };
}

type Cache = WeakMap<Tab, { wk: WebKitTab; tab: Tab }>;
/** A cache of overlaid tabs, so unchanged rows keep their objects as shareUnchanged() keeps them. */
export const overlayCache = (): Cache => new WeakMap();

export function overlaySnapshot(snapshot: Snapshot, pages: Record<string, WebKitTab>, cache: Cache): Snapshot {
  let changed = false;
  const tabs = snapshot.tabs.map(tab => {
    const wk = pages[tab.id];
    if (!wk) return tab;
    changed = true;
    const kept = cache.get(tab);
    if (kept && kept.wk === wk) return kept.tab;
    const shown = overlayTab(tab, wk);
    cache.set(tab, { wk, tab: shown });
    return shown;
  });
  return changed ? { ...snapshot, tabs } : snapshot;
}

/** A short, stable key for an icon's data URL. */
export function iconKey(dataUrl: string): string {
  let hash = 5381;
  for (let i = 0; i < dataUrl.length; i++) hash = ((hash * 33) ^ dataUrl.charCodeAt(i)) >>> 0;
  return `webkit:${hash.toString(36)}:${dataUrl.length.toString(36)}`;
}
