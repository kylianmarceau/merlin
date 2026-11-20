import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { duration, useEased, useHeld } from './motion';
import { useSheetScroll } from './Sheet';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, radius, space } from './tokens';

/** The title of the row a search led to: it scrolls into view and glows for a moment. */
export const FormHighlight = createContext<string | null>(null);

/** A titled group of settings drawn as one rounded card. */
export function FormGroup({ title, detail, children }: React.PropsWithChildren<{ title?: string; detail?: string }>) {
  const { colors } = useTheme();
  const lit = useLit(title ?? '');
  return <View style={{ gap: space.sm, marginBottom: space.xl }}>
    {(title || detail) && <View ref={lit.ref} style={{ gap: space.hair, paddingHorizontal: space.xs }}>
      {!!title && lit.glow}
      {!!title && <Text variant="label" weight="semibold" tone="groupLabel">{title}</Text>}
      {!!detail && <Text variant="label" weight="regular" tone="textSecondary">{detail}</Text>}
    </View>}
    <View style={{ borderRadius: radius.card, backgroundColor: colors.surfaceCard, borderWidth: geometry.hairline,
      borderColor: colors.borderSubtle, paddingHorizontal: space.lg }}>
      {React.Children.toArray(children).filter(Boolean).map((child, i) => <View key={i}
        style={i ? { borderTopWidth: geometry.hairline, borderTopColor: colors.borderSubtle } : undefined}>{child}</View>)}
    </View>
  </View>;
}

/** A setting with its control alongside the label, or below it for wider controls. */
export function FormRow({ title, detail, stacked = false, children }: React.PropsWithChildren<{ title: string; detail?: string; stacked?: boolean }>) {
  const lit = useLit(title);
  return <View ref={lit.ref} style={{
    flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : 'center',
    gap: stacked ? space.md : space.lg, paddingVertical: space.md, minHeight: geometry.rowTall,
  }}>
    {lit.glow}
    <View style={{ flex: stacked ? undefined : 1, gap: space.hair }}>
      <Text>{title}</Text>
      {!!detail && <Text variant="label" weight="regular" tone="textSecondary">{detail}</Text>}
    </View>
    {children}
  </View>;
}

/**
 * A row or heading a search led to: it scrolls into view and an accent wash
 * glows behind it for a moment, then fades.
 */
export function useLit(title: string) {
  const { colors, reduceMotion } = useTheme();
  const wanted = useContext(FormHighlight) === title;
  const scroll = useSheetScroll();
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!wanted || !scroll?.content.current || !ref.current) return;
    ref.current.measureLayout(scroll.content.current, (_x, y) => scroll.scrollTo(y - space.huge), () => undefined);
  }, [wanted, scroll]);
  const held = useHeld(wanted, duration.highlight);
  const glow = useEased(wanted && !held, reduceMotion);
  return { ref, glow: wanted ? <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: -space.md,
    right: -space.md, borderRadius: radius.control, backgroundColor: colors.accentSoft, opacity: glow }} /> : null };
}

/** A heading above a section of a sheet. */
export function SectionHeader({ title, detail, children }: React.PropsWithChildren<{ title: string; detail?: string }>) {
  return <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md, marginBottom: space.lg }}>
    <View style={{ flex: 1, gap: space.xs }}>
      <Text variant="headline">{title}</Text>
      {!!detail && <Text variant="caption">{detail}</Text>}
    </View>
    {children}
  </View>;
}
