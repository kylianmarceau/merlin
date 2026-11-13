import { useMemo } from 'react';
import { isStartUrl } from '../../lib/format';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActiveTab, useSnapshot } from '../../state/window';
import { siteChrome, useTheme } from '../ui';

/**
 * The colours of the joined tab, the toolbar under it and, if chosen, the
 * window shell: by default the colour along the top of the active page, so
 * the toolbar runs on into it; or the site's brand colour (Settings).
 * Only with tabs across the top; new tab pages and crashed pages stay white.
 */
export function useSiteChrome() {
  const snapshot = useSnapshot();
  const tab = useActiveTab();
  const { dark } = useTheme();
  const style = useShellPrefs(s => s.toolbarColor);
  const follow = useShellPrefs(s => s.shellFollowsSite);
  const top = snapshot.modal.tabLayout === 'top';
  const page = top && tab && !tab.crashed && !tab.start && !isStartUrl(tab.url) ? tab : undefined;
  const site = page?.color, surface = page?.surface;
  return useMemo(() => siteChrome(dark ? 'dark' : 'light', site, style, follow, surface), [dark, site, style, follow, surface]);
}
