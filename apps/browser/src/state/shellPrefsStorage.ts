// Loads and saves the shell's own preferences in AppKit's defaults.
import { preference, setPreference } from '../platform/shell';
import { shellPrefs } from './shellPrefs';

let loaded = false;
/** Reads the saved values once; until then the defaults apply. */
export function loadShellPrefs() {
  if (loaded) return;
  loaded = true;
  preference('newTabPopup').then(value => shellPrefs.setState({ newTabPopup: value === 'on' }), () => {});
}

export function setNewTabPopup(on: boolean) {
  shellPrefs.setState({ newTabPopup: on });
  return setPreference('newTabPopup', on ? 'on' : null);
}
