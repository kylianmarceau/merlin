// macOS state Settings › General and Appearance show and change: the default
// browser, opening at login, the app icon, exporting bookmarks. Components
// reach the native shell only through here.
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { errorText, type ActionResult } from '../lib/result';
import { exportBookmarksTo, type ExportOutcome } from './bookmarkExport';
import {
  appIcon, appIcons, chooseSaveFile, isDefaultBrowser, loginItem, makeDefaultBrowser, setAppIcon, setLoginItem,
  type AppIconChoice, type LoginItemStatus,
} from '../platform/shell';

export type { AppIconChoice, LoginItemStatus, ExportOutcome };

/**
 * A value read from macOS, read again whenever Merlin comes back to the
 * front. A failed read or change is reported in `error`, not dropped.
 */
function useSystemValue<T>(read: () => Promise<T>, fallback: T) {
  const [value, setValue] = useState(fallback);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    read().then(v => { setValue(v); setError(null); }, e => setError(errorText(e)));
  }, [read]);
  useEffect(() => {
    reload();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') reload(); });
    return () => subscription.remove();
  }, [reload]);
  const change = (work: Promise<T>) => {
    setError(null);
    work.then(setValue, e => setError(errorText(e)));
  };
  return { value, error, change, reload };
}

export function useDefaultBrowser() {
  const system = useSystemValue(isDefaultBrowser, true);
  return { isDefault: system.value, error: system.error, make: () => system.change(makeDefaultBrowser()) };
}

export function useLoginItem() {
  const system = useSystemValue<LoginItemStatus>(loginItem, 'notRegistered');
  return { status: system.value, error: system.error, set: (on: boolean) => system.change(setLoginItem(on)) };
}

export function useAppIcons(size: number) {
  const [choices, setChoices] = useState<AppIconChoice[]>([]);
  const [current, setCurrent] = useState('default');
  useEffect(() => {
    appIcons(size).then(setChoices, () => {});
    appIcon().then(setCurrent, () => {});
  }, [size]);
  return { choices, current, choose: (id: string) => { setCurrent(id); void setAppIcon(id); } };
}

/** Asks where to save, then has Chromium write the bookmarks there. */
export function exportBookmarks(write: (path: string) => Promise<ActionResult<unknown>>): Promise<ExportOutcome> {
  return exportBookmarksTo(() => chooseSaveFile('bookmarks.html'), write);
}
