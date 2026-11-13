// Preferences the shell keeps itself, through AppKit, rather than in the
// Chromium profile. They apply to every window, so one store is shared.
// Reading and saving them is in shellPrefsStorage.ts.
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export type ShellPrefs = {
  /** New tabs start as a pop-up over the current page instead of a page of their own. */
  newTabPopup: boolean;
  /** How the active tab and toolbar take the site's colour with tabs on top: "match", "soft", "vivid" or "white". */
  toolbarColor: 'match' | 'soft' | 'vivid' | 'white';
  /** The window shell takes the site's colour too, instead of the workspace colour. */
  shellFollowsSite: boolean;
};

export const shellPrefs = createStore<ShellPrefs>()(() => ({ newTabPopup: false, toolbarColor: 'match', shellFollowsSite: false }));

export function useShellPrefs<T>(select: (prefs: ShellPrefs) => T): T {
  return useStore(shellPrefs, select);
}
