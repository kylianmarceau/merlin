import { useCallback, useRef } from 'react';
import { duration } from './motion';

/**
 * Escape in a one-line text field. macOS usually turns it into a "cancel"
 * key press rather than a key down, so fields listen for both and this runs
 * the handler once.
 */
export function useEscape(onEscape: () => void) {
  const last = useRef(0);
  const latest = useRef(onEscape);
  latest.current = onEscape;
  return useCallback(() => {
    const now = Date.now();
    if (now - last.current < duration.fast) return;
    last.current = now;
    latest.current();
  }, []);
}
