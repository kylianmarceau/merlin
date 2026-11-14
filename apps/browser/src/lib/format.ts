// Plain formatting helpers. No React, no browser state.

export function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDay(ms: number, now = new Date()) {
  const date = new Date(ms);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** The host a person recognises: "example.com" for "https://www.example.com/a". */
export function displayHost(url: string) {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
  if (!match) return url;
  return match[1].replace(/^www\./, '').replace(/:\d+$/, '');
}

/** The address as the field shows it while not editing. */
export function displayAddress(url: string) {
  if (!url || url === 'about:blank') return '';
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

export function percent(received: number, total: number) {
  return total > 0 ? Math.min(100, Math.round(received / total * 100)) : null;
}

/**
 * How far along downloads arriving together are, 0 to 1: their bytes so far
 * over their total. Null while any of them has no known size yet.
 */
export function overallProgress(downloads: { received: number; total: number }[]) {
  if (!downloads.length || downloads.some(d => !(d.total > 0))) return null;
  const total = downloads.reduce((sum, d) => sum + d.total, 0);
  const received = downloads.reduce((sum, d) => sum + Math.min(d.received, d.total), 0);
  return received / total;
}

/** "349 MB", as Chromium and Finder write sizes (decimal units). */
export function formatBytes(bytes: number) {
  if (!(bytes > 0)) return '';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  return unit === 0 ? `${Math.round(value)} bytes` : `${value >= 100 || unit === 1 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** A file name's extension, lower case, or "". */
export function fileExtension(name: string) {
  return /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
}

/**
 * The downloads panel's second line, as in Ardia: the size of a finished
 * file, progress while it arrives, otherwise what happened. Chromium's
 * detail adds the site ("165 MB · example.com"), which the panel leaves out.
 */
export function downloadLine(d: { status?: string; state: string; received: number; total: number; detail?: string; url?: string }) {
  const status = d.status ?? (d.state === 'complete' ? 'done' : d.state === 'interrupted' ? 'failed' : d.state);
  const size = formatBytes(d.total > 0 ? d.total : d.received);
  const host = d.url ? displayHost(d.url) : '';
  const parts = (d.detail ?? '').split(' · ').filter(part => part && part !== host);
  if (status === 'done') return size || parts.join(' · ');
  if (status === 'removed') return size ? `${size} · Deleted` : 'Deleted';
  if (status === 'cancelled') return 'Cancelled';
  return parts.join(' · ') || size;
}

const startPattern = /^(chrome|merlin):\/\/(newtab|new-tab-page|merlin-start|start)\/?$/;
/** New tabs show the shell's start page instead of a web page. */
export function isStartUrl(url: string | undefined) {
  return !url || url === 'about:blank' || startPattern.test(url);
}
