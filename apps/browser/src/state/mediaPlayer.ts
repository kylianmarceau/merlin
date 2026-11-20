import type { Tab } from './types';

/** Whether the tab's media plays: its media session's word, else whether it makes sound. */
export function mediaPlaying(tab: Tab) {
  return tab.media ? tab.media.playing : tab.audible;
}

/**
 * The tab the sidebar's player is for: one in the background (not the
 * active tab or the one beside it in a split) with media to play or pause,
 * or, from an engine that doesn't describe media, sound. One that plays
 * comes before a paused one, and among those the one used most recently.
 * Dismissed tabs aren't offered.
 */
export function playerTab(tabs: Tab[], activeId: string | null, recent: string[], dismissed: ReadonlySet<string>) {
  const active = tabs.find(t => t.id === activeId);
  const shown = (t: Tab) => t.id === activeId || (!!active?.split && t.split === active.split);
  const rank = (t: Tab) => { const at = recent.indexOf(t.id); return at < 0 ? recent.length : at; };
  const candidates = tabs.filter(t => !shown(t) && !dismissed.has(t.id) && (t.media || t.audible));
  candidates.sort((a, b) => Number(mediaPlaying(b)) - Number(mediaPlaying(a)) || rank(a) - rank(b));
  return candidates[0] ?? null;
}

/**
 * Dismissals that still hold: a tab's is dropped once it starts playing
 * again after a pause (or has gone), so the player comes back for it.
 */
export function keepDismissed(dismissed: ReadonlySet<string>, tabs: Tab[], wasPlaying: ReadonlyMap<string, boolean>) {
  const next = new Set<string>();
  for (const id of dismissed) {
    const tab = tabs.find(t => t.id === id);
    if (tab && !(mediaPlaying(tab) && wasPlaying.get(id) === false)) next.add(id);
  }
  return next;
}
