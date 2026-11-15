// Split views as the tabs show them. Chromium keeps a split's tabs next to
// each other, and the shell shows and moves them as one: a single piece in
// the tabs that drags as a whole.

/** Tabs in order, with the tabs of each split view together as one unit. */
export function tabUnits<T extends { split?: string; pinned: boolean }>(tabs: T[]): T[][] {
  const units: T[][] = [];
  for (const tab of tabs) {
    const last = units[units.length - 1];
    if (tab.split && last && last[0].split === tab.split && last[0].pinned === tab.pinned) last.push(tab);
    else units.push([tab]);
  }
  return units;
}
