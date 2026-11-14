import React, { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions, useActiveTab, useBrowser, useSnapshot } from '../../state/window';
import { Box, Button, EmptyState, Text, geometry, radius, space, useTheme } from '../ui';
import { FindBar } from '../find/FindBar';
import { Page } from '../page/Page';
import { WebKitPage } from '../page/WebKitPage';
import { StartPage } from '../start/StartPage';

/** The active page, both halves of a split view, or the start page. A page in fullscreen is shown alone. */
export function PageArea() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const active = useActiveTab();
  const { colors } = useTheme();
  const frame = useRef<View>(null);
  const windowSize = useBrowser(s => s.windowSize);
  // Where pages show, in the window, for tabs dropped on the page.
  const measure = () => frame.current?.measureInWindow((x, y, width, height) => actions.setAnchor('page', { x, y, width, height }));
  useEffect(measure, [windowSize, snapshot.modal.sidebarHidden, snapshot.modal.tabLayout]);  // eslint-disable-line react-hooks/exhaustive-deps
  const split = !snapshot.fullscreen && snapshot.split && active && snapshot.split.tabs.includes(active.id) ? snapshot.split : null;
  if (!active) return <Box flex={1} center>
    <EmptyState icon="square.dashed" title="No tabs open" detail="Open a tab, or use the command menu."
      action={<Button label="New Tab" variant="primary" icon="plus" onPress={() => void actions.openNewTab()} />} />
  </Box>;
  return <View ref={frame} onLayout={measure} style={{ flex: 1 }}>
    {split ? <View style={{ flex: 1, flexDirection: split.layout === 'stacked' ? 'column' : 'row', gap: geometry.splitGap }}>
      {split.tabs.map((id, index) => {
        const tab = snapshot.tabs.find(t => t.id === id)!;
        const share = index === 0 ? split.ratio : 1 - split.ratio;
        const focused = id === active.id;
        return <View key={id} style={{ flex: Math.min(Math.max(share, 0.1), 0.9), borderRadius: radius.card, overflow: 'hidden',
          borderWidth: geometry.focusRing, borderColor: colors[focused ? 'splitFocus' : 'fillTransparent'] }}>
          <Pane tab={tab} hints={focused} />
          {!focused && <Pressable accessibilityRole="button" accessibilityLabel={`Focus ${tab.title || 'other side'}`}
            onPress={() => void actions.activateTab(id)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.splitDim }} />}
        </View>;
      })}
    </View> : <Pane tab={active} hints />}
    {snapshot.find?.visible && <FindBar key={active.id} find={snapshot.find} tabId={active.id} />}
  </View>;
}

/**
 * One page: the start page for a new tab, the tab's WebKit page for a site
 * that opens in WebKit, otherwise the tab's web page with link hints over it. A search from the start page leaves it at once: until
 * the new page has drawn something, a plain sheet in the start page's colour
 * covers it, so Enter answers immediately and no white page flashes.
 */
function Pane({ tab, hints }: { tab: Tab; hints: boolean }) {
  const snapshot = useSnapshot();
  const { colors } = useTheme();
  const loading = !isStartUrl(tab.url);
  const start = tab.start ?? !loading;
  if (tab.crashed) return <CrashedPage tab={tab} />;
  // Chromium's page behind it, and its link hints, aren't shown.
  if (tab.engine === 'webkit') return <WebKitPage key="webkit" tabId={tab.id} active={hints} />;
  const prefix = snapshot.modal.hintPrefix ?? '';
  return <View style={{ flex: 1 }}>
    {loading && <Page key="page" tabId={tab.id} />}
    {start && <View key="start" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: colors.startBackground }}>
      {!loading && <StartPage tab={tab} />}
    </View>}
    {hints && !start && !!snapshot.modal.hints?.length && <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      {snapshot.modal.hints.filter(h => h.label.startsWith(prefix)).map(h =>
        <View key={h.label} style={{ position: 'absolute', left: h.x, top: h.y, backgroundColor: colors.hintFill, borderRadius: radius.xs,
          paddingHorizontal: space.xs, borderWidth: geometry.hairline, borderColor: colors.hintBorder }}>
          <Text variant="label" tone="hintText" weight="bold">{h.label}</Text>
        </View>)}
    </View>}
  </View>;
}

/** A page whose renderer has gone: say so and offer to load it again. */
function CrashedPage({ tab }: { tab: Tab }) {
  const actions = useActions();
  return <Box flex={1} center fill="windowBackground">
    <EmptyState icon="exclamationmark.triangle" title="This page stopped working"
      detail={tab.title ? `${tab.title} closed unexpectedly. Reload to open it again.` : 'Reload to open it again.'}
      action={<Button label="Reload" variant="primary" icon="arrow.clockwise" onPress={() => void actions.reloadTab(tab.id)} />} />
  </Box>;
}
