// The outcome of a browser request made from a control: what it returned, or
// why it failed. Callers branch on `ok`, never on state read before the await.
export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Waits for `work` and says how it went; never throws. */
export async function settle<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}
