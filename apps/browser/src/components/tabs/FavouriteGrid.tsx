import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { gridItems, homeKey, type GridItem } from '../../state/favouriteFolders';
import { columnsFor, gridHeight, placeAt, slotAt, slotOrigin, tileWidth } from '../../state/favouriteGrid';
import { useShellPrefs } from '../../state/shellPrefs';
import type { Tab } from '../../state/types';
import { useActions, useBrowser } from '../../state/window';
import { Panel, duration, geometry, radius, space, tick, useArrival, useSpringRect, useTheme, useTimeout } from '../ui';
import { Favicon } from '../favicon/Favicon';
import { FavouriteTile, FolderTile } from './TabRow';

/** The gap between favourite tiles. */
export const tileGap = space.xs + space.hair;
/** Stands in the order for a tab being dragged in from the list. */
const incomingSlot = '\u0000incoming';

/** A tile being dragged within the grid: where it started, the slot it is over, and how far the pointer has gone. */
type TileMove = { id: string; from: number; index: number; dx: number; dy: number };

/**
 * The favourite tiles, as in Ardia and Dia: they share the sidebar's width,
 * so one fills the row and two take half each, up to four across. Drag a
 * tile to reorder it: it lifts and follows the pointer while the others
 * spring aside, and settles into its slot when let go. Drag a tab in from
 * the list to pin it: the tiles make room where it would land, outlined
 * with its icon. With no favourites yet, dragging a row up past the top of
 * the list (`list`) opens that first slot. A tick marks each new slot.
 * Resting a dragged tile on the middle of another for a moment rings it, as
 * in Ardia: let go there and the two make a folder (or it joins the folder).
 */
