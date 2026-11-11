import React, { useState } from 'react';
import { TextInput, View, type TextInputProps, type TextStyle } from 'react-native';
import { Icon, type SymbolName } from './Icon';
import { useTheme } from './theme';
import { font, geometry, opacity, radius, space } from './tokens';

export type FieldProps = Omit<TextInputProps, 'style'> & {
  icon?: SymbolName; trailing?: React.ReactNode; size?: 'regular' | 'large'; mono?: boolean;
  /** Multi-line editors grow to fill their container. */
  grow?: boolean; style?: TextStyle;
};

/** A text field. The frame, not the text, shows hover and focus. */
export const Field = React.forwardRef<TextInput, FieldProps>(function Field(
  { icon, trailing, size = 'regular', mono, grow, style, onFocus, onBlur, editable = true, ...rest }, ref) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const height = size === 'large' ? geometry.controlLarge + space.sm : geometry.control + space.xs;
  return <View style={{ flexDirection: 'row', alignItems: rest.multiline ? 'flex-start' : 'center', gap: space.sm,
    minHeight: height, paddingHorizontal: space.md, borderRadius: radius.field, flex: grow ? 1 : undefined,
    backgroundColor: colors[focused ? 'fillFieldFocus' : 'fillField'],
    borderWidth: geometry.hairline, borderColor: colors[focused ? 'borderFocus' : 'borderField'], opacity: editable ? 1 : opacity.dim }}>
    {icon && <Icon name={icon} tone="iconSecondary" size="small" />}
    <TextInput ref={ref} {...rest} editable={editable} placeholderTextColor={colors.textTertiary} selectionColor={colors.accent}
      onFocus={e => { setFocused(true); onFocus?.(e); }} onBlur={e => { setFocused(false); onBlur?.(e); }}
      style={[{ flex: 1, alignSelf: 'stretch', color: colors.textPrimary, fontFamily: mono ? font.mono : font.family,
        fontSize: size === 'large' ? font.size.callout : font.size.body, paddingVertical: space.sm }, style]} />
    {trailing}
  </View>;
});
