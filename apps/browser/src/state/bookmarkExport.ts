// Exporting bookmarks: choose a file, have Chromium write it, and say what
// happened. "Saved" only ever follows a write that succeeded.
import { settle, type ActionResult } from '../lib/result';

export type ExportOutcome =
  | { kind: 'cancelled' }
  | { kind: 'saved'; path: string }
  | { kind: 'failed'; error: string };

export async function exportBookmarksTo(
  choose: () => Promise<string | null>,
  write: (path: string) => Promise<ActionResult<unknown>>,
): Promise<ExportOutcome> {
  const chosen = await settle(choose);
  if (!chosen.ok) return { kind: 'failed', error: chosen.error };
  if (!chosen.value) return { kind: 'cancelled' };
  const written = await write(chosen.value);
  return written.ok ? { kind: 'saved', path: chosen.value } : { kind: 'failed', error: written.error };
}

const idle = 'To an HTML file that Chrome, Safari, Firefox and every other browser can import.';

/** The export row's detail text and error, for the last outcome. */
export function exportStatus(outcome: ExportOutcome | null): { detail: string; error: string | null } {
  if (outcome?.kind === 'saved') {
    return { detail: `Saved to ${outcome.path.replace(/^\/Users\/[^/]+(?=\/|$)/, '~')}.`, error: null };
  }
  return { detail: idle, error: outcome?.kind === 'failed' ? outcome.error : null };
}
