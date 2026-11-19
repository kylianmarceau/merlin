import React, { useEffect } from 'react';
import { Animated, Image, View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions, useBrowser } from '../../state/window';
import { Icon, geometry, opacity, radius, space, useBreathe, useTheme } from '../ui';

/**
 * The page's own icon, sharp on Retina; a symbol until it arrives. `busy`
 * (a background tab loading) makes it breathe; the active tab's loading
 * shows as the bar under the address instead.
 */
export const Favicon = React.memo(function Favicon({ tab, large = false, busy = false, badges = false }: {
  tab: Tab; large?: boolean; busy?: boolean;
  /** Marks a WebKit tab with a small Safari badge, and a sleeping tab by dimming it, as in Ardia. */
  badges?: boolean;
}) {
  const { colors, reduceMotion } = useTheme();
  const breathe = useBreathe(busy, reduceMotion);
  return <Animated.View style={{ opacity: badges && tab.discarded ? opacity.sleeping : breathe }}>
    <FaviconImage tab={tab} large={large} />
    {badges && tab.engine === 'webkit' && <View accessibilityLabel="Shown in WebKit" style={{ position: 'absolute', right: -space.xs, bottom: -space.xs,
      width: geometry.engineBadge, height: geometry.engineBadge, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.engineBadge }}>
      <Icon name="safari" tone="iconSecondary" size="chevron" />
    </View>}
  </Animated.View>;
});

function FaviconImage({ tab, large }: { tab: Tab; large: boolean }) {
  const actions = useActions();
  const key = tab.favicon ?? '';
  const url = useBrowser(s => (key ? s.favicons[key] : undefined));
  useEffect(() => { if (key && !url) actions.loadFavicon(tab.id, key); }, [actions, tab.id, key, url]);
  const side = large ? geometry.iconLarge : geometry.favicon;
  if (url) return <Image source={{ uri: url }} accessible={false} style={{ width: side, height: side, borderRadius: radius.xs }} />;
  if (tab.audible) return <Icon name="speaker.wave.2" tone="iconSecondary" size={large ? 'regular' : 'small'} />;
  return <Icon name={isStartUrl(tab.url) ? 'magnifyingglass' : 'globe'} tone={tab.loading ? 'tabLoading' : 'iconSecondary'}
    size={large ? 'regular' : 'small'} />;
}

/**
 * A page's icon by its address, for rows that show a page rather than a tab
 * (bookmarks, history): from the history's icons, a globe until it arrives
 * or when the page has none.
 */
export const PageFavicon = React.memo(function PageFavicon({ url, large = false }: { url?: string; large?: boolean }) {
  const actions = useActions();
  const key = url ? `page:${url}` : '';
  const icon = useBrowser(s => (key ? s.favicons[key] : undefined));
  useEffect(() => { if (url && icon === undefined) actions.loadPageFavicon(url); }, [actions, url, icon]);
  const side = large ? geometry.iconLarge : geometry.favicon;
  if (icon) return <Image source={{ uri: icon }} accessible={false} style={{ width: side, height: side, borderRadius: radius.xs }} />;
  return <Icon name="globe" tone="iconSecondary" size={large ? 'regular' : 'small'} />;
});
