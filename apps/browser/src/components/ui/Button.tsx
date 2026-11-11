import React from 'react';
import { Pressable, View, type PressableProps } from 'react-native';
import { Icon, type SymbolName } from './Icon';
import { useInteraction } from './interaction';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, opacity, radius, space, type ColorRole } from './tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost';
type Look = { fill: ColorRole; hover: ColorRole; pressed: ColorRole; text: ColorRole; icon: ColorRole };
const looks: Record<ButtonVariant, Look> = {
  primary: { fill: 'accent', hover: 'accentHover', pressed: 'accentPressed', text: 'textOnAccent', icon: 'textOnAccent' },
  secondary: { fill: 'fillControl', hover: 'fillControlHover', pressed: 'fillControlPressed', text: 'textPrimary', icon: 'iconPrimary' },
  ghost: { fill: 'fillTransparent', hover: 'fillHover', pressed: 'fillPressed', text: 'textPrimary', icon: 'iconSecondary' },
  danger: { fill: 'danger', hover: 'dangerHover', pressed: 'dangerHover', text: 'textOnAccent', icon: 'textOnAccent' },
  dangerGhost: { fill: 'fillTransparent', hover: 'dangerSoft', pressed: 'dangerSoft', text: 'textDanger', icon: 'textDanger' },
};

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string; variant?: ButtonVariant; icon?: SymbolName; trailingIcon?: SymbolName;
  size?: 'small' | 'regular' | 'large'; selected?: boolean; stretch?: boolean;
};

/** A labelled button. Use IconButton when only the icon shows. */
export function Button({ label, variant = 'secondary', icon, trailingIcon, size = 'regular', selected, stretch, disabled, ...rest }: ButtonProps) {
  const { colors } = useTheme();
  const look = looks[variant];
  const { hovered, focused, handlers } = useInteraction();
  const height = size === 'large' ? geometry.controlLarge : geometry.control;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected }}
    disabled={disabled} {...handlers} {...rest}
    style={({ pressed }) => ({
      minHeight: height, paddingHorizontal: size === 'small' ? space.sm : space.md, borderRadius: radius.control,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs + space.hair,
      alignSelf: stretch ? 'stretch' : 'flex-start',
      backgroundColor: colors[selected ? 'fillSelected' : pressed ? look.pressed : hovered ? look.hover : look.fill],
      borderWidth: geometry.focusRing, borderColor: focused ? colors.focusRing : colors.fillTransparent,
      opacity: disabled ? opacity.disabled : 1,
    })}>
    {icon && <Icon name={icon} tone={look.icon} size="small" />}
    <Text variant={size === 'small' ? 'label' : 'body'} weight="medium" tone={look.text} lines={1}>{label}</Text>
    {trailingIcon && <Icon name={trailingIcon} tone={look.icon} size="small" />}
  </Pressable>;
}

export type IconButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string; icon: SymbolName; variant?: 'ghost' | 'secondary' | 'primary'; selected?: boolean;
  size?: 'small' | 'regular'; tone?: ColorRole;
  /** Reports the button's frame in the window, for anchoring a popover. */
  onFrame?: (frame: { x: number; y: number; width: number; height: number }) => void;
};

/** A square icon button; its label is read by VoiceOver. */
export function IconButton({ label, icon, variant = 'ghost', selected, size = 'regular', tone, disabled, onFrame, ...rest }: IconButtonProps) {
  const { colors } = useTheme();
  const look = looks[variant];
  const { hovered, focused, handlers } = useInteraction();
  const ref = React.useRef<View>(null);
  const side = size === 'small' ? geometry.control - space.sm : geometry.control;
  const report = () => ref.current?.measureInWindow((x, y, width, height) => onFrame?.({ x, y, width, height }));
  return <Pressable ref={ref} onLayout={onFrame ? report : undefined} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled, selected }} disabled={disabled} {...handlers} {...rest}
    onPressIn={e => { if (onFrame) report(); rest.onPressIn?.(e); }}
    style={({ pressed }) => ({
      width: side, height: side, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors[selected ? 'fillSelected' : pressed ? look.pressed : hovered ? look.hover : look.fill],
      borderWidth: geometry.focusRing, borderColor: focused ? colors.focusRing : colors.fillTransparent,
      opacity: disabled ? opacity.disabled : 1,
    })}>
    <Icon name={icon} tone={tone ?? (disabled ? 'iconDisabled' : look.icon)} size={size === 'small' ? 'small' : 'regular'} />
  </Pressable>;
}
