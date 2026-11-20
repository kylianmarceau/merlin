// How many unread items a page's title announces, as mail and chat sites do
// ("(3) Inbox", "Inbox (12) - Gmail", "5 unread", "• Slack"), for the badge on
// a favourite tile, as in Ardia. Plain arithmetic, tested without a window.

/** A count, `'dot'` for unread without a number, or null for nothing to show. */
export type Unread = number | 'dot' | null;

const leading = /^\s*[([](\d{1,5})\+?[)\]]\s/;
const inbox = /\b(?:inbox|unread|messages|notifications)\s*\((\d{1,5})\+?\)/i;
const words = /\b(\d{1,5})\+?\s+(?:unread|new messages?|new notifications?)\b/i;
const marked = /^\s*[•*!]\s+\S/;

export function unreadIn(title: string | undefined): Unread {
  if (!title) return null;
  for (const pattern of [leading, inbox, words]) {
    const found = pattern.exec(title);
    if (found) {
      const n = Number(found[1]);
      return n > 0 ? n : null;
    }
  }
  return marked.test(title) ? 'dot' : null;
}

/** As the badge reads it: up to 99, then "99+". */
export function unreadLabel(unread: number): string {
  return unread > 99 ? '99+' : String(unread);
}
