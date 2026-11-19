import { useMemo } from 'react';
import { isStartUrl } from '../../lib/format';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActiveTab } from '../../state/window';
import { siteChrome, useTheme } from '../ui';

/**
 * The colours of the joined tab, the toolbar under it and, if chosen, the
 * window shell: by default the colour along the top of the active page, so
 * the toolbar runs on into it; or the site's brand colour (Settings).
 * In every layout, as in Ardia: with tabs on top the joined tab and the
 * toolbar take it; in the sidebar layout the toolbar does whenever the card
 * has one (tabs hidden, or the address in the toolbar), and the shell if
 * chosen. New tab pages and crashed pages stay white.
 */
export function useSiteChrome() {
  const tab = useActiveTab();
  const { dark } = useTheme();
  const style = useShellPrefs(s => s.toolbarColor);
  const follow = useShellPrefs(s => s.shellFollowsSite);
  const page = tab && !tab.crashed && !tab.start && !isStartUrl(tab.url) ? tab : undefined;
  const site = page?.color, surface = page?.surface;
  return useMemo(() => siteChrome(dark ? 'dark' : 'light', site, style, follow, surface), [dark, site, style, follow, surface]);
}
