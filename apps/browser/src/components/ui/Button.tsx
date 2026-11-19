import React from 'react';
import { Animated, View, type PressableProps } from 'react-native';
import { Pressable } from './Pressable';
import { Icon, type SymbolName } from './Icon';
import { accessibilityPress, useInteraction } from './interaction';
import { useTooltip, type TooltipSpec } from './Tooltip';
import { Text } from './Text';
import { useTheme } from './theme';
import { pressScale, usePressScale } from './motion';
import { geometry, opacity, radius, space, type ColorRole } from './tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost';
type Look = { fill: ColorRole; hover: ColorRole; pressed: ColorRole; text: ColorRole; icon: ColorRole };
// Primary buttons are dark ink pills; secondary ones a soft wash of the same ink.
const looks: Record<ButtonVariant, Look> = {
  primary: { fill: 'buttonPrimary', hover: 'buttonPrimaryHover', pressed: 'buttonPrimaryPressed', text: 'textOnPrimary', icon: 'textOnPrimary' },
  secondary: { fill: 'fillControl', hover: 'fillControlHover', pressed: 'fillControlPressed', text: 'textPrimary', icon: 'iconPrimary' },
  ghost: { fill: 'fillTransparent', hover: 'fillHover', pressed: 'fillPressed', text: 'textPrimary', icon: 'iconPrimary' },
  danger: { fill: 'danger', hover: 'dangerHover', pressed: 'dangerHover', text: 'textOnAccent', icon: 'textOnAccent' },
  dangerGhost: { fill: 'fillTransparent', hover: 'dangerSoft', pressed: 'dangerSoft', text: 'textDanger', icon: 'textDanger' },
};

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string; variant?: ButtonVariant; icon?: SymbolName; trailingIcon?: SymbolName;
  size?: 'small' | 'regular' | 'large'; selected?: boolean; stretch?: boolean;
};

/** A labelled pill button. Use IconButton or RoundButton when only the icon shows. */
export function Button({ label, variant = 'secondary', icon, trailingIcon, size = 'regular', selected, stretch, disabled, ...rest }: ButtonProps) {
  const { colors, reduceMotion } = useTheme();
  const look = looks[variant];
  const { hovered, focused, handlers } = useInteraction();
  const [pressed, setPressed] = React.useState(false);
  const scale = usePressScale(pressed, pressScale.control, reduceMotion);
  const height = size === 'large' ? geometry.controlLarge : size === 'small' ? geometry.control - space.hair : geometry.button;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected }}
    disabled={disabled} {...handlers} {...rest} onAccessibilityTap={accessibilityPress(rest.onPress, disabled)}
    onPressIn={e => { setPressed(true); rest.onPressIn?.(e); }} onPressOut={e => { setPressed(false); rest.onPressOut?.(e); }}
    style={({ pressed: down }) => ({
      minHeight: height, paddingHorizontal: size === 'small' ? space.md : space.md + space.hair, borderRadius: radius.pill,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs + space.hair,
      alignSelf: stretch ? 'stretch' : 'flex-start',
      backgroundColor: colors[selected ? 'fillSelected' : down ? look.pressed : hovered ? look.hover : look.fill],
      borderWidth: geometry.focusRing, borderColor: focused ? colors.focusRing : colors.fillTransparent,
      opacity: disabled ? opacity.disabled : 1,
    })}>
    {/* Its contents dip a little under a press and spring back. */}
    <Animated.View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair, transform: [{ scale }] }}>
      {icon && <Icon name={icon} tone={look.icon} size="small" />}
      <Text variant={size === 'small' ? 'label' : 'body'} weight="medium" tone={look.text} lines={1}>{label}</Text>
      {trailingIcon && <Icon name={trailingIcon} tone={look.icon} size="small" />}
    </Animated.View>
  </Pressable>;
}

