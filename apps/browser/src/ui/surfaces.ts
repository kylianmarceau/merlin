import type { Snapshot } from '@merlin/engine/protocol';
import type { Panel } from '../state/browser';

// One modal host per window. Browser-owned decisions cannot be covered by
// settings, a command menu, or an error from an unrelated browser operation.
export function visibleSurface(snapshot: Snapshot, error: string | null, panel: Panel, revealedPromptId: string | null = null) {
  if (snapshot.prompt && (!snapshot.prompt.quiet || snapshot.prompt.id === revealedPromptId)) return 'prompt' as const;
  if (error) return 'error' as const;
  if (snapshot.modal.palette?.visible) return 'palette' as const;
  return panel;
}
