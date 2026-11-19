import React from 'react';
import { Animated, View } from 'react-native';
import type { BookmarkItem } from '../../state/types';
import { useShellPrefs } from '../../state/shellPrefs';
import { setShellPref } from '../../state/shellPrefsStorage';
import { useActions } from '../../state/window';
import { ContextMenu, Icon, IconButton, Pressable, Text, geometry, radius, space, useHoverFade, useInteraction, useTheme } from '../ui';
import { PageFavicon } from '../favicon/Favicon';
import { useBarBookmarks } from './BookmarksBar';

/** At most this many bookmarks show in the sidebar; the rest are a click away in the Library. */
const shownRows = 6;

/**
 * Bookmarks in the sidebar, under the pinned tabs: the Bookmarks Bar folder,
 * where the star saves, then Other Bookmarks as a folder. Its heading folds
 * it away and opens the rest in the Library. Hidden when there are none.
 */
export function SidebarBookmarks() {
  const actions = useActions();
  const folded = useShellPrefs(p => p.sidebarBookmarksFolded);
  const { items, reload } = useBarBookmarks();
  if (!items?.length) return null;
  const more = items.length - shownRows;
  return <View onMouseEnter={reload}>
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: space.sm + space.hair, paddingBottom: space.xs }}>
      <Pressable accessibilityRole="button" accessibilityLabel={folded ? 'Show bookmarks' : 'Hide bookmarks'}
        accessibilityState={{ expanded: !folded }} onPress={() => void setShellPref('sidebarBookmarksFolded', !folded)}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <Text variant="group">Bookmarks</Text>
        <Icon name={folded ? 'chevron.right' : 'chevron.down'} tone="iconSecondary" size="chevron" />
      </Pressable>
      <IconButton label="All bookmarks" tip="All bookmarks" keys={['⌥', '⌘', 'B']} icon="books.vertical" size="small"
        onPress={() => actions.openPanel('bookmarks')} />
    </View>
    {!folded && <View style={{ gap: geometry.hairline }}>
      {items.slice(0, shownRows).map(item => <BookmarkRow key={item.id} item={item} onChanged={reload} />)}
      {more > 0 && <MoreRow count={more} onPress={() => actions.openPanel('bookmarks')} />}
    </View>}
  </View>;
}

function BookmarkRow({ item, onChanged }: { item: BookmarkItem; onChanged(): void }) {
  const actions = useActions();
  const { colors, reduceMotion } = useTheme();
  const { hovered, handlers } = useInteraction();
  const wash = useHoverFade(hovered, reduceMotion);
  const title = item.title || item.domain || item.url || 'Bookmark';
  return <ContextMenu onOpen={() => void actions.bookmarkMenu(item, onChanged)}>
    <Pressable accessibilityRole="button" accessibilityLabel={item.folder ? `${title} folder` : `Bookmark: ${title}`}
      accessibilityHint={item.url} {...handlers}
      onPress={e => {
        if (item.folder) void actions.bookmarkFolderMenu(item.id);
        else if (item.url) void actions.openBookmark(item.url, !!(e.nativeEvent as { metaKey?: boolean }).metaKey);
      }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + space.hair, minHeight: geometry.row,
        paddingLeft: space.sm + space.hair, paddingRight: space.sm, borderRadius: radius.row }}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.row,
        backgroundColor: colors.tabHover, opacity: wash }} />
      {item.folder ? <Icon name="folder" tone="iconSecondary" size="small" /> : <PageFavicon url={item.url} />}
      <Text lines={1} flex={1} tone="tabText">{title}</Text>
      {item.folder && !!item.count && <Text variant="caption" tone="textTertiary">{String(item.count)}</Text>}
    </Pressable>
  </ContextMenu>;
}

function MoreRow({ count, onPress }: { count: number; onPress(): void }) {
  const { colors, reduceMotion } = useTheme();
  const { hovered, handlers } = useInteraction();
  const wash = useHoverFade(hovered, reduceMotion);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${count} more bookmarks, in the Library`} onPress={onPress} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + space.hair, minHeight: geometry.row,
      paddingLeft: space.sm + space.hair, borderRadius: radius.row }}>
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.row,
      backgroundColor: colors.tabHover, opacity: wash }} />
    <Icon name="ellipsis" tone="iconSecondary" size="small" />
    <Text tone="textSecondary">{`${count} more`}</Text>
  </Pressable>;
}
