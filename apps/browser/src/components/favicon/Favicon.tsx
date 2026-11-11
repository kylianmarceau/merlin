import React, { useEffect } from 'react';
import { Image } from 'react-native';
import { isStartUrl } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions, useBrowser } from '../../state/window';
import { Icon, geometry, radius } from '../ui';

/** The page's own icon, sharp on Retina; a symbol until it arrives. */
export function Favicon({ tab }: { tab: Tab }) {
  const actions = useActions();
  const key = tab.favicon ?? '';
  const url = useBrowser(s => (key ? s.favicons[key] : undefined));
  useEffect(() => { if (key && !url) actions.loadFavicon(tab.id, key); }, [actions, tab.id, key, url]);
  if (url) return <Image source={{ uri: url }} accessible={false}
    style={{ width: geometry.favicon, height: geometry.favicon, borderRadius: radius.xs }} />;
  if (tab.audible) return <Icon name="speaker.wave.2" tone="iconSecondary" size="small" />;
  return <Icon name={isStartUrl(tab.url) ? 'sparkles' : 'globe'} tone={tab.loading ? 'tabLoading' : 'iconSecondary'} size="small" />;
}
