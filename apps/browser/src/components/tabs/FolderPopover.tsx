import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { folderTitle, gridItems, homeKey } from '../../state/favouriteFolders';
import { columnsFor, tileWidth } from '../../state/favouriteGrid';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { Popover, Text, geometry, space } from '../ui';
import { tileGap } from './FavouriteGrid';
import { FavouriteTile } from './TabRow';

/** The most tiles across an open folder. */
const folderColumns = 3;

/**
 * A favourite folder opened under its tile, as in Ardia: its name, then its
 * tiles, which work as they do in the grid (press, hover card, menu with
 * Remove from Folder). Choosing one of its tabs closes it.
 */
export function FolderPopover() {
  const actions = useActions();
  const snapshot = useSnapshot();
  const open = useBrowser(s => s.openFolder);
  const bounds = useBrowser(s => s.windowSize);
  const homes = useBrowser(s => s.pinnedHomes);
  const folders = useShellPrefs(p => p.favouriteFolders);
  const item = useMemo(() => {
    if (!open) return null;
    const pinned = snapshot.tabs.filter(t => t.pinned);
    const found = gridItems(pinned, t => homeKey(homes[t.id]?.url ?? t.url), folders).find(i => i.kind === 'folder' && i.folder.id === open.folderId);
    return found?.kind === 'folder' ? found : null;
  }, [open, snapshot.tabs, homes, folders]);
  // Ungrouped, or down to one tab, it closes; so it does when a tab is chosen.
  useEffect(() => { if (open && !item) actions.closeFavouriteFolder(); }, [open, item, actions]);
  const activeId = snapshot.activeTabId;
  const firstActive = React.useRef(activeId);
  useEffect(() => { firstActive.current = activeId; }, [open?.folderId]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && activeId !== firstActive.current) actions.closeFavouriteFolder(); }, [activeId]);  // eslint-disable-line react-hooks/exhaustive-deps
  const columns = Math.min(folderColumns, columnsFor(item?.tabs.length ?? 1));
  const width = geometry.popover;
  const inner = width - space.md * 2;
  const tile = tileWidth(inner, columns, tileGap);
  return <Popover open={!!open && !!item} anchor={open?.anchor} bounds={bounds} placement="below-start" label="Folder"
    width={width} onClose={actions.closeFavouriteFolder}>
    {item && <View style={{ paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.sm }}>
      <Text variant="label" weight="semibold" tone="textSecondary" lines={1}>{folderTitle(item.folder, item.tabs.length)}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tileGap }}>
        {item.tabs.map(tab => <FavouriteTile key={tab.id} tab={tab} width={tile} active={tab.id === activeId} />)}
      </View>
    </View>}
  </Popover>;
}
