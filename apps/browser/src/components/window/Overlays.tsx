import React, { useEffect, useRef } from 'react';
import { useActions, useBrowser, useOverlays, useSnapshot } from '../../state/window';
import { zoomChange } from '../../state/zoom';
import { Layer, Popover, ToastStack, autoPlacement, geometry, usePresence, useTheme, type Frame } from '../ui';
import { ExtensionPopupView } from '../extensions/ExtensionPopupView';
import { ExtensionsPopover } from '../extensions/ExtensionsPopover';
import { DownloadFlights } from '../library/DownloadFlights';
import { DownloadsPopover } from '../library/DownloadsPopover';
import { Library } from '../library/Library';
import { Suggestions } from '../omnibox/Suggestions';
import { CommandDialog } from '../palette/CommandDialog';
import { CommandMenu } from '../palette/CommandMenu';
import { PeekOverlay } from '../page/PeekOverlay';
import { Settings } from '../settings/Settings';
import { PromptOverlay } from '../site/PromptOverlay';
import { NewTabPopup } from '../start/NewTabPopup';
import { FolderPopover } from '../tabs/FolderPopover';
import { GroupNameDialog } from '../tabs/GroupNameDialog';
import { TabDropOverlay } from '../tabs/TabDropOverlay';
import { TabSwitcher } from '../tabs/TabSwitcher';
import { HoverCardOverlay } from '../tabs/HoverCard';
import { HudLayer } from './Hud';

/**
 * Everything drawn over the window, in fixed layers: sheets, then dialogs,
 * then popovers, then notices. Which ones show is decided in state/surfaces.
 */
export function Overlays({ pageTop = 0 }: { pageTop?: number }) {
  const snapshot = useSnapshot();
  const actions = useActions();
  const shown = useOverlays();
  const toasts = useBrowser(s => s.toasts);
  const naming = useBrowser(s => !!s.groupDialog);
  // The page in front zoomed: its zoom shows over the page for a moment, as Dia's HUD does, with Reset while it isn't the default.
  const zoomedFrom = useRef(snapshot);
  useEffect(() => {
    const zoom = zoomChange(zoomedFrom.current, snapshot);
    zoomedFrom.current = snapshot;
    if (zoom) actions.showHud(`${zoom.percent}%`, 'info', 'magnifyingglass',
      zoom.default ? undefined : { label: 'Reset', run: () => void actions.command('browser zoom-reset') });
  }, [snapshot]);  // eslint-disable-line react-hooks/exhaustive-deps
  const anchors = useBrowser(s => s.anchors);
  const bounds = useBrowser(s => s.windowSize);
  const { reduceMotion } = useTheme();
  const settings = usePresence(shown.panel === 'settings', 'sheet', reduceMotion);
  const libraryOpen = shown.panel === 'history' || shown.panel === 'bookmarks' || shown.panel === 'downloads';
  const library = usePresence(libraryOpen, 'sheet', reduceMotion);
  const popup = snapshot.extensionPopup;
  // Buttons in the sidebar footer open upwards; toolbar and strip buttons open downwards.
  const place = (anchor: Frame | undefined) => autoPlacement(anchor, bounds, anchor && anchor.x < bounds.width / 2 ? 'start' : 'end');
  return <>
    <Layer level="sheet">
      {settings.mounted && <Settings open={shown.panel === 'settings'} />}
      {library.mounted && <Library open={libraryOpen} />}
    </Layer>
    <Layer level="dialog">
      <PeekOverlay />
      <CommandDialog open={shown.panel === 'command'} />
      <CommandMenu open={shown.palette} palette={snapshot.modal.palette ?? null} />
      <NewTabPopup open={shown.panel === 'newTab' && !shown.palette} />
      <NewTabPopup location open={shown.panel === 'location' && !shown.palette} />
      <TabSwitcher />
      <GroupNameDialog />
    </Layer>
    <Layer level="popover">
      <TabDropOverlay />
      {!shown.panel && !shown.palette && !naming && <HoverCardOverlay />}
      <PromptOverlay shown={shown.prompt} />
      <Suggestions />
      <FolderPopover />
      <Popover open={shown.popover === 'extensions'} anchor={anchors.extensions} bounds={bounds} placement={place(anchors.extensions)}
        label="Extensions" onClose={actions.closePopover}>
        <ExtensionsPopover />
      </Popover>
      <Popover open={shown.popover === 'extension-popup' && !!popup} anchor={anchors.extensions} bounds={bounds}
        placement={place(anchors.extensions)} width={(popup?.width ?? 0) + geometry.hairline * 2} label={popup?.name ?? 'Extension'} onClose={actions.closePopover} flush>
        {popup && <ExtensionPopupView popup={popup} />}
      </Popover>
      <Popover open={shown.popover === 'downloads'} anchor={anchors.downloads} bounds={bounds} placement={place(anchors.downloads)}
        label="Downloads" width="popover" onClose={actions.closePopover}>
        <DownloadsPopover />
      </Popover>
    </Layer>
    <Layer level="toast">
      <DownloadFlights />
      <HudLayer top={pageTop} />
      <ToastStack toasts={toasts} onDismiss={actions.dismissToast} />
    </Layer>
  </>;
}
