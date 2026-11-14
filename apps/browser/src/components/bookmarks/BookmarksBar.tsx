import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { BookmarkItem } from '../../state/types';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActions } from '../../state/window';
import { ContextMenu, GlassFill, Icon, Text, geometry, radius, space, useInteraction, useTheme } from '../ui';

/**
 * The bookmarks bar under the toolbar (Settings › Appearance › Bookmarks, or
 * ⇧⌘B): Chromium's Bookmarks bar folder. A bookmark opens in the current tab
 * (⌘-click: a new one); a folder opens as a menu. It reads the folder again
 * when the pointer comes to it, so bookmarks added elsewhere appear.
 */
export function BookmarksBar() {
  const actions = useActions();
  const { colors } = useTheme();
  const large = useShellPrefs(p => p.bookmarksBarSize === 'large');
  const [items, setItems] = useState<BookmarkItem[]>([]);
  const load = useCallback(() => { actions.bookmarksBar().then(setItems, () => {}); }, [actions]);
  useEffect(load, [load]);
  return <View onMouseEnter={load} style={{ height: large ? geometry.bookmarksBarLarge : geometry.bookmarksBar,
    borderBottomWidth: geometry.hairline, borderBottomColor: colors.toolbarDivider, backgroundColor: colors.toolbarBackground }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ alignItems: 'center', gap: space.hair, paddingHorizontal: space.sm }}>
      {!items.length && <Text variant="label" weight="regular" tone="textTertiary">
        Bookmarks you add to the Bookmarks bar folder appear here
      </Text>}
      {items.map(item => <BarItem key={item.id} item={item} large={large} onChanged={load} />)}
    </ScrollView>
  </View>;
}

function BarItem({ item, large, onChanged }: { item: BookmarkItem; large: boolean; onChanged(): void }) {
  const actions = useActions();
  const { hovered, handlers } = useInteraction();
  const title = item.title || item.domain || item.url || 'Bookmark';
  return <ContextMenu onOpen={() => void actions.bookmarkMenu(item, onChanged)}>
    <Pressable accessibilityRole="button" accessibilityLabel={item.folder ? `${title} folder` : title} {...handlers}
      onPress={e => {
        if (item.folder) void actions.bookmarkFolderMenu(item.id);
        else if (item.url) void actions.openBookmark(item.url, !!(e.nativeEvent as { metaKey?: boolean }).metaKey);
      }}>
      {({ pressed }) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair,
        height: large ? geometry.control : geometry.controlCompact - space.hair, paddingHorizontal: space.sm, borderRadius: radius.sm,
        maxWidth: geometry.stripTab + space.xl }}>
        {(hovered || pressed) && <GlassFill radius={radius.sm} state={pressed ? 'pressed' : 'lit'} classic={pressed ? 'fillPressed' : 'fillHover'} />}
        <Icon name={item.folder ? 'folder' : 'globe'} tone="iconSecondary" size="small" />
        <Text variant={large ? 'body' : 'label'} weight="regular" lines={1}>{title}</Text>
      </View>}
    </Pressable>
  </ContextMenu>;
}
