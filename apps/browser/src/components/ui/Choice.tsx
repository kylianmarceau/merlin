import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import { showMenu } from '../../platform/shell';
import { Icon } from './Icon';
import { useInteraction } from './interaction';
import { sliderAccessibility, steppedValue } from './slider';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, opacity, radius, space } from './tokens';

/**
 * A pop-up button: the chosen value with ⌃⌄, opening a native menu of the
 * choices with the current one ticked, as Ardia's settings rows have.
 */
export function PopUp<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: readonly { value: T; title: string }[]; onChange(value: T): void; disabled?: boolean;
}) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = useInteraction();
  const current = options.find(o => o.value === value)?.title ?? '';
  const open = async () => {
    const chosen = await showMenu(options.map(o => ({ id: o.value, title: o.title, checked: o.value === value })));
    if (chosen && chosen !== value) onChange(chosen as T);
  };
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${current}`} accessibilityState={{ disabled }}
    disabled={disabled} onPress={() => void open()} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: geometry.popUpMin, minHeight: geometry.control - space.xs,
      paddingLeft: space.md, paddingRight: space.sm, borderRadius: radius.sm, opacity: disabled ? opacity.disabled : 1,
      backgroundColor: colors[hovered ? 'fillControlHover' : 'fillControl'],
      borderWidth: geometry.hairline, borderColor: colors[focused ? 'focusRing' : 'borderSubtle'] }}>
    <Text variant="label" weight="medium" flex={1} lines={1}>{current}</Text>
    <Icon name="chevron.up.chevron.down" tone="iconSecondary" size="chevron" weight="semibold" />
  </Pressable>;
}

/**
 * A 0 to 1 slider. It reports while dragged, so what it changes can be seen
 * changing; `label` and `valueText` are read by VoiceOver, and the arrow
 * keys move it by a tenth. A disabled one takes no keys, drags or VoiceOver
 * steps, and VoiceOver reads it as dimmed.
 */
export function Slider({ label, value, valueText, onChange, disabled = false }: {
  label: string; value: number; valueText: string; onChange(value: number): void; disabled?: boolean;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState<number>(geometry.slider);
  const start = useRef(value);
  const latest = useRef({ value, width, onChange });
  latest.current = { value, width, onChange };
  const thumb = geometry.sliderThumb;
  const travel = Math.max(1, width - thumb);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: e => {
      // A press on the track jumps there; a drag then moves from it.
      const next = clamp((e.nativeEvent.locationX - thumb / 2) / Math.max(1, latest.current.width - thumb));
      start.current = next;
      latest.current.onChange(next);
    },
    onPanResponderMove: (_, g) => latest.current.onChange(clamp(start.current + g.dx / Math.max(1, latest.current.width - thumb))),
    onPanResponderTerminationRequest: () => false,
  }), [thumb]);
  const step = (action: string) => {
    const next = steppedValue(value, action, disabled);
    if (next !== null) onChange(next);
  };
  return <View accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: valueText }}
    {...sliderAccessibility(disabled)} onAccessibilityAction={e => step(e.nativeEvent.actionName)}
    focusable={!disabled} keyDownEvents={disabled ? [] : [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }]}
    onKeyDown={e => step(e.nativeEvent.key)}
    {...(disabled ? {} : pan.panHandlers)} onLayout={e => setWidth(e.nativeEvent.layout.width)}
    style={{ width: geometry.slider, height: thumb, justifyContent: 'center', opacity: disabled ? opacity.disabled : 1 }}>
    <View style={{ height: geometry.sliderTrack, borderRadius: radius.pill, backgroundColor: colors.fillTrack }}>
      <View style={{ width: thumb / 2 + travel * value, height: geometry.sliderTrack, borderRadius: radius.pill, backgroundColor: colors.accent }} />
    </View>
    <View pointerEvents="none" style={{ position: 'absolute', left: travel * value, width: thumb, height: thumb, borderRadius: radius.pill,
      backgroundColor: colors.fillThumb, borderWidth: geometry.hairline, borderColor: colors.borderStrong }} />
  </View>;
}

/**
 * A choice shown as a picture with its name under it (a window style, an
 * address bar placement, an app icon). The chosen one has an accent ring.
 */
export function PictureChoice({ title, selected, onPress, children, size = 'card' }: React.PropsWithChildren<{
  title: string; selected: boolean; onPress(): void; size?: 'card' | 'icon';
}>) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  const icon = size === 'icon';
  return <Pressable accessibilityRole="radio" accessibilityLabel={title} accessibilityState={{ selected }} onPress={onPress} {...handlers}
    style={{ alignItems: 'center', gap: space.sm, width: icon ? geometry.appIcon + space.lg : geometry.pictureChoice }}>
    <View style={{ width: icon ? geometry.appIcon + space.sm : geometry.pictureChoice,
      height: icon ? geometry.appIcon + space.sm : geometry.pictureChoiceHeight, borderRadius: icon ? radius.card + space.hair : radius.card,
      overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
      borderWidth: selected ? geometry.focusRing : geometry.hairline,
      borderColor: colors[selected ? 'accent' : hovered ? 'borderStrong' : 'borderDefault'] }}>{children}</View>
    <Text variant="label" tone={selected ? 'textPrimary' : 'textSecondary'} align="center" lines={1}>{title}</Text>
  </Pressable>;
}
