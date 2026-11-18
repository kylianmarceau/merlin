// Which of Ctrl-Tab's cards show, and which thumbnails to ask Chromium for.
// Each thumbnail is a JPEG data URL, so a window of 500 tabs asks only for
// the cards on screen, and never again for one it has (M36).

/** At most this many cards to a row; more tabs wrap onto further rows. */
export const perRow = 5;
/** Cards shown at once, around the highlighted one. */
export const shownMax = 15;

/** The cards on screen: a window of `max` that keeps the highlighted one in view. */
export function shownCards<T>(tabs: readonly T[], selected: number, max = shownMax): { first: number; shown: T[] } {
  const first = Math.max(0, Math.min(selected - Math.floor(max / 2), tabs.length - max));
  return { first, shown: tabs.slice(first, first + max) };
}

/** The shown tabs whose thumbnail hasn't been asked for yet. */
export function thumbnailsToRequest(shown: readonly string[], asked: ReadonlySet<string>): string[] {
  return shown.filter(id => !asked.has(id));
}
