// Pinned tabs' homes: the page each was pinned on. Plain logic, no React.
import type { Tab } from '../platform/protocol';

/** The same page, give or take its fragment and a trailing slash: a pinned tile that hasn't gone anywhere. */
function samePage(a: string, b: string) {
  const plain = (url: string) => url.replace(/#.*$/, '').replace(/\/$/, '');
  return plain(a) === plain(b);
}

/** A pinned tab that has navigated away from where it was pinned. */
export function awayFromHome(tab: Tab, home: { url: string } | undefined) {
  return !!home && !!tab.url && !samePage(tab.url, home.url);
}
