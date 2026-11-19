import React from 'react';
import type { Overlays } from '../../state/types';
import { lightDismissAction } from '../../lib/prompts';
import { useActions, useBrowser } from '../../state/window';
import { Dialog, Popover, PopoverBody, useLatest } from '../ui';
import { PromptBody } from './PromptBody';

/**
 * The browser's current question. Site questions (permissions, passwords,
 * translation, site information) open beside the address and leave the page
 * usable, and close like any popover, on Escape or a press outside them (on
 * the page too), with their quiet answer: Done, or Not now. Page and window
 * questions are dialogs, removed only by an answer or by Chromium
 * withdrawing the question.
 */
export function PromptOverlay({ shown }: { shown: Overlays['prompt'] }) {
  const anchor = useBrowser(s => s.anchors.site ?? s.anchors.address);
  const bounds = useBrowser(s => s.windowSize);
  const last = useLatest(shown);
  const popover = shown?.as === 'popover';
  const dialog = shown?.as === 'dialog';
  const current = last?.prompt;
  const actions = useActions();
  const dismiss = (reason: 'press' | 'escape' | 'blur') => {
    // Switching to another app leaves the question waiting.
    const quiet = current && reason !== 'blur' ? lightDismissAction(current) : null;
    if (current && quiet) void actions.answerPrompt(current.id, quiet, {}).catch(() => undefined);
  };
  return <>
    <Popover open={popover} anchor={anchor} bounds={bounds} label={current?.title ?? 'Request'} width="popoverWide" onClose={dismiss}>
      {current && last?.as === 'popover' && <PopoverBody gap="md"><PromptBody key={current.id} prompt={current} compact /></PopoverBody>}
    </Popover>
    {current && last?.as === 'dialog' && <Dialog open={dialog} bare title={current.title} place={current.anchor === 'page' ? 'top' : 'center'}>
      <PromptBody key={current.id} prompt={current} compact={false} />
    </Dialog>}
  </>;
}

