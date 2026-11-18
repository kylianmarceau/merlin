// What "Copy Diagnostics" copies when a window's interface fails: enough to
// file a report with, and nothing from the window's pages (no addresses,
// titles or text), since it is meant to be pasted into an issue.

export type InterfaceFailure = {
  windowId: string;
  /** Merlin's release version, or null for a build that wasn't packaged as one. */
  version: string | null;
  error: unknown;
  /** React's component stack: which components were drawing. */
  componentStack?: string;
  when: Date;
};

/** The error as an Error, whatever was thrown. */
export function asError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  return new Error(typeof thrown === 'string' ? thrown : `A non-error was thrown: ${String(thrown)}`);
}

export function interfaceDiagnostics({ windowId, version, error, componentStack, when }: InterfaceFailure): string {
  const e = asError(error);
  const lines = [
    `Merlin ${version ?? '(development build)'}: the interface failed in window ${windowId}`,
    `At ${when.toISOString()}`,
    '',
    `${e.name}: ${e.message}`,
  ];
  const stack = (e.stack ?? '').split('\n').filter(line => line.trim() && !line.includes(e.message)).map(line => line.trimEnd());
  if (stack.length) lines.push('', 'Stack:', ...stack);
  const components = (componentStack ?? '').split('\n').map(line => line.trim()).filter(Boolean);
  if (components.length) lines.push('', 'Components:', ...components.map(line => `  ${line}`));
  return lines.join('\n');
}
