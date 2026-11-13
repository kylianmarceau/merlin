// Loads and saves the shell's own preferences in AppKit's defaults.
import { parseSiteEngines, type PageEngine } from '../lib/engines';
import { preference, setPreference } from '../platform/shell';
import { shellPrefs, type ShellPrefs } from './shellPrefs';

let loaded = false;
/** Reads the saved values once; until then the defaults apply. */
export function loadShellPrefs() {
  if (loaded) return;
  loaded = true;
  preference('newTabPopup').then(value => shellPrefs.setState({ newTabPopup: value === 'on' }), () => {});
  preference('toolbarColor').then(value => {
    // Unset is the default, Match. Soft was the default before it, and saved
    // nothing, so those windows move to Match too.
    if (value === 'soft' || value === 'vivid' || value === 'white') shellPrefs.setState({ toolbarColor: value });
  }, () => {});
  preference('shellFollowsSite').then(value => shellPrefs.setState({ shellFollowsSite: value === 'on' }), () => {});
  void loadEnginePrefs();
}

let enginePrefs: Promise<void> | null = null;
/**
 * Reads which engine shows which sites, once. Tabs move to WebKit only after
 * this, so a site the person keeps in Chromium never opens in WebKit first.
 */
export function loadEnginePrefs(): Promise<void> {
  enginePrefs ??= Promise.all([
    preference('protectedVideoInWebKit').then(value => shellPrefs.setState({ protectedVideoInWebKit: value !== 'off' }), () => {}),
    preference('siteEngines').then(value => shellPrefs.setState({ siteEngines: parseSiteEngines(value) }), () => {}),
  ]).then(() => {});
  return enginePrefs;
}

export function setNewTabPopup(on: boolean) {
  shellPrefs.setState({ newTabPopup: on });
  return setPreference('newTabPopup', on ? 'on' : null);
}

export function setToolbarColor(style: ShellPrefs['toolbarColor']) {
  shellPrefs.setState({ toolbarColor: style });
  return setPreference('toolbarColor', style === 'match' ? null : style);
}

export function setShellFollowsSite(on: boolean) {
  shellPrefs.setState({ shellFollowsSite: on });
  return setPreference('shellFollowsSite', on ? 'on' : null);
}

export function setProtectedVideoInWebKit(on: boolean) {
  shellPrefs.setState({ protectedVideoInWebKit: on });
  return setPreference('protectedVideoInWebKit', on ? null : 'off');
}

/** Remembers which engine shows a site (an origin), or forgets the choice with null. */
export function setSiteEngine(site: string, engine: PageEngine | null) {
  const siteEngines = { ...shellPrefs.getState().siteEngines };
  if (engine) siteEngines[site] = engine;
  else delete siteEngines[site];
  shellPrefs.setState({ siteEngines });
  return setPreference('siteEngines', Object.keys(siteEngines).length ? JSON.stringify(siteEngines) : null);
}

export function forgetSiteEngines() {
  shellPrefs.setState({ siteEngines: {} });
  return setPreference('siteEngines', null);
}
