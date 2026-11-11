import React from 'react';
import { Pressable, View } from 'react-native';
import { isStartUrl } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions, useActiveTab, useSnapshot } from '../../state/window';
import { Box, Button, EmptyState, Text, geometry, radius, space, useTheme } from '../ui';
import { FindBar } from '../find/FindBar';
import { Page } from '../page/Page';
import { StartPage } from '../start/StartPage';

/** The active page, both halves of a split view, or the start page. */
export function PageArea() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const active = useActiveTab();
  const { colors } = useTheme();
  const split = snapshot.split && active && snapshot.split.tabs.includes(active.id) ? snapshot.split : null;
  if (!active) return <Box flex={1} center>
    <EmptyState icon="sparkles" title="No tabs open" detail="Open a tab, or use the command menu."
      action={<Button label="New Tab" variant="primary" icon="plus" onPress={() => void actions.newTab()} />} />
  </Box>;
  return <View style={{ flex: 1 }}>
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

/** One page: the start page for a new tab, otherwise the tab's web page with link hints over it. */
function Pane({ tab, hints }: { tab: Tab; hints: boolean }) {
  const snapshot = useSnapshot();
  const { colors } = useTheme();
  if (isStartUrl(tab.url)) return <StartPage tab={tab} />;
  const prefix = snapshot.modal.hintPrefix ?? '';
  return <View style={{ flex: 1 }}>
    <Page tabId={tab.id} />
    {hints && !!snapshot.modal.hints?.length && <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      {snapshot.modal.hints.filter(h => h.label.startsWith(prefix)).map(h =>
        <View key={h.label} style={{ position: 'absolute', left: h.x, top: h.y, backgroundColor: colors.hintFill, borderRadius: radius.xs,
          paddingHorizontal: space.xs, borderWidth: geometry.hairline, borderColor: colors.hintBorder }}>
          <Text variant="label" tone="hintText" weight="bold">{h.label}</Text>
        </View>)}
    </View>}
  </View>;
}
