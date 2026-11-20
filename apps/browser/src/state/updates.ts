// Settings › General › Updates: Merlin asks GitHub Releases whether a newer
// version exists. Only when the person turns automatic checks on, or presses
// Check Now (see docs/PRIVACY.md). It never downloads or installs anything;
// Settings shows the result and links to the release page.
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { effectiveChannel, newestUpdate, type Release, type Update } from '../lib/updates';
import { preference, releaseVersion, setPreference } from '../platform/shell';
import { shellPrefs } from './shellPrefs';

export const RELEASES_URL = 'https://api.github.com/repos/kylianmarceau/merlin/releases?per_page=30';
const CHECK_EVERY_MS = 8 * 60 * 60 * 1000;

export type UpdateState = {
  /** The running release, or null for a build not packaged as a release. */
  version: string | null;
  status: 'idle' | 'checking' | 'current' | 'available' | 'failed';
  update: Update | null;
  /** Milliseconds since the epoch of the last finished check, or 0. */
  lastCheck: number;
  error: string | null;
};

export const updates = createStore<UpdateState>()(() => ({
  version: releaseVersion(), status: 'idle', update: null, lastCheck: 0, error: null,
}));
export const useUpdates = <T>(select: (state: UpdateState) => T) => useStore(updates, select);

/** Asks GitHub once; resolves with the update found, if any. */
export async function checkForUpdates(): Promise<Update | null> {
  const { version, status } = updates.getState();
  if (!version || status === 'checking') return updates.getState().update;
  updates.setState({ status: 'checking', error: null });
  try {
    // A generic client name: nothing about the person goes with the request.
    const response = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Merlin' } });
    if (!response.ok) throw new Error(response.status === 404 ? 'No releases are published yet.' : `GitHub answered ${response.status}.`);
    const releases = (await response.json()) as Release[];
    const update = newestUpdate(releases, version, effectiveChannel(shellPrefs.getState().updateChannel, version));
    const lastCheck = Date.now();
    updates.setState({ status: update ? 'available' : 'current', update, lastCheck });
    void setPreference('updateLastCheck', String(lastCheck));
    return update;
  } catch (e) {
    updates.setState({ status: 'failed', error: e instanceof Error ? e.message : String(e), lastCheck: Date.now() });
    return null;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
/**
 * Starts or stops the automatic checks as the setting says. One check when
 * the last was over eight hours ago, then one every eight hours.
 */
export function followUpdateSetting() {
  const apply = (on: boolean) => {
    if (timer) { clearInterval(timer); timer = null; }
    if (!on || !updates.getState().version) return;
    const run = () => void checkForUpdates();
    void preference('updateLastCheck').then(raw => {
      const last = Number(raw) || 0;
      updates.setState({ lastCheck: last });
      if (Date.now() - last > CHECK_EVERY_MS) run();
    }, run);
    timer = setInterval(run, CHECK_EVERY_MS);
  };
  apply(shellPrefs.getState().updateChecks);
  return shellPrefs.subscribe((next, previous) => { if (next.updateChecks !== previous.updateChecks) apply(next.updateChecks); });
}
