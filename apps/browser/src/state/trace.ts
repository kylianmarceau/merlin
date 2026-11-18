// Timing lines for benchmarks and probes, appended to $MERLIN_STARTUP_TRACE
// (scripts/probe_large_libraries.py reads them). Without it nothing is
// measured or written.
import { trace, traceEnabled } from '../platform/shell';

export const tracing = traceEnabled();
export const traceNow = () => performance.now();

/** "<event> <ms> key=value…" */
export function traceTiming(event: string, ms: number, fields: Record<string, string | number> = {}) {
  if (!tracing) return;
  try { trace([event, ms.toFixed(2), ...Object.entries(fields).map(([k, v]) => `${k}=${v}`)].join(' ')); } catch { /* tracing is best effort */ }
}
