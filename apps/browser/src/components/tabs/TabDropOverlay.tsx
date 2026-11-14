import React from 'react';
import { Animated, View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import type { Rect, TabDropZone } from '../../state/types';
import { useBrowser, useSnapshot } from '../../state/window';
import { Icon, Panel, Text, geometry, opacity, radius, space, useLatest, usePresence, useSlide, useTheme, type SymbolName } from '../ui';
import { Favicon } from '../favicon/Favicon';

const zoneLabel: Record<TabDropZone, { text: string; icon: SymbolName }> = {
  left: { text: 'Split View', icon: 'rectangle.split.2x1' },
  right: { text: 'Split View', icon: 'rectangle.split.2x1' },
  window: { text: 'New Window', icon: 'arrow.up.forward.app' },
};

/**
 * A tab dragged out of the tabs: the tab follows the pointer as a small card,
 * and the part of the page it would go to lights up. The left or right half
 * shows it beside the current tab; the whole page (or anywhere outside the
 * window) opens it in a window of its own.
 */
export function TabDropOverlay() {
  const drag = useBrowser(s => s.tabDrag);
  const page = useBrowser(s => s.anchors.page);
  const snapshot = useSnapshot();
  const { reduceMotion } = useTheme();
  const shown = useLatest(drag?.out ? drag : null);
  const presence = usePresence(!!drag?.out, 'fade', reduceMotion);
  if (!presence.mounted || !shown) return null;
  const tab = snapshot.tabs.find(t => t.id === shown.tabId);
  const insideWindow = shown.x >= 0 && shown.y >= 0;
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: presence.progress }}>
    {page && <Zone page={page} zone={shown.zone} />}
    {tab && insideWindow && <View style={{ position: 'absolute', left: shown.x + space.md, top: shown.y + space.md }}>
      <Panel elevation="menu" radius="control" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm,
        maxWidth: geometry.stripTab + geometry.stripTabIcon, paddingHorizontal: space.md, height: geometry.control + space.xs }}>
        <Favicon tab={tab} />
        <Text lines={1} weight="medium" style={{ flexShrink: 1 }}>{isStartUrl(tab.url) ? 'New Tab' : tab.title || tab.url || 'New Tab'}</Text>
      </Panel>
    </View>}
  </Animated.View>;
}

/** The lit part of the page; it slides between the halves as the pointer crosses the middle. */
function Zone({ page, zone }: { page: Rect; zone: TabDropZone | null }) {
  const { colors, reduceMotion } = useTheme();
  const inset = space.sm;
  const half = (page.width - geometry.splitGap) / 2;
  const target = zone === 'left' ? { x: page.x + inset, width: half - inset * 2 }
    : zone === 'right' ? { x: page.x + half + geometry.splitGap + inset, width: half - inset * 2 }
      : { x: page.x + inset, width: page.width - inset * 2 };
  const { x, width } = useSlide(target, reduceMotion);
  const lit = usePresence(!!zone, 'fade', reduceMotion);
  const label = useLatest(zone ? zoneLabel[zone] : null);
  if (!lit.mounted || !label) return null;
  return <Animated.View style={{ position: 'absolute', left: x, width, top: page.y + inset, height: page.height - inset * 2,
    opacity: lit.progress, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.card,
      backgroundColor: colors.accentSoft, opacity: opacity.dim }} />
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.card,
      borderWidth: geometry.focusRing, borderColor: colors.splitFocus }} />
    <Panel elevation="menu" radius="control" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm,
      paddingHorizontal: space.md, height: geometry.control + space.xs }}>
      <Icon name={label.icon} tone="accentSoftText" size="small" />
      <Text weight="semibold" tone="accentSoftText">{label.text}</Text>
    </Panel>
  </Animated.View>;
}
