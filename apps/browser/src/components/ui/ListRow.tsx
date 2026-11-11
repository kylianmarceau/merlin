import React from 'react';
import { Animated, Pressable, View } from 'react-native';
import { ContextMenuArea } from '../../platform/shell';
import { useInteraction } from './interaction';
import { useEased } from './motion';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, radius, space, type ColorRole } from './tokens';

export type ListRowProps = {
  title: string; detail?: string; leading?: React.ReactNode; trailing?: React.ReactNode;
  /** Shown only while the row is hovered or selected, such as a close button. */
  hoverTrailing?: React.ReactNode;
  selected?: boolean; tall?: boolean; onPress?: () => void; onContextMenu?: () => void; accessibilityLabel?: string;
  selectedFill?: ColorRole; tone?: ColorRole;
};

/** One row in a list: an icon, a title with optional detail, and trailing controls. */
export function ListRow({ title, detail, leading, trailing, hoverTrailing, selected, tall, onPress, onContextMenu,
  accessibilityLabel, selectedFill = 'fillSelected', tone = 'textPrimary' }: ListRowProps) {
  const { colors, reduceMotion } = useTheme();
  const { hovered, handlers } = useInteraction();
  const highlight = useEased(hovered && !selected, reduceMotion);
  const row = <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: radius.row,
    backgroundColor: selected ? colors[selectedFill] : colors.fillTransparent }}>
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      borderRadius: radius.row, backgroundColor: colors.fillHover, opacity: highlight }} />
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ selected: !!selected }}
      onPress={onPress} disabled={!onPress} {...handlers}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: tall ? geometry.rowTall : geometry.row,
        paddingHorizontal: space.sm, paddingVertical: tall ? space.xs : 0 }}>
      {leading}
      <View style={{ flex: 1 }}>
        <Text lines={1} tone={tone} weight={selected ? 'medium' : undefined}>{title}</Text>
        {!!detail && <Text variant="caption" lines={1}>{detail}</Text>}
      </View>
    </Pressable>
    {(hovered || selected) && hoverTrailing}
    {trailing}
  </View>;
  return onContextMenu ? <ContextMenuArea onContextMenu={onContextMenu}>{row}</ContextMenuArea> : row;
}
