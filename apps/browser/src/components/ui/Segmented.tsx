import React, { useState } from 'react';
import { Animated, View, type LayoutRectangle } from 'react-native';
import { useSpringRect } from './motion';
import { Icon, type SymbolName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, opacity, radius, space } from './tokens';

/**
 * One choice from a short list, shown inline. The chosen segment's thumb
 * slides to a new choice on the snappy spring, as Ardia's and AppKit's do,
 * rather than jumping; with reduced motion it moves at once.
 */
export function Segmented<T extends string | number>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: readonly { value: T; label: string; icon?: SymbolName }[]; onChange(value: T): void; disabled?: boolean;
}) {
  const { colors, reduceMotion } = useTheme();
  const [frames, setFrames] = useState<Record<string, LayoutRectangle>>({});
  const chosen = frames[String(value)];
  return <View accessibilityRole="radiogroup" accessibilityLabel={label}
    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.hair, padding: space.hair, borderRadius: radius.pill,
      backgroundColor: colors.fillControl, opacity: disabled ? opacity.disabled : 1, maxWidth: '100%', alignSelf: 'center' }}>
    {chosen && <Thumb frame={chosen} reduce={reduceMotion} />}
    {options.map(option => {
      const selected = option.value === value;
      return <Pressable key={String(option.value)} accessibilityRole="radio" accessibilityState={{ selected, disabled }}
        accessibilityLabel={option.label} disabled={disabled} onPress={() => onChange(option.value)}
        onLayout={e => { const f = e.nativeEvent.layout; setFrames(old => ({ ...old, [String(option.value)]: f })); }}
        style={{ paddingHorizontal: space.md, minHeight: geometry.control - space.xs, flexDirection: 'row', alignItems: 'center', gap: space.xs, justifyContent: 'center', borderRadius: radius.pill,
          // Until it has been measured, the chosen segment draws its own fill.
          backgroundColor: colors[selected && !chosen ? 'fillSelectedStrong' : 'fillTransparent'] }}>
        {option.icon && <Icon name={option.icon} tone="textPrimary" size="small" weight="regular" />}
        <Text weight={selected ? 'semibold' : 'medium'}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

function Thumb({ frame, reduce }: { frame: LayoutRectangle; reduce: boolean }) {
  const { colors } = useTheme();
  const rect = useSpringRect(frame, reduce);
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height,
    borderRadius: radius.pill, backgroundColor: colors.fillSelectedStrong }} />;
}
