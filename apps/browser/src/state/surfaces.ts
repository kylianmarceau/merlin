// Which overlays a window shows. Browser decisions (permission, password and
// page prompts) are never covered by the shell's own panels or popovers, and
// only one popover is open at a time.
import type { Prompt, Snapshot } from '../platform/protocol';
import type { Panel, PopoverName } from './store';

export type Overlays = {
  /** The browser's current decision, as a popover beside the address or a dialog. */
  prompt: { prompt: Prompt; as: 'popover' | 'dialog' } | null;
  /** Merlin's command menu. */
  palette: boolean;
  /** A full sheet (settings, library) or the command dialog. */
  panel: Panel;
  popover: PopoverName | 'extension-popup' | null;
};

/** Site-related questions sit beside the address; page and window ones are dialogs. */
export function promptPresentation(prompt: Prompt): 'popover' | 'dialog' {
  return prompt.anchor === 'site' && prompt.kind !== 'beforeUnload' ? 'popover' : 'dialog';
}

export function overlays(snapshot: Snapshot, panel: Panel, popover: PopoverName | null, revealedPromptId: string | null): Overlays {
  const pending = snapshot.prompt;
  const shown = pending && (!pending.quiet || pending.id === revealedPromptId) ? pending : null;
  const prompt = shown ? { prompt: shown, as: promptPresentation(shown) } : null;
  // A browser question is answered before the command menu returns.
  const palette = !!snapshot.modal.palette?.visible && !prompt;
  let open: Overlays['popover'] = null;
  if (!prompt && !palette) open = snapshot.extensionPopup ? 'extension-popup' : popover;
  return { prompt, palette, panel, popover: open };
}
