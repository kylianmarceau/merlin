// Clear Browsing Data's time ranges (components/settings/ClearData.tsx).

export const clearRanges = [
  { value: 'hour', title: 'Last hour' },
  { value: 'day', title: 'Last 24 hours' },
  { value: 'week', title: 'Last 7 days' },
  { value: 'month', title: 'Last 4 weeks' },
  { value: 'all', title: 'All time' },
] as const;
export type ClearRange = typeof clearRanges[number]['value'];

const hour = 3_600_000;
const rangeMs: Record<ClearRange, number> = { hour, day: 24 * hour, week: 7 * 24 * hour, month: 28 * 24 * hour, all: 0 };

/** The `since` privacy.clearData takes for a range ending `now` (ms): seconds since the Unix epoch, 0 for all time. */
export const clearSince = (range: ClearRange, now: number) => (range === 'all' ? 0 : (now - rangeMs[range]) / 1000);
