import React from 'react';
import type { Overlays } from '../../state/types';
import { useBrowser } from '../../state/window';
import { Box, Dialog, Popover, useLatest } from '../ui';
import { PromptBody } from './PromptBody';

/**
 * The browser's current question. Site questions (permissions, passwords,
 * translation, site information) open beside the address and leave the page
 * usable; page and window questions are dialogs. Neither closes on its own:
 * only an answer, or Chromium withdrawing the question, removes it.
 */
export function PromptOverlay({ shown }: { shown: Overlays['prompt'] }) {
  const anchor = useBrowser(s => s.anchors.site ?? s.anchors.address);
  const bounds = useBrowser(s => s.windowSize);
  const last = useLatest(shown);
  const popover = shown?.as === 'popover';
  const dialog = shown?.as === 'dialog';
  const current = last?.prompt;
  return <>
    <Popover open={popover} anchor={anchor} bounds={bounds} label={current?.title ?? 'Request'} width="popoverWide" onClose={() => {}}>
      {current && last?.as === 'popover' && <Box pad="sm"><PromptBody key={current.id} prompt={current} compact /></Box>}
    </Popover>
    {current && last?.as === 'dialog' && <Dialog open={dialog} bare title={current.title} place={current.anchor === 'page' ? 'top' : 'center'}>
      <PromptBody key={current.id} prompt={current} compact={false} />
    </Dialog>}
  </>;
}
