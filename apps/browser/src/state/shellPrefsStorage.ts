// Loads and saves the shell's own preferences in AppKit's defaults.
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
