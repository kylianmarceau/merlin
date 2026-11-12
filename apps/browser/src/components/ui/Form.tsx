import React from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, radius, space } from './tokens';

/** A titled group of settings drawn as one rounded card. */
export function FormGroup({ title, detail, children }: React.PropsWithChildren<{ title?: string; detail?: string }>) {
  const { colors } = useTheme();
  return <View style={{ gap: space.sm, marginBottom: space.xl }}>
    {(title || detail) && <View style={{ gap: space.hair, paddingHorizontal: space.xs }}>
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

/** One setting: title and description on the left, its control on the right. */
export function FormRow({ title, detail, children }: React.PropsWithChildren<{ title: string; detail?: string }>) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.md, minHeight: geometry.rowTall }}>
    <View style={{ flex: 1, gap: space.hair }}>
      <Text>{title}</Text>
      {!!detail && <Text variant="label" weight="regular" tone="textSecondary">{detail}</Text>}
    </View>
    {children}
  </View>;
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
