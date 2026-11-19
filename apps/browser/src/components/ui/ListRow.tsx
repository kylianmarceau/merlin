import React, { useState } from 'react';
import { Animated, View } from 'react-native';
import { Pressable } from './Pressable';
import { ContextMenuArea } from '../../platform/shell';
import { useInteraction } from './interaction';
import { useEased } from './motion';
import { rowAccessibilityActions, rowActionForKey, rowActionNamed, rowKeyDownEvents, type RowAction } from './rowActions';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, radius, space, type ColorRole } from './tokens';

export type ListRowProps = {
  title: string; detail?: string; leading?: React.ReactNode; trailing?: React.ReactNode;
  /**
   * Shown only while the row is hovered, selected or has keyboard focus (on
   * the row or one of these controls), such as a close button. It stays in
   * the key loop while hidden, so Tab reaches it and it then shows.
   */
  hoverTrailing?: React.ReactNode;
  /**
   * The row's secondary actions, for VoiceOver's Actions menu and as keys
   * while the row has focus. When given, they stand in for `hoverTrailing`
   * with VoiceOver, which then skips those buttons.
   */
  actions?: readonly RowAction[];
  selected?: boolean; tall?: boolean; onPress?: () => void; onContextMenu?: () => void; accessibilityLabel?: string;
  selectedFill?: ColorRole; tone?: ColorRole;
};

/** One row in a list: an icon, a title with optional detail, and trailing controls. */
export function ListRow({ title, detail, leading, trailing, hoverTrailing, actions = [], selected, tall, onPress, onContextMenu,
  accessibilityLabel, selectedFill = 'fillSelected', tone = 'textPrimary' }: ListRowProps) {
  const { colors, reduceMotion } = useTheme();
  const { hovered, handlers } = useInteraction();
  // Focus and blur bubble on macOS, so this sees the row's own button and
  // the trailing controls alike.
  const [focusWithin, setFocusWithin] = useState(false);
  const highlight = useEased(hovered && !selected, reduceMotion);
  const showTrailing = hovered || !!selected || focusWithin;
  const row = <View onFocus={() => setFocusWithin(true)} onBlur={() => setFocusWithin(false)}
    style={{ flexDirection: 'row', alignItems: 'center', borderRadius: radius.row,
      backgroundColor: selected ? colors[selectedFill] : colors.fillTransparent }}>
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      borderRadius: radius.row, backgroundColor: colors.fillHover, opacity: highlight }} />
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ selected: !!selected }}
      onPress={onPress} disabled={!onPress} {...handlers}
      {...(actions.length ? {
        accessibilityActions: rowAccessibilityActions(actions),
        onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => rowActionNamed(actions, e.nativeEvent.actionName)?.run(),
        keyDownEvents: rowKeyDownEvents(actions),
        onKeyDown: (e: { nativeEvent: { key: string; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean } }) =>
          rowActionForKey(actions, e.nativeEvent)?.run(),
      } : {})}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: tall ? geometry.rowTall : geometry.row,
        paddingHorizontal: space.sm, paddingVertical: tall ? space.xs : 0 }}>
      {leading}
      <View style={{ flex: 1 }}>
        <Text lines={1} tone={tone} weight={selected ? 'medium' : undefined}>{title}</Text>
        {!!detail && <Text variant="caption" lines={1}>{detail}</Text>}
      </View>
    </Pressable>
    {hoverTrailing && <View accessibilityElementsHidden={actions.length > 0} pointerEvents={showTrailing ? 'auto' : 'none'}
      style={{ opacity: showTrailing ? 1 : 0 }}>{hoverTrailing}</View>}
    {trailing}
  </View>;
  return onContextMenu ? <ContextMenuArea onContextMenu={onContextMenu}>{row}</ContextMenuArea> : row;
}
