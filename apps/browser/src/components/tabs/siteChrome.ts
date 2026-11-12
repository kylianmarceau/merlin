import { useMemo } from 'react';
import { isStartUrl } from '../../lib/format';
import { useShellPrefs } from '../../state/shellPrefs';
import { useActiveTab, useSnapshot } from '../../state/window';
import { siteChrome, useTheme } from '../ui';

/**
 * The colours of the joined tab, the toolbar under it and, if chosen, the
 * window shell: the active site's colour in the treatment picked in Settings.
 * Only with tabs across the top; new tab pages and crashed pages stay white.
 */
export function useSiteChrome() {
  const snapshot = useSnapshot();
  const tab = useActiveTab();
  const { dark } = useTheme();
  const style = useShellPrefs(s => s.toolbarColor);
  const follow = useShellPrefs(s => s.shellFollowsSite);
  const top = snapshot.modal.tabLayout === 'top';
  const site = top && tab && !tab.crashed && !isStartUrl(tab.url) ? tab.color : undefined;
  return useMemo(() => siteChrome(dark ? 'dark' : 'light', site, style, follow), [dark, site, style, follow]);
}
