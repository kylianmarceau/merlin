import React, { useCallback, useEffect, useState } from 'react';
import { Animated, ScrollView, View } from 'react-native';
import type { BookmarkItem } from '../../state/types';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActions, useSnapshot } from '../../state/window';
import { ContextMenu, Icon, Pressable, Text, geometry, radius, space, useHoverFade, useInteraction, useTheme } from '../ui';
import { PageFavicon } from '../favicon/Favicon';

/**
 * Reads the bookmarks bar's contents (Chromium's Bookmarks Bar folder, then
 * Other Bookmarks as a folder) and again whenever any bookmark changes: the
 * snapshot's tabs say which pages are bookmarked, so a change there is a
 * change here. `reload` reads them again at once.
 */
export function useBarBookmarks() {
  const actions = useActions();
  const snapshot = useSnapshot();
  const [items, setItems] = useState<BookmarkItem[] | null>(null);
  const reload = useCallback(() => { actions.bookmarksBar().then(setItems, () => {}); }, [actions]);
  const marks = snapshot.tabs.map(t => (t.bookmarked ? '1' : '0')).join('');
  useEffect(reload, [reload, marks]);
  return { items, reload };
}

/**
 * The bookmarks bar over the page (Settings › Appearance › Bookmarks):
 * Chromium's Bookmarks Bar folder, where the star saves, then Other
 * Bookmarks. A bookmark opens in the current tab (⌘-click: a new one); a
 * folder opens as a menu. It reads the folder again when the pointer comes
 * to it, so bookmarks added elsewhere appear.
 */
export function BookmarksBar() {
  const { colors } = useTheme();
  const large = useShellPrefs(p => p.bookmarksBarSize === 'large');
  const { items, reload } = useBarBookmarks();
  return <View onMouseEnter={reload} style={{ height: large ? geometry.bookmarksBarLarge : geometry.bookmarksBar,
    borderBottomWidth: geometry.hairline, borderBottomColor: colors.toolbarDivider, backgroundColor: colors.toolbarBackground }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ alignItems: 'center', gap: space.hair, paddingHorizontal: space.sm }}>
      {items && !items.length && <Text variant="label" weight="regular" tone="textTertiary">
        Press the bookmark in the address field, or ⌘D, and the page appears here
      </Text>}
      {items?.map(item => <BarItem key={item.id} item={item} large={large} onChanged={reload} />)}
    </ScrollView>
  </View>;
}

function BarItem({ item, large, onChanged }: { item: BookmarkItem; large: boolean; onChanged(): void }) {
  const { colors, reduceMotion } = useTheme();
  const actions = useActions();
  const { hovered, handlers } = useInteraction();
  const wash = useHoverFade(hovered, reduceMotion);
  const title = item.title || item.domain || item.url || 'Bookmark';
  return <ContextMenu onOpen={() => void actions.bookmarkMenu(item, onChanged)}>
    <Pressable accessibilityRole="button" accessibilityLabel={item.folder ? `${title} folder` : title} {...handlers}
      onPress={e => {
        if (item.folder) void actions.bookmarkFolderMenu(item.id);
        else if (item.url) void actions.openBookmark(item.url, !!(e.nativeEvent as { metaKey?: boolean }).metaKey);
      }}>
      {({ pressed }) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair,
        height: large ? geometry.control : geometry.controlCompact - space.hair, paddingHorizontal: space.sm, borderRadius: radius.sm,
        maxWidth: geometry.pageLinkMax }}>
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          borderRadius: radius.sm, backgroundColor: colors[pressed ? 'fillPressed' : 'fillHover'], opacity: pressed ? 1 : wash }} />
        {item.folder ? <Icon name="folder" tone="iconSecondary" size="small" /> : <PageFavicon url={item.url} />}
        <Text variant={large ? 'body' : 'label'} weight="regular" lines={1}>{title}</Text>
      </View>}
    </Pressable>
  </ContextMenu>;
}