export type IconButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string; icon: SymbolName; variant?: 'ghost' | 'secondary' | 'primary'; selected?: boolean;
  size?: 'small' | 'regular' | 'compact'; tone?: ColorRole;
  /** The fill while selected; on the tinted shell this is a white wash. */
  selectedFill?: ColorRole;
  /** Reports the button's frame in the window, for anchoring a popover. */
  onFrame?: (frame: { x: number; y: number; width: number; height: number }) => void;
  /** Its tooltip: the label unless given, its shortcut as `keys`, `false` for none. */
  tip?: string | false;
  keys?: string[];
  tipDetail?: string;
};

/** A square icon button; its label is read by VoiceOver. */
export function IconButton({ label, icon, variant = 'ghost', selected, size = 'regular', tone, selectedFill = 'fillSelected', disabled,
  onFrame, tip, keys, tipDetail, ...rest }: IconButtonProps) {
  const { colors, reduceMotion } = useTheme();
  const look = looks[variant];
  const { hovered, focused, handlers } = useInteraction();
  const [pressed, setPressed] = React.useState(false);
  const scale = usePressScale(pressed, pressScale.icon, reduceMotion);
  const ref = React.useRef<View>(null);
  const spec: TooltipSpec | null = tip === false ? null : { text: tip ?? label, keys, detail: tipDetail };
  const tooltip = useTooltip(spec, ref);
  const side = size === 'small' ? geometry.control - space.sm : size === 'compact' ? geometry.controlCompact : geometry.control;
  const report = () => ref.current?.measureInWindow((x, y, width, height) => onFrame?.({ x, y, width, height }));
  // Buttons look the same with Glass as with Classic: no glass plate around them.
  return <Pressable ref={ref} onLayout={onFrame ? report : undefined} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled, selected }} disabled={disabled} {...handlers} {...rest}
    onAccessibilityTap={accessibilityPress(rest.onPress, disabled)}
    onHoverIn={e => { handlers.onHoverIn(); tooltip.enter(); rest.onHoverIn?.(e); }}
    onHoverOut={e => { handlers.onHoverOut(); tooltip.leave(); rest.onHoverOut?.(e); }}
    onPressIn={e => { setPressed(true); tooltip.leave(); if (onFrame) report(); rest.onPressIn?.(e); }}
    onPressOut={e => { setPressed(false); rest.onPressOut?.(e); }}
    style={({ pressed: down }) => ({
      width: side, height: side, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors[selected ? selectedFill : down ? look.pressed : hovered ? look.hover : look.fill],
      borderWidth: geometry.focusRing, borderColor: focused ? colors.focusRing : colors.fillTransparent,
      opacity: disabled ? opacity.disabled : 1,
    })}>
    {/* The glyph dips under a press while its plate holds still. */}
    <Animated.View style={{ transform: [{ scale }] }}>
      <Icon name={icon} tone={tone ?? (disabled ? 'iconDisabled' : look.icon)} size={size === 'small' ? 'small' : 'regular'} />
    </Animated.View>
  </Pressable>;
}

/**
 * The small round action button of popover rows: dark for the row's main
 * action (pause, cancel, close), soft for the rest.
 */
export function RoundButton({ label, icon, soft = false, disabled, onPress }: {
  label: string; icon: SymbolName; soft?: boolean; disabled?: boolean; onPress(): void;
}) {
  const { colors, reduceMotion } = useTheme();
  const { hovered, focused, handlers } = useInteraction();
  const [pressed, setPressed] = React.useState(false);
  const scale = usePressScale(pressed, pressScale.tile, reduceMotion);
  return <Animated.View style={{ transform: [{ scale }] }}><Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} {...handlers}
    onAccessibilityTap={accessibilityPress(onPress, disabled)} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={({ pressed }) => ({
      width: geometry.round, height: geometry.round, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors[soft ? (hovered ? 'fillControlHover' : 'roundSoft') : 'roundFill'],
      opacity: disabled ? opacity.disabled : pressed ? opacity.pressed : 1,
      borderWidth: focused ? geometry.hairline : 0, borderColor: colors.focusRing,
    })}>
    <Icon name={icon} tone={soft ? 'roundSoftGlyph' : 'roundGlyph'} size="tiny" weight="bold" />
  </Pressable></Animated.View>;
}
