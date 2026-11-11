import React from 'react';
import { Text as NativeText, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from './theme';
import { font, type ColorRole } from './tokens';

export type TextVariant = 'micro' | 'caption' | 'label' | 'body' | 'bodyStrong' | 'callout' | 'title' | 'headline' | 'display' | 'section' | 'mono';
const variants: Record<TextVariant, TextStyle> = {
  micro: { fontSize: font.size.micro, lineHeight: font.line.micro, fontWeight: font.weight.medium },
  caption: { fontSize: font.size.caption, lineHeight: font.line.caption },
  label: { fontSize: font.size.label, lineHeight: font.line.label, fontWeight: font.weight.medium },
  body: { fontSize: font.size.body, lineHeight: font.line.body },
  bodyStrong: { fontSize: font.size.body, lineHeight: font.line.body, fontWeight: font.weight.semibold },
  callout: { fontSize: font.size.callout, lineHeight: font.line.callout },
  title: { fontSize: font.size.title, lineHeight: font.line.title, fontWeight: font.weight.semibold, letterSpacing: font.tracking.snug },
  headline: { fontSize: font.size.headline, lineHeight: font.line.headline, fontWeight: font.weight.semibold, letterSpacing: font.tracking.snug },
  display: { fontSize: font.size.display, lineHeight: font.line.display, fontWeight: font.weight.semibold, letterSpacing: font.tracking.tight },
  section: { fontSize: font.size.micro, lineHeight: font.line.micro, fontWeight: font.weight.semibold, letterSpacing: font.tracking.wide },
  mono: { fontSize: font.size.label, lineHeight: font.line.label, fontFamily: font.mono },
};
const defaultTone: Partial<Record<TextVariant, ColorRole>> = { section: 'sectionLabel', caption: 'textSecondary', micro: 'textSecondary' };

export type TextOwnProps = TextProps & {
  variant?: TextVariant; tone?: ColorRole; lines?: number; align?: TextStyle['textAlign']; weight?: keyof typeof font.weight;
  flex?: number; style?: TextStyle;
};

/** Text in one of the shell's type styles and colour roles. */
export function Text({ variant = 'body', tone, lines, align, weight, flex, style, children, ...rest }: TextOwnProps) {
  const { colors } = useTheme();
  const color = colors[tone ?? defaultTone[variant] ?? 'textPrimary'];
  return <NativeText {...rest} numberOfLines={lines}
    style={[{ fontFamily: font.family, color, textAlign: align, flex }, variants[variant], weight ? { fontWeight: font.weight[weight] } : null, style]}>
    {variant === 'section' && typeof children === 'string' ? children.toUpperCase() : children}
  </NativeText>;
}
