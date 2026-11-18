import React from 'react';
import { asError, interfaceDiagnostics } from '../../lib/diagnostics';
import { interfaceReporter, useBrowser } from '../../state/window';
import { Box, Button, DragRegion, EmptyState, Text, ThemeScope, geometry } from '../ui';

type Props = React.PropsWithChildren<{ windowId: string }>;
type State = { error: Error | null; componentStack: string; when: Date; generation: number; copied: boolean };

const appearance = { mode: 'system', accent: 'fern', reduceMotion: false } as const;

/**
 * One window's interface, and what it shows if drawing it fails (M34): the
 * tabs are still open in Chromium, so the window offers to start its
 * interface again, and to copy what went wrong. Chromium logs the failure.
 *
 * Reload Interface asks Chromium for a new React root for the window (a
 * fresh start for everything in it); if Chromium can't, this tree starts
 * again in place. A failure outside React (a timer, an event handler) never
 * reaches a boundary: the host reloads the whole bridge then (AppDelegate.mm).
 */
export class InterfaceBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: '', when: new Date(0), generation: 0, copied: false };
  private readonly reporter = interfaceReporter(this.props.windowId);

  static getDerivedStateFromError(thrown: unknown): Partial<State> {
    return { error: asError(thrown), when: new Date(), copied: false };
  }

  componentDidCatch(thrown: unknown, info: React.ErrorInfo) {
    const error = asError(thrown);
    const componentStack = info.componentStack ?? '';
    this.setState({ componentStack });
    this.reporter.report('failed', `${error.name}: ${error.message}`, [error.stack ?? '', componentStack].filter(Boolean).join('\n'));
  }

  private reload = async () => {
    if (await this.reporter.reloadWindow()) return;
    this.setState(s => ({ error: null, componentStack: '', generation: s.generation + 1, copied: false }));
  };

  private copy = async () => {
    const { error, componentStack, when } = this.state;
    const text = interfaceDiagnostics({ windowId: this.props.windowId, version: this.reporter.version(), error, componentStack, when });
    if (await this.reporter.copy(text)) this.setState({ copied: true });
  };

  render() {
    if (!this.state.error) return <React.Fragment key={this.state.generation}>{this.props.children}</React.Fragment>;
    return <ThemeScope appearance={appearance}>
      <Box flex={1} fill="windowBackground">
        <DragRegion style={{ height: geometry.toolbar }} />
        <Box flex={1} center>
          <EmptyState icon="exclamationmark.triangle" title="This window’s interface stopped working"
            detail="Your tabs are still open. Reload the interface to get them back."
            action={<Box row gap="sm" marginTop="sm">
              <Button label="Copy Diagnostics" onPress={() => void this.copy()} />
              <Button label="Reload Interface" variant="primary" onPress={() => void this.reload()} />
            </Box>} />
          {this.state.copied && <Text variant="caption" tone="textSecondary">Copied. Nothing from your pages is included.</Text>}
        </Box>
      </Box>
    </ThemeScope>;
  }
}

/** Tests only: fails while drawing once a test instance asks (test.shell throwInRender). */
export function FailForTest() {
  if (useBrowser(s => s.failInRender)) throw new Error('test.shell: a failure while drawing');
  return null;
}
