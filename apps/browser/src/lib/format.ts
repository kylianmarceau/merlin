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

const startPattern = /^(chrome|merlin):\/\/(newtab|new-tab-page|merlin-start|start)\/?$/;
/** New tabs show the shell's start page instead of a web page. */
export function isStartUrl(url: string | undefined) {
  return !url || url === 'about:blank' || startPattern.test(url);
}
