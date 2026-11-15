import React, { useEffect } from 'react';
import { Animated, Image } from 'react-native';
import { isStartUrl } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions, useBrowser } from '../../state/window';
import { Icon, geometry, radius, useBreathe, useTheme } from '../ui';

/**
 * The page's own icon, sharp on Retina; a symbol until it arrives. `busy`
 * (a background tab loading) makes it breathe; the active tab's loading
 * shows as the bar under the address instead.
 */
export const Favicon = React.memo(function Favicon({ tab, large = false, busy = false }: { tab: Tab; large?: boolean; busy?: boolean }) {
  const { reduceMotion } = useTheme();
  const breathe = useBreathe(busy, reduceMotion);
  return <Animated.View style={{ opacity: breathe }}><FaviconImage tab={tab} large={large} /></Animated.View>;
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