export function FavouriteGrid({ pinned, tabs, activeId, width, list }: {
  pinned: Tab[]; tabs: Tab[]; activeId: string | null; width: number; list: React.RefObject<View | null>;
}) {
  const actions = useActions();
  const { reduceMotion } = useTheme();
  const pinDrop = useBrowser(s => s.pinDrop);
  // A tab row being dragged within the list (not yet out over the page).
  const rowDrag = useBrowser(s => !!s.tabDrag && !s.tabDrag.out);
  const [move, setMoveState] = useState<TileMove | null>(null);
  const moving = useRef<TileMove | null>(null);
  const setMove = (next: TileMove | null) => { moving.current = next; setMoveState(next); };
  // Where a dropped tile went, held until the engine's order catches up so it doesn't jump back first.
  const [held, setHeld] = useState<{ id: string; index: number } | null>(null);
  // The slots: pinned tabs, some gathered into folders.
  const folders = useShellPrefs(p => p.favouriteFolders);
  const homes = useBrowser(s => s.pinnedHomes);
  const items = useMemo(() => gridItems(pinned, t => homeKey(homes[t.id]?.url ?? t.url), folders), [pinned, homes, folders]);
  const ids = items.map(i => i.id);
  // The tile a dragged one rests on, to make a folder with it; and the one it is resting on now, timing that.
  const [merge, setMergeState] = useState<string | null>(null);
  const merging = useRef<string | null>(null);
  const setMerge = (next: string | null) => { merging.current = next; setMergeState(next); };
  const resting = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const stopResting = () => { if (resting.current) clearTimeout(resting.current.timer); resting.current = null; };
  useEffect(() => stopResting, []);
  const key = ids.join(' ');
  // Tiles there when the grid first showed don't pop; a tab pinned since does.
  const known = useRef<Set<string> | null>(null);
  const fresh = (id: string) => !!known.current && !known.current.has(id);
  useEffect(() => { known.current = new Set([...(known.current ?? []), ...ids]); }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setHeld(null), [key]);
  useTimeout(() => setHeld(null), duration.dropSettle, [held]);
  const incoming = pinDrop && !ids.includes(pinDrop.tabId) ? tabs.find(t => t.id === pinDrop.tabId) ?? null : null;
  let order = move ? placeAt(ids, move.id, move.index) : held ? placeAt(ids, held.id, held.index) : ids;
  if (incoming && pinDrop) order = placeAt(order, incomingSlot, pinDrop.index);
  const count = Math.max(1, order.length);
  const columns = columnsFor(count);
  const tile = { width: tileWidth(width, columns, tileGap), height: geometry.favourite };
  const ref = useRef<View>(null);
  const empty = !order.length;
  const measure = useCallback(() => {
    if (!empty) {
      ref.current?.measureInWindow((x, y, w, h) =>
        actions.setFavouriteZone({ x, y, width: w, height: h, gap: tileGap, tileHeight: geometry.favourite }));
      return;
    }
    // No tiles: the first one's place is the band just above the list.
    list.current?.measureInWindow((x, y, w) => actions.setFavouriteZone({ x, y: y - geometry.favourite - tileGap, width: w,
      height: geometry.favourite, gap: tileGap, tileHeight: geometry.favourite }));
  }, [actions, empty, list]);
  // Measured afresh as a row drag starts, since the sidebar may have slid or the window moved since.
  useEffect(() => { if (rowDrag) measure(); }, [rowDrag, measure]);
  useEffect(() => () => actions.setFavouriteZone(null), [actions]);
  if (empty) return null;
  const latest = { ids, items, width };
  /** The tile at the middle of which (x, y) sits, from the grid's corner, with the tiles in their places. */
  const middleOf = (x: number, y: number, self: string) => {
    const slot = slotAt(x, y, latest.ids.length, latest.width, tile.height, tileGap);
    const target = latest.ids[slot];
    if (!target || target === self) return null;
    const o = slotOrigin(slot, columns, tile, tileGap);
    const band = merging.current === target ? folderBand.held : folderBand.enter;
    return Math.abs(x - o.x - tile.width / 2) <= tile.width * band && Math.abs(y - o.y - tile.height / 2) <= tile.height * band ? target : null;
  };
  const tabsOf = (item: GridItem | undefined) => (!item ? [] : item.kind === 'tab' ? [item.tab] : item.tabs);
  return <View ref={ref} onLayout={measure} style={{ height: gridHeight(count, tile.height, tileGap) }}>
    {order.map((id, index) => {
      if (id === incomingSlot) return incoming && <Cell key={incomingSlot} index={index} columns={columns} tile={tile} reduce={reduceMotion}>
        <IncomingTile tab={incoming} />
      </Cell>;
      const item = items.find(i => i.id === id);
      if (!item) return null;
      const dragged = move?.id === id;
      const ring = merge === id;
      if (item.kind === 'folder') return <Cell key={id} index={index} columns={columns} tile={tile} reduce={reduceMotion} ring={ring}
        fresh={fresh(id)}>
        <FolderTile folder={item.folder} tabs={item.tabs} activeId={activeId} />
      </Cell>;
      const tab = item.tab;
      return <Cell key={id} index={dragged ? move.from : index} offset={dragged ? move : undefined} columns={columns} tile={tile}
        reduce={reduceMotion} lifted={dragged} solid={dragged && !!merge} fresh={fresh(id)} ring={ring}
        drag={{
          start: () => { actions.closeHoverCard(); setMove({ id, from: latest.ids.indexOf(id), index: latest.ids.indexOf(id), dx: 0, dy: 0 }); },
          move: (dx, dy) => {
            const old = moving.current;
            if (!old) return;
            const origin = slotOrigin(old.from, columns, tile, tileGap);
            const x = origin.x + tile.width / 2 + dx, y = origin.y + tile.height / 2 + dy;
            // Resting on the middle of another tile: after a moment it rings, and the tiles hold their places.
            const target = middleOf(x, y, id);
            if (target !== resting.current?.id) {
              stopResting();
              if (merging.current && merging.current !== target) setMerge(null);
              if (target && merging.current !== target) {
                resting.current = { id: target, timer: setTimeout(() => {
                  tick('alignment');
                  setMerge(target);
                  const now = moving.current;
                  if (now) setMove({ ...now, index: now.from });
                }, duration.contact) };
              }
            }
            const next = merging.current ? old.from : slotAt(x, y, latest.ids.length, latest.width, tile.height, tileGap);
            if (next !== old.index) tick('alignment');
            setMove({ ...old, index: next, dx, dy });
          },
          end: () => {
            const old = moving.current;
            const onto = merging.current;
            stopResting();
            setMerge(null);
            setMove(null);
            if (!old) return;
            if (onto) {
              const target = tabsOf(latest.items.find(i => i.id === onto))[0];
              if (target) actions.foldFavourite(tab.id, target.id);
              return;
            }
            if (old.index === old.from) return;
            setHeld({ id: old.id, index: old.index });
            // The engine counts pinned tabs, not slots: a folder holds several.
            const flat = placeAt(latest.ids, old.id, old.index).flatMap(slot => tabsOf(latest.items.find(i => i.id === slot)));
            void actions.moveFavourite(tab.id, flat.findIndex(t => t.id === tab.id));
          },
        }}>
        <FavouriteTile tab={tab} width="100%" active={tab.id === activeId} />
      </Cell>;
    })}
  </View>;
}

