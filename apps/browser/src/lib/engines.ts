// Which engine shows a site. Chromium shows everything, except sites whose
// video Chromium can't play: Merlin's Chromium has no Widevine, so Netflix
// and other services that require DRM refuse it. WebKit plays them with
// FairPlay, as Safari does. A site the person moved by hand keeps that choice.

export type PageEngine = 'chromium' | 'webkit';
/** Sites the person moved to the other engine, by origin ("https://www.netflix.com"). */
export type SiteEngines = Record<string, PageEngine>;
export type EnginePrefs = { protectedVideoInWebKit: boolean; siteEngines: SiteEngines };

/** Services that play only DRM-protected video or music. Subdomains count. Ardia uses much the same list. */
export const PROTECTED_VIDEO_SITES: readonly string[] = [
  'netflix.com',
  'disneyplus.com',
  'max.com',
  'hbomax.com',
  'primevideo.com',
  'hulu.com',
  'tv.apple.com',
  'music.apple.com',
  'open.spotify.com',
  'peacocktv.com',
  'paramountplus.com',
  'crunchyroll.com',
  'hotstar.com',
  'jiohotstar.com',
  'canalplus.com',
  'nowtv.com',
  'showmax.com',
];

/** The page's origin for http and https pages, lowercased; null for anything else. */
export function siteOf(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = /^(https?):\/\/([^/?#]+)/i.exec(url);
  if (!match) return null;
  const host = match[2].replace(/^[^@]*@/, '').toLowerCase();
  return host ? `${match[1].toLowerCase()}://${host}` : null;
}

/** The host without "www." and port, for messages: "netflix.com". */
export function hostLabel(url: string | undefined | null): string {
  const site = siteOf(url);
  return site ? site.replace(/^https?:\/\//, '').replace(/:\d+$/, '').replace(/^www\./, '') : '';
}

export function protectedVideoSite(url: string | undefined | null): boolean {
  const site = siteOf(url);
  if (!site?.startsWith('https://')) return false;
  const host = site.slice('https://'.length).replace(/:\d+$/, '');
  return PROTECTED_VIDEO_SITES.some(domain => host === domain || host.endsWith(`.${domain}`));
}

/** Whether WebKit can show the page at all: web pages only, never Chromium's own. */
export const canUseWebKit = (url: string | undefined | null) => siteOf(url) !== null;

export function engineFor(url: string | undefined | null, prefs: EnginePrefs): PageEngine {
  const site = siteOf(url);
  if (!site) return 'chromium';
  const chosen = prefs.siteEngines[site];
  if (chosen === 'webkit' || chosen === 'chromium') return chosen;
  return prefs.protectedVideoInWebKit && protectedVideoSite(url) ? 'webkit' : 'chromium';
}

/** Reads saved site choices, dropping anything that isn't one. */
export function parseSiteEngines(text: string | null | undefined): SiteEngines {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: SiteEngines = {};
    for (const [site, engine] of Object.entries(value as Record<string, unknown>))
      if (siteOf(site) === site && (engine === 'webkit' || engine === 'chromium')) out[site] = engine;
    return out;
  } catch {
    return {};
  }
}
