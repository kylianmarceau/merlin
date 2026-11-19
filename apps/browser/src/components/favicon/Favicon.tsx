import React, { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions, useBrowser } from '../../state/window';
import { Icon, geometry, opacity, radius, space, useBreathe, useEased, useTheme, type ColorRole, type IconTone, type SymbolName } from '../ui';

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
  // A symbol the user chose for the tab (Change Icon) stands in for the page's icon.
  if (tab.symbol) return <SymbolSlot large={large} name={tab.symbol as SymbolName} />;
  return <PageIcon tab={tab} large={large} />;
}

function SymbolSlot({ large, name }: { large: boolean; name: SymbolName }) {
  const side = large ? geometry.iconLarge : geometry.favicon;
  return <View style={{ width: side, height: side, alignItems: 'center', justifyContent: 'center' }}>
    <Icon name={name} tone="iconPrimary" size={large ? 'regular' : 'small'} />
  </View>;
}

function PageIcon({ tab, large }: { tab: Tab; large: boolean }) {
  const actions = useActions();
  const key = tab.favicon ?? '';
  const url = useBrowser(s => (key ? s.favicons[key] : undefined));
  const tone = useBrowser(s => (key ? s.iconTones[key] : undefined));
  useEffect(() => { if (key && !url) actions.loadFavicon(tab.id, key); }, [actions, tab.id, key, url]);
  const fallback = tab.audible ? 'speaker.wave.2' : isStartUrl(tab.url) ? 'magnifyingglass' : 'globe';
  return <IconSlot large={large} url={url} tone={tone} fallback={fallback} fallbackTone={tab.loading && !tab.audible ? 'tabLoading' : 'iconSecondary'} />;
}

/**
 * The icon's fixed square (16 pt, 20 pt large), so a title never moves when
 * the icon arrives: the symbol holds the place, and the icon fades in over
 * it in 100 ms. An icon that is all one dark colour (GitHub's black mark) is
 * drawn in the ink colour on the dark shell, and an all-white one on the
 * light shell, so neither vanishes.
 */
function IconSlot({ large, url, tone, fallback, fallbackTone }: {
  large: boolean; url: string | undefined; tone: IconTone | undefined; fallback: SymbolName; fallbackTone: ColorRole;
}) {
  const { colors, dark, reduceMotion } = useTheme();
  const side = large ? geometry.iconLarge : geometry.favicon;
  const [loaded, setLoaded] = useState<string | null>(null);
  const shown = useEased(!!url && loaded === url, reduceMotion);
  const template = (dark && tone === 'dark') || (!dark && tone === 'light');
  return <View style={{ width: side, height: side, alignItems: 'center', justifyContent: 'center' }}>
    {loaded !== url && <Icon name={fallback} tone={fallbackTone} size={large ? 'regular' : 'small'} />}
    {/* React Native macOS tints an image only as it is set, so a template is a fresh image. */}
    {!!url && <Animated.Image key={template ? `template:${colors.iconPrimary}` : 'plain'} source={{ uri: url }} accessible={false} onLoad={() => setLoaded(url)}
      style={{ position: 'absolute', width: side, height: side, borderRadius: radius.xs, opacity: shown,
        ...(template ? { tintColor: colors.iconPrimary } : null) }} />}
  </View>;
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
  const tone = useBrowser(s => (key ? s.iconTones[key] : undefined));
  useEffect(() => { if (url && icon === undefined) actions.loadPageFavicon(url); }, [actions, url, icon]);
  return <IconSlot large={large} url={icon || undefined} tone={tone} fallback="globe" fallbackTone="iconSecondary" />;
});
