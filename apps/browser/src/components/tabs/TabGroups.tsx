import React from 'react';
import { Pressable, View } from 'react-native';
import type { Tab, TabGroup } from '../../state/types';
import { useActions } from '../../state/window';
import { ContextMenu, Icon, Text, geometry, groupColorRoles, radius, space, useInteraction, useTheme } from '../ui';

/** A run of tabs: one group's (in strip order), or tabs in no group. */
export type TabBlock = { group: TabGroup | null; tabs: Tab[] };

/** Splits tabs into runs by group, as Chromium keeps a group's tabs together. */
export function tabBlocks(tabs: Tab[], groups: TabGroup[] | undefined): TabBlock[] {
  const byId = new Map((groups ?? []).map(g => [g.id, g]));
  const blocks: TabBlock[] = [];
  for (const tab of tabs) {
    const group = (tab.group && byId.get(tab.group)) || null;
    const last = blocks[blocks.length - 1];
    if (last && last.group?.id === group?.id) last.tabs.push(tab);
    else blocks.push({ group, tabs: [tab] });
  }
  return blocks;
}

/** A group's name as the shell shows it. */
export const groupTitle = (group: TabGroup) => group.title || 'Unnamed Group';

/**
 * A tab group in the sidebar: its header (colour, name and a chevron;
 * pressing it collapses the group, right-click opens its menu), then its
 * tabs beside a rail in the group's colour.
 */
export function SidebarGroup({ group, count, active, children }: {
  group: TabGroup; count: number; active: boolean; children: React.ReactNode;
}) {
  const actions = useActions();
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  const name = groupTitle(group);
  // A collapsed group never hides the active tab; Chromium opens it again.
  const open = !group.collapsed || active;
  return <View style={{ gap: geometry.hairline }}>
    <ContextMenu onOpen={() => void actions.groupMenu(group.id)}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${name}, ${count} ${count === 1 ? 'tab' : 'tabs'}`} onPress={() => void actions.toggleGroup(group.id)}
        {...handlers}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: geometry.row,
          paddingLeft: space.sm + space.hair + space.xs, paddingRight: space.sm + space.hair, borderRadius: radius.row,
          backgroundColor: colors[hovered ? 'tabHover' : 'fillTransparent'] }}>
        <GroupDot group={group} />
        <Text variant="label" weight="semibold" lines={1} flex={1} tone={group.title ? 'textSecondary' : 'textTertiary'}>{name}</Text>
        {!open && <Text variant="caption" tone="textTertiary">{String(count)}</Text>}
        <Icon name={open ? 'chevron.down' : 'chevron.right'} tone="iconSecondary" size="chevron" weight="semibold" />
      </Pressable>
    </ContextMenu>
    {open && <View style={{ gap: geometry.hairline, paddingLeft: space.sm }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: space.xs, top: space.xs, bottom: space.xs,
        width: geometry.groupLine, borderRadius: radius.pill, backgroundColor: colors[groupColorRoles[group.color]] }} />
      {children}
    </View>}
  </View>;
}

/** The group's colour as a small round swatch. */
export function GroupDot({ group }: { group: TabGroup }) {
  const { colors } = useTheme();
  return <View style={{ width: geometry.dot, height: geometry.dot, borderRadius: radius.pill,
    backgroundColor: colors[groupColorRoles[group.color]] }} />;
}

/** A group's label across the top: its colour and name; press to collapse, right-click for its menu. */
export function StripGroupChip({ group, x, width, top, height }: { group: TabGroup; x: number; width: number; top: number; height: number }) {
  const actions = useActions();
  const { colors } = useTheme();
  const { hovered, focused, handlers } = useInteraction();
  const name = groupTitle(group);
  return <View style={{ position: 'absolute', left: x, width, top, height, justifyContent: 'center' }}>
    <ContextMenu onOpen={() => void actions.groupMenu(group.id)}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${name} group`} accessibilityState={{ expanded: !group.collapsed }}
        focusable onPress={() => void actions.toggleGroup(group.id)} {...handlers}
        style={{ height: geometry.control, borderRadius: radius.control, flexDirection: 'row', alignItems: 'center',
          justifyContent: 'center', gap: space.xs + space.hair, paddingHorizontal: group.title ? space.sm : 0,
          backgroundColor: colors[hovered ? 'tabHoverInset' : 'fillTransparent'],
          borderWidth: geometry.focusRing, borderColor: colors[focused ? 'focusRing' : 'fillTransparent'] }}>
        <GroupDot group={group} />
        {!!group.title && <Text variant="label" weight="semibold" lines={1} tone="tabText">{group.title}</Text>}
      </Pressable>
    </ContextMenu>
  </View>;
}

/** The width a group's chip takes across the top. */
export function chipWidth(group: TabGroup) {
  if (!group.title) return geometry.groupChip;
  return Math.min(geometry.groupChipMax, geometry.groupChip + space.sm + group.title.length * geometry.groupChipChar);
}
