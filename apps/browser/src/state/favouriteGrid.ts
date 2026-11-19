// The favourite tiles' grid, as in Ardia and Dia: the tiles share the
// sidebar's width (one tile fills the row, two take half each) up to four
// across, then wrap in rows of four. A tile dragged within the grid, or a tab
// dragged in from the list to be pinned, takes the slot under the pointer
// and the others make room. Pure rules, so they are tested without a window.

/** The most tiles in a row. */
export const gridColumns = 4;

/** Where the grid is on screen and how its tiles are spaced, as the sidebar lays it out. */
export type GridZone = { x: number; y: number; width: number; height: number; gap: number; tileHeight: number };

/** How many tiles a row holds for `count` tiles: all of them up to four. */
export function columnsFor(count: number) {
  return Math.max(1, Math.min(gridColumns, count));
}

/** A tile's width when `columns` share `width` with `gap` between them. */
export function tileWidth(width: number, columns: number, gap: number) {
  return Math.max(0, (width - gap * (columns - 1)) / columns);
}

/** Where slot `index` sits, from the grid's top-left corner. */
export function slotOrigin(index: number, columns: number, tile: { width: number; height: number }, gap: number) {
  return { x: (index % columns) * (tile.width + gap), y: Math.floor(index / columns) * (tile.height + gap) };
}

/** The grid's height for `count` tiles. */
export function gridHeight(count: number, tileHeight: number, gap: number) {
  const rows = Math.ceil(Math.max(1, count) / gridColumns);
  return rows * tileHeight + (rows - 1) * gap;
}

/**
 * The slot under (x, y), from the grid's top-left corner, among `count`
 * slots: the nearest one, so a point in a gap or past the last tile still
 * picks a place.
 */
export function slotAt(x: number, y: number, count: number, width: number, tileHeight: number, gap: number) {
  const columns = columnsFor(count);
  const tile = tileWidth(width, columns, gap);
  const column = Math.max(0, Math.min(columns - 1, Math.floor((x + gap / 2) / (tile + gap))));
  const rows = Math.ceil(count / columns);
  const row = Math.max(0, Math.min(rows - 1, Math.floor((y + gap / 2) / (tileHeight + gap))));
  return Math.max(0, Math.min(count - 1, row * columns + column));
}

/** Whether (x, y) in the window is over the grid, or within `slack` of it. */
export function overZone(zone: GridZone, x: number, y: number, slack: number) {
  return x >= zone.x - slack && x <= zone.x + zone.width + slack && y >= zone.y - slack && y <= zone.y + zone.height + slack;
}

/** `ids` with `id` taken out and put back at `index` (or added there when it wasn't in). */
export function placeAt(ids: string[], id: string, index: number) {
  const rest = ids.filter(other => other !== id);
  const at = Math.max(0, Math.min(rest.length, index));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * The tab to move a tile in front of so it lands at `index` of `order`: the
 * next tile, or for the last slot the first open tab (Chromium keeps pinned
 * tabs together, so that lands it last among them), else the end.
 */
export function beforeIdFor(order: string[], index: number, firstOpenId: string | null) {
  return order[index + 1] ?? firstOpenId;
}
