// Finder's icon for each kind of file, for the downloads panel. One request
// per extension and size; the answer is shared by every window.
import { useEffect, useState } from 'react';
import { fileExtension } from '../lib/format';
import { fileIcon } from '../platform/shell';

const icons = new Map<string, Promise<string | null>>();

export function useFileIcon(name: string, size: number): string | null {
  const key = `${fileExtension(name)}@${size}`;
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!icons.has(key)) icons.set(key, fileIcon(fileExtension(name), size).catch(() => null));
    void icons.get(key)!.then(value => { if (live) setUri(value); });
    return () => { live = false; };
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  return uri;
}
