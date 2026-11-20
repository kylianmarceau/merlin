import type { Snapshot } from './types';

/**
 * The active page's new zoom when it was zoomed (by the menu, a key, a
 * pinch, or the same site zoomed in another tab), for the zoom HUD; null
 * when it wasn't, or when the tab, or the site it shows, changed instead.
 */
export function zoomChange(before: Snapshot | null, after: Snapshot) {
  if (!before || !after.activeTabId || before.activeTabId !== after.activeTabId) return null;
  const was = before.tabs.find(t => t.id === before.activeTabId);
  const now = after.tabs.find(t => t.id === after.activeTabId);
  if (!was?.zoom || !now?.zoom || was.zoom.percent === now.zoom.percent) return null;
  if (siteOf(was.url) !== siteOf(now.url)) return null;
  return now.zoom;
}

function siteOf(url: string) {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(url)?.[0] ?? url;
}