/**
 * One slot of the grid. Its tile springs to the slot when the tiles reflow,
 * and follows the pointer, lifted, while it is dragged.
 */
function Cell({ index, columns, tile, reduce, offset, lifted, solid = false, fresh = false, ring = false, drag, children }: React.PropsWithChildren<{
  index: number; columns: number; tile: { width: number; height: number }; reduce: boolean;
  offset?: { dx: number; dy: number }; lifted?: boolean;
  /** A dragged tile rests on this one: letting go makes a folder of the two. */
  ring?: boolean;
  /** The lifted tile resting on another: solid, so only it reads. */
  solid?: boolean;
  /** Just pinned: it pops into place. */
  fresh?: boolean;
  drag?: { start(): void; move(dx: number, dy: number): void; end(): void };
}>) {
  const origin = slotOrigin(index, columns, tile, tileGap);
  const rect = useSpringRect({ x: origin.x + (offset?.dx ?? 0), y: origin.y + (offset?.dy ?? 0), width: tile.width, height: tile.height },
    reduce, !!offset);
  const latest = useRef(drag);
  latest.current = drag;
  const arrival = useArrival(fresh, reduce);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => !!latest.current && Math.hypot(g.dx, g.dy) > space.xs,
    onPanResponderGrant: () => latest.current?.start(),
    onPanResponderMove: (_, g) => latest.current?.move(g.dx, g.dy),
    onPanResponderRelease: () => latest.current?.end(),
    onPanResponderTerminate: () => latest.current?.end(),
    onPanResponderTerminationRequest: () => false,
  }), []);
  // The slot's place springs on the JS driver and the arrival's scale on the native one, so they are on views of their own.
  return <Animated.View {...pan.panHandlers} style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height,
    zIndex: lifted ? 1 : undefined }}>
    <Animated.View style={{ flex: 1, transform: [{ scale: arrival }] }}>
    {/* A lifted tile casts a shadow; like a row, it holds its size rather than scaling. */}
    {lifted && <Panel fill={solid ? 'surfacePopoverSolid' : 'tilePinnedHover'} radius="tile" elevation="menu"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />}
    {children}
    {ring && <MergeRing />}
    </Animated.View>
  </Animated.View>;
}

/** How near a tile's middle, as a share of its size, a dragged tile must rest to make a folder, and to keep it. */
const folderBand = { enter: 0.25, held: 0.4 } as const;

/** The accent ring just outside a tile that a dragged one rests on. */
function MergeRing() {
  const { colors } = useTheme();
  return <View pointerEvents="none" style={{ position: 'absolute', top: -geometry.tileRing, left: -geometry.tileRing,
    right: -geometry.tileRing, bottom: -geometry.tileRing, borderRadius: radius.tile + geometry.tileRing, borderWidth: geometry.tileRing,
    borderColor: colors.accent }} />;
}

/** Where a tab dragged in from the list will be pinned: an outlined tile with its icon. */
function IncomingTile({ tab }: { tab: Tab }) {
  const { colors } = useTheme();
  return <View style={{ flex: 1, borderRadius: radius.tile, borderWidth: geometry.dropZoneDash, borderStyle: 'dashed',
    borderColor: colors.dropZoneDash, backgroundColor: colors.tilePinned, alignItems: 'center', justifyContent: 'center' }}>
    <Favicon tab={tab} large />
  </View>;
}
