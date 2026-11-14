// macOS state Settings › General and Appearance show and change: the default
// browser, opening at login, the app icon, exporting bookmarks. Components
// reach the native shell only through here.
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import {
  appIcon, appIcons, chooseSaveFile, isDefaultBrowser, loginItem, makeDefaultBrowser, setAppIcon, setLoginItem,
  type AppIconChoice, type LoginItemStatus,
} from '../platform/shell';

export type { AppIconChoice, LoginItemStatus };

/** A value read from macOS, read again whenever Merlin comes back to the front. */
function useSystemValue<T>(read: () => Promise<T>, fallback: T): [T, (next: T) => void, () => void] {
  const [value, setValue] = useState(fallback);
  const reload = useCallback(() => { read().then(setValue, () => {}); }, [read]);
  useEffect(() => {
    reload();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') reload(); });
    return () => subscription.remove();
  }, [reload]);
  return [value, setValue, reload];
}

export function useDefaultBrowser() {
  const [isDefault, set] = useSystemValue(isDefaultBrowser, true);
  return { isDefault, make: () => void makeDefaultBrowser().then(set, () => {}) };
}

export function useLoginItem() {
  const [status, set] = useSystemValue<LoginItemStatus>(loginItem, 'notRegistered');
  return { status, set: (on: boolean) => void setLoginItem(on).then(set, () => {}) };
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
export async function exportBookmarks(write: (path: string) => Promise<unknown>): Promise<string | null> {
  const path = await chooseSaveFile('bookmarks.html');
  if (!path) return null;
  await write(path);
  return path;
}
