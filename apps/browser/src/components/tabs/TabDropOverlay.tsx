import React, { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { tabTitle } from './TabRow';
import { contains, dropCandidates, dropOutcome, splitPartner, zoneHit, zoneRect } from '../../state/tabDrag';
import type { Rect, SplitSide, ZoneStage } from '../../state/types';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import {
  Icon, Panel, Text, duration, geometry, radius, space, useEased, useLatest, usePresence, useSpringRect, useTheme, useTimeout,
} from '../ui';
import { Favicon } from '../favicon/Favicon';

const zoneLabel: Record<SplitSide, string> = { left: 'Add left split', right: 'Add right split' };

/**
 * A tab dragged out of the tabs, as in Ardia. It follows the pointer as a
 * small card that says what letting go will do. Over the page, each pane it
 * can go beside slides in a drop zone from each edge; they grow a moment
 * later, and the one the tab reaches lights up and leans towards it. Let go
 * there and the tab shows on that side in a split view; anywhere else on
 * the page, or outside the window, it opens in a window of its own.
 */
export function TabDropOverlay() {
  const drag = useBrowser(s => s.tabDrag);
  const panes = useBrowser(s => s.panes);
  const recent = useBrowser(s => s.recentTabs);
  const page = useBrowser(s => s.anchors.page);
  const bounds = useBrowser(s => s.windowSize);
  const snapshot = useSnapshot();
  const actions = useActions();
  const { reduceMotion } = useTheme();
  const lifted = drag?.out ? drag : null;
  const popup = snapshot.kind === 'popup';
  const inside = !!lifted && lifted.x >= 0 && lifted.y >= 0 && lifted.x <= bounds.width && lifted.y <= bounds.height;
  const partner = lifted ? splitPartner(lifted.tabId, snapshot.tabs.map(t => t.id), recent) : null;
  const candidates = lifted && !popup ? dropCandidates(panes, lifted.tabId, partner) : [];
  const shown = inside && candidates.length > 0;
  // The zones slide in small, then grow; only grown zones take the tab.
  const [grown, setGrown] = useState(false);
  useEffect(() => { if (!shown) setGrown(false); }, [shown]);
  useTimeout(() => { if (shown) setGrown(true); }, duration.dropZone, [shown]);
  const overPage = !!lifted && !!page && contains(page, lifted.x, lifted.y);
  const hit = lifted && shown && grown && overPage ? zoneHit(candidates, lifted.x, lifted.y, lifted.target) : null;
  useEffect(() => { actions.setTabDropTarget(hit); }, [hit?.tabId, hit?.side, actions]);  // eslint-disable-line react-hooks/exhaustive-deps
  const zones = usePresence(shown, 'dropZone', reduceMotion);
  const kept = useLatest(shown ? candidates : null);
  const card = usePresence(!!lifted && inside, 'fade', reduceMotion);
  const latest = useLatest(lifted);
  const target = lifted?.target ?? null;
  const pointerX = lifted?.x ?? 0;
  if (!zones.mounted && !card.mounted) return null;
  return <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
    {zones.mounted && kept?.flatMap(([tabId, pane]) => (['left', 'right'] as const).map(side =>
      <DropZone key={`${tabId}:${side}`} pane={pane} side={side} progress={zones.progress} pointerX={pointerX}
        stage={target?.tabId === tabId && target.side === side ? 'active' : grown ? 'grown' : 'rest'} />))}
    {card.mounted && latest && <DragCard tabId={latest.tabId} x={latest.x} y={latest.y} progress={card.progress}
      outcome={dropOutcome({ x: latest.x, y: latest.y, window: bounds, page, target: latest.target,
        canDetach: !popup && snapshot.tabs.length > 1 })?.kind ?? null} />}
  </View>;
}

/** The dragged tab beside the pointer, with what letting go does: a split view or a window of its own. */
function DragCard({ tabId, x, y, progress, outcome }: {
  tabId: string; x: number; y: number; progress: Animated.Value; outcome: 'split' | 'window' | null;
}) {
  const snapshot = useSnapshot();
  const tab = snapshot.tabs.find(t => t.id === tabId);
  if (!tab) return null;
  return <Animated.View style={{ position: 'absolute', left: x + space.md, top: y + space.md, opacity: progress }}>
    <Panel elevation="menu" radius="control" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm,
      maxWidth: geometry.stripTab + geometry.stripTabIcon, paddingHorizontal: space.md, height: geometry.control + space.xs }}>
      <Favicon tab={tab} />
      <Text lines={1} weight="medium" style={{ flexShrink: 1 }}>{tabTitle(tab)}</Text>
      {outcome && <Icon name={outcome === 'split' ? 'rectangle.split.2x1' : 'arrow.up.forward.app'} size="small"
        tone={outcome === 'split' ? 'dropZoneActiveText' : 'iconSecondary'} />}
    </Panel>
  </Animated.View>;
}

/**
 * One side's drop zone on a pane: a frosted card with a dashed edge, a half
 * symbol and what it does. It slides in from its edge of the pane, springs
 * between its sizes and takes the accent while the tab is on it.
 */
function DropZone({ pane, side, stage, pointerX, progress }: {
  pane: Rect; side: SplitSide; stage: ZoneStage; pointerX: number; progress: Animated.Value;
}) {
  const { colors, reduceMotion } = useTheme();
  const rect = zoneRect(pane, side, stage, pointerX);
  const place = useSpringRect(rect, reduceMotion);
  const active = stage === 'active';
  const glow = useEased(active, reduceMotion);
  // Off the pane's edge before it slides in.
  const away = side === 'left' ? -(rect.x - pane.x + rect.width) : pane.x + pane.width - rect.x;
  const tone = active ? 'dropZoneActiveText' : 'dropZoneText';
  const fill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.panel } as const;
  return <Animated.View style={{ position: 'absolute', left: place.x, top: place.y, width: place.width, height: place.height }}>
    <Animated.View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', opacity: progress,
      transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [away, 0] }) }] }}>
      <View style={{ ...fill, backgroundColor: colors.dropZoneFill, borderWidth: geometry.dropZoneEdge, borderColor: colors.dropZoneBorder }} />
      <Animated.View style={{ ...fill, backgroundColor: colors.dropZoneActive, opacity: glow }} />
      <View style={{ position: 'absolute', top: geometry.dropZoneInset, left: geometry.dropZoneInset, right: geometry.dropZoneInset,
        bottom: geometry.dropZoneInset, borderRadius: radius.panel - geometry.dropZoneInset, borderStyle: 'dashed',
        borderWidth: active ? geometry.dropZoneDashActive : geometry.dropZoneDash, borderColor: colors[active ? 'dropZoneActiveText' : 'dropZoneDash'] }} />
      <Icon name={side === 'left' ? 'rectangle.lefthalf.filled' : 'rectangle.righthalf.filled'} tone={tone} size="large" />
      <Text weight="semibold" tone={tone} align="center" style={{ marginTop: space.md, paddingHorizontal: space.md }}>{zoneLabel[side]}</Text>
    </Animated.View>
  </Animated.View>;
}
