import React, { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View, StyleSheet, type TextInputProps, type TextStyle } from 'react-native';
import { Symbol, type SymbolName } from '@merlin/shell';
import { useTheme } from './Theme';
import { geometry, radius, space, typography } from './tokens';

export function Label({ children, muted = false, size = 'body', style }: React.PropsWithChildren<{
  muted?: boolean; size?: keyof typeof typography; style?: TextStyle;
}>) {
  const t = useTheme();
  return <Text style={[{ color: muted ? t.muted : t.text, fontSize: typography[size], fontFamily: 'System' }, style]}>{children}</Text>;
}
export function Button({ title, onPress, disabled = false, emphasis = 'normal', compact = false, icon, iconOnly = false, quiet = false }: {
  title: string; onPress(): void; disabled?: boolean; emphasis?: 'normal' | 'primary' | 'danger'; compact?: boolean; icon?: SymbolName; iconOnly?: boolean; quiet?: boolean;
}) {
  const t = useTheme();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
    style={({ pressed }) => ({ minHeight: geometry.control, minWidth: geometry.control,
      paddingHorizontal: compact ? space.sm : space.md, alignItems: 'center', justifyContent: 'center',
      flexDirection: 'row', gap: space.sm, borderRadius: radius.control, borderWidth: 2, borderColor: focus ? t.accent : 'transparent',
      opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      backgroundColor: emphasis === 'primary' ? t.accent : hover ? t.hover : quiet ? 'transparent' : t.inset })}>
    {icon && <Symbol name={icon} color={emphasis === 'primary' ? t.onAccent : emphasis === 'danger' ? t.danger : t.text} />}
    {!iconOnly && <Text style={{ fontFamily: 'System', fontSize: typography.body, fontWeight: '500',
      color: emphasis === 'primary' ? t.onAccent : emphasis === 'danger' ? t.danger : t.text }}>{title}</Text>}
  </Pressable>;
}
export const Field = React.forwardRef<TextInput, TextInputProps>(function Field(props, ref) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  return <TextInput {...props} ref={ref} placeholderTextColor={t.muted} selectionColor={t.accent}
    onFocus={e => { setFocus(true); props.onFocus?.(e); }} onBlur={e => { setFocus(false); props.onBlur?.(e); }}
    style={[{ minHeight: geometry.control, paddingHorizontal: space.md, paddingVertical: space.sm,
      borderWidth: 1, borderRadius: radius.control, borderColor: focus ? t.accent : t.border,
      color: t.text, backgroundColor: t.inset, fontFamily: 'System', fontSize: typography.body }, props.style]} />;
});
export function Row({ title, detail, selected, onPress, trailing }: {
  title: string; detail?: string; selected?: boolean; onPress(): void; trailing?: React.ReactNode;
}) {
  const t = useTheme();
  const [hover, setHover] = useState(false);
  return <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: radius.row,
    backgroundColor: selected ? t.selected : hover ? t.hover : 'transparent' }}>
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      style={({ pressed }) => ({ flex: 1, minHeight: geometry.row, padding: space.sm, opacity: pressed ? 0.65 : 1 })}>
      <Text numberOfLines={1} style={{ color: t.text, fontSize: typography.body }}>{title}</Text>
      {!!detail && <Text numberOfLines={1} style={{ color: t.muted, fontSize: typography.caption, marginTop: space.xs }}>{detail}</Text>}
    </Pressable>{trailing}
  </View>;
}
export function Dialog({ title, subtitle, children, onClose, actions, width = geometry.dialog }: React.PropsWithChildren<{
  title: string; subtitle?: string; onClose?: () => void; actions?: React.ReactNode; width?: number;
}>) {
  const t = useTheme();
  return <Modal visible transparent animationType="none" onRequestClose={onClose}>
    <View style={[StyleSheet.absoluteFillObject, { backgroundColor: t.scrim, justifyContent: 'center', alignItems: 'center' }]}>
      <View accessibilityViewIsModal accessibilityLabel={title}
        onKeyDown={event => { if (event.nativeEvent.key === 'Escape' && onClose) { event.stopPropagation(); onClose(); } }}
        style={{ width, maxWidth: '90%', maxHeight: '85%',
        backgroundColor: t.raised, borderRadius: radius.panel, borderColor: t.border, borderWidth: 1,
        padding: space.xl, gap: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1, gap: space.xs }}><Label size="title">{title}</Label>{subtitle && <Label muted>{subtitle}</Label>}</View>
          {onClose && <Button title="Close" onPress={onClose} compact />}
        </View>
        {children}
        {actions && <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{actions}</View>}
      </View>
    </View>
  </Modal>;
}
