import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { Appearance } from '../../state/types';
import {
  Pressable, Text, accentLabel, accentSwatch, geometry, radius, settingsArt as art, settingsGeometry as size,
  space, useInteraction, useLit, useTheme, type AccentName,
} from '../ui';

export function PreviewTile({ title, selected, onPress, children, expand = false }: React.PropsWithChildren<{
  title: string; selected: boolean; onPress(): void; expand?: boolean;
}>) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = useInteraction();
  return <Pressable accessibilityRole="radio" accessibilityLabel={title} accessibilityState={{ selected }}
    onPress={onPress} {...handlers} style={{ width: expand ? undefined : size.preview, flex: expand ? 1 : undefined, alignItems: 'stretch', gap: space.xs }}>
    <View style={{ padding: space.hair, borderWidth: geometry.focusRing, borderRadius: radius.panel,
      borderColor: selected || focused ? colors.accent : hovered ? colors.borderDefault : colors.fillTransparent }}>
      <View pointerEvents="none" style={{ height: size.previewHeight, borderRadius: radius.card, overflow: 'hidden',
        alignItems: 'center', justifyContent: 'center' }}>
        <Image accessible={false} source={require('./art/wallpaper.png')} resizeMode="stretch" style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} />
        <View style={[StyleSheet.absoluteFill, { borderRadius: radius.card, borderWidth: geometry.hairline, borderColor: art.previewEdge }]} />
        {children}
      </View>
    </View>
    <Text variant="caption" tone={selected ? 'textPrimary' : 'textSecondary'} weight={selected ? 'semibold' : 'medium'} align="center">{title}</Text>
  </Pressable>;
}

const schemes = {
  system: { label: 'Auto', image: require('./art/system.png') },
  light: { label: 'Light', image: require('./art/light.png') },
  dark: { label: 'Dark', image: require('./art/dark.png') },
};

export function ThemeChoice({ mode, selected, onPress, expand }: {
  mode: Appearance['mode']; expand: boolean; selected: boolean; onPress(): void;
}) {
  const { label, image } = schemes[mode];
  return <PreviewTile expand={expand} title={label} selected={selected} onPress={onPress}>
    <Image accessible={false} source={image} resizeMode="contain" style={{ width: size.miniWindow, height: size.miniHeight }} />
  </PreviewTile>;
}

export function PreviewGroup({ title, expanded, children }: React.PropsWithChildren<{ title: string; expanded: boolean }>) {
  const lit = useLit(title);
  return <View ref={lit.ref} accessibilityRole="radiogroup" accessibilityLabel={title} style={{ flexGrow: expanded ? React.Children.count(children) : 0, flexBasis: expanded ? 0 : undefined, minWidth: 0, gap: space.xs }}>
    {lit.glow}
    <Text variant="label" weight="semibold" tone="textSecondary" style={{ marginLeft: space.xs }}>{title}</Text>
    <View style={{ flexDirection: 'row', flexWrap: expanded ? 'nowrap' : 'wrap', gap: space.xs }}>{children}</View>
  </View>;
}

/** A labelled workspace colour and its accent. */
export function Swatch({ name, selected, onPress }: { name: AccentName; selected: boolean; onPress(): void }) {
  const { colors, dark } = useTheme();
  const swatch = accentSwatch(dark ? 'dark' : 'light', name);
  const label = accentLabel(name);
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress}
    style={{ flexBasis: '20%', minWidth: space.huge + space.md, alignItems: 'center', gap: space.xs + space.hair }}>
    <View style={{ padding: space.hair, borderRadius: radius.pill, borderWidth: geometry.focusRing,
      borderColor: colors[selected ? 'accent' : 'fillTransparent'] }}>
      <View style={{ width: geometry.swatch, height: geometry.swatch, borderRadius: radius.pill, backgroundColor: swatch.fill,
        alignItems: 'flex-end', justifyContent: 'flex-end' }}>
        <View style={{ width: geometry.dot + space.hair, height: geometry.dot + space.hair, borderRadius: radius.pill,
          backgroundColor: swatch.accent, borderWidth: geometry.hairline, borderColor: colors.contentBackground }} />
      </View>
    </View>
    <Text variant="label" tone={selected ? 'textPrimary' : 'textSecondary'}>{label}</Text>
  </Pressable>;
}
