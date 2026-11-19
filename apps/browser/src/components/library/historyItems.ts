import type { HistoryItem } from '../../state/types';

/** How close two visits must be to read as one: a redirect, or a reload. */
const sameVisitMs = 30 * 60 * 1000;

/**
 * History with repeats folded: a visit right after one to the same page (the
 * same address, or a redirect that kept its title on the same site, as The
 * Hay Wain's did) shows once, as its newest visit. Items come newest first;
 * `time` is in milliseconds.
 */
export function foldRepeats(items: readonly HistoryItem[]): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    const same = !!last && Math.abs(last.time - item.time) <= sameVisitMs &&
      (last.url === item.url || (!!item.title && last.title === item.title && last.domain === item.domain));
    if (!same) out.push(item);
  }
  return out;
}
