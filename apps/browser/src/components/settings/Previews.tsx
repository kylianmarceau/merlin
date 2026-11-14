import React from 'react';
import { Pressable, View } from 'react-native';
import type { Appearance } from '../../state/types';
import { Text, accentLabels, accentSwatch, geometry, opacity, radius, space, themePreview, useTheme, type AccentName } from '../ui';

/** A colour-scheme choice drawn as a small Merlin window. */
export function ThemeChoice({ mode, accent, selected, onPress }: {
  mode: Appearance['mode']; accent: AccentName; selected: boolean; onPress(): void;
}) {
  const { colors } = useTheme();
  const label = mode === 'system' ? 'Match system' : mode === 'light' ? 'Light' : 'Dark';
  const halves = mode === 'system' ? (['light', 'dark'] as const) : [mode];
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress}
    style={{ flex: 1, gap: space.sm, alignItems: 'center' }}>
    <View style={{ alignSelf: 'stretch', height: geometry.themePreview, borderRadius: radius.card, overflow: 'hidden', flexDirection: 'row',
      borderWidth: selected ? geometry.focusRing : geometry.hairline, borderColor: colors[selected ? 'accent' : 'borderDefault'] }}>
      {halves.map(half => {
        const c = themePreview(half, accent);
        return <View key={half} style={{ flex: 1, flexDirection: 'row', gap: space.xs + space.hair, padding: space.sm, backgroundColor: c.shell }}>
          {(half === 'light' || mode !== 'system') && <View style={{ width: geometry.previewSidebar, gap: space.xs }}>
            {[0, 1, 2].map(i => <View key={i} style={{ height: space.xs + space.hair, borderRadius: radius.xs, backgroundColor: c.bar,
              opacity: i === 1 ? 1 : opacity.dim }} />)}
          </View>}
          <View style={{ flex: 1, borderRadius: radius.sm, backgroundColor: c.card }} />
        </View>;
      })}
    </View>
    <Text weight="medium">{label}</Text>
  </Pressable>;
}

/** A workspace colour: the tint it gives the window, with its name. */
export function Swatch({ name, selected, onPress }: { name: AccentName; selected: boolean; onPress(): void }) {
  const { colors, dark } = useTheme();
  const swatch = accentSwatch(dark ? 'dark' : 'light', name);
  return <Pressable accessibilityRole="radio" accessibilityLabel={accentLabels[name]} accessibilityState={{ selected }} onPress={onPress}
    style={{ alignItems: 'center', gap: space.xs + space.hair }}>
    <View style={{ padding: space.hair, borderRadius: radius.pill, borderWidth: geometry.focusRing,
      borderColor: colors[selected ? 'accent' : 'fillTransparent'] }}>
      <View style={{ width: geometry.swatch, height: geometry.swatch, borderRadius: radius.pill, backgroundColor: swatch.fill,
        alignItems: 'flex-end', justifyContent: 'flex-end' }}>
        <View style={{ width: geometry.dot + space.hair, height: geometry.dot + space.hair, borderRadius: radius.pill,
          backgroundColor: swatch.accent, borderWidth: geometry.hairline, borderColor: colors.contentBackground }} />
      </View>
    </View>
    <Text variant="label" tone={selected ? 'textPrimary' : 'textSecondary'}>{accentLabels[name]}</Text>
  </Pressable>;
}
