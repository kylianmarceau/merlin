import React, { useMemo, useRef, useState } from 'react';
import { Image, PanResponder, View } from 'react-native';
import type { Appearance } from '../../state/types';
import { newWorkspaceTheme, textures, type WorkspaceTheme } from '../../state/workspaceTheme';
import { Button, Icon, PopUp, Pressable, Slider, Text, accentLabel, accentSwatch, accents, geometry, radius, setupGeometry, space, useTheme } from '../ui';

function toHex(hue: number, saturation: number, lightness: number) {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const component = (n: number) => {
    const k = (n + hue / 30) % 12;
    const channel = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * channel).toString(16).padStart(2, '0');
  };
  return '#' + component(0) + component(8) + component(4);
}

function toHsl(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const sector = !delta ? 0 : max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: (sector * 60 + 360) % 360, saturation: delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0, lightness };
}

function ColourWheel({ color, onPick }: { color: string; onPick(hue: number, saturation: number): void }) {
  const { colors } = useTheme();
  const { hue, saturation } = toHsl(color);
  const half = setupGeometry.colourWheel / 2;
  const start = useRef({ x: 0, y: 0 });
  const change = useRef(onPick);
  change.current = onPick;
  const responder = useMemo(() => {
    const pick = (x: number, y: number) => change.current(
      (Math.atan2(y, x) * 180 / Math.PI + 360) % 360, Math.min(1, Math.hypot(x, y) / half));
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: event => {
        start.current = { x: event.nativeEvent.locationX - half, y: event.nativeEvent.locationY - half };
        pick(start.current.x, start.current.y);
      },
      onPanResponderMove: (_, drag) => pick(start.current.x + drag.dx, start.current.y + drag.dy),
      onPanResponderTerminationRequest: () => false,
    });
  }, [half]);
  return <View {...responder.panHandlers} style={{ width: setupGeometry.colourWheel, height: setupGeometry.colourWheel }}>
    <View pointerEvents="none" style={{ flex: 1 }}>
      <Image accessible={false} source={require('./hue-wheel.png')} style={{ width: '100%', height: '100%' }} />
      <View style={{ position: 'absolute', left: half + half * saturation * Math.cos(hue * Math.PI / 180) - space.sm,
        top: half + half * saturation * Math.sin(hue * Math.PI / 180) - space.sm, width: space.lg, height: space.lg,
        backgroundColor: color, borderWidth: geometry.focusRing, borderColor: colors.fillThumb, borderRadius: radius.pill }} />
    </View>
  </View>;
}

export function ThemeEditor({ accent, theme, onAccent, onTheme }: {
  accent: Appearance['accent']; theme: WorkspaceTheme | null;
  onAccent(accent: Appearance['accent']): void; onTheme(theme: WorkspaceTheme | null): void;
}) {
  const { colors, dark } = useTheme();
  const [selected, setSelected] = useState(0);
  const swatch = (name: Appearance['accent']) => accentSwatch(dark ? 'dark' : 'light', name).fill;
  const stop = Math.min(selected, (theme?.stops.length ?? 1) - 1);
  const hsl = theme ? toHsl(theme.stops[stop]) : null;
  const slider = (label: string, value: number, change: (value: number) => void, display = Math.round(value * 100) + '%') =>
    <View style={{ minHeight: geometry.control, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <Text variant="label">{label}</Text>
      <Slider label={label} value={value} valueText={display} onChange={change} />
    </View>;
  const editStop = (hue: number, saturation: number, lightness: number) => {
    if (theme) onTheme({ ...theme, stops: theme.stops.map((color, i) => i === stop ? toHex(hue, saturation, lightness) : color) });
  };
  return <View style={{ gap: space.sm }}>
    <View accessibilityRole="radiogroup" accessibilityLabel="Space colour" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {accents.map(name => <Pressable key={name} accessibilityRole="radio" accessibilityLabel={accentLabel(name)}
        accessibilityState={{ selected: !theme && name === accent }} onPress={() => { onAccent(name); onTheme(null); }}
        style={{ width: geometry.swatch, height: geometry.swatch, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
          borderWidth: name === accent && !theme ? 2 : 1, borderColor: colors[name === accent && !theme ? 'accent' : 'borderSubtle'],
          backgroundColor: swatch(name) }}>
        {name === accent && !theme && <Icon name="checkmark" size="small" tone="textPrimary" />}
      </Pressable>)}
    </View>
    {!theme || !hsl ? <Button label="Customize colour…" variant="secondary" size="small"
      onPress={() => { setSelected(0); onTheme(newWorkspaceTheme(swatch(accent))); }} /> : <>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm }}>
        {theme.stops.map((color, index) => <Pressable key={index} accessibilityRole="button" accessibilityLabel={'Colour stop ' + (index + 1)}
          accessibilityState={{ selected: index === stop }} onPress={() => setSelected(index)}
          style={{ width: geometry.control, height: geometry.control, backgroundColor: color, borderRadius: radius.pill,
            borderWidth: index === stop ? 2 : 1, borderColor: colors[index === stop ? 'focusRing' : 'borderSubtle'] }} />)}
        <Button label="Add colour" size="small" variant="secondary" disabled={theme.stops.length >= 3} onPress={() => {
          setSelected(theme.stops.length);
          onTheme({ ...theme, stops: [...theme.stops, swatch('ocean')] });
        }} />
        <Button label="Remove" size="small" variant="ghost" disabled={theme.stops.length <= 1}
          onPress={() => { setSelected(Math.max(0, stop - 1)); onTheme({ ...theme, stops: theme.stops.filter((_, index) => index !== stop) }); }} />
        <Button label="Reset" size="small" variant="ghost" onPress={() => onTheme(null)} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.md, paddingVertical: space.xs }}>
        <ColourWheel color={theme.stops[stop]} onPick={(hue, saturation) => editStop(hue, saturation, hsl.lightness)} />
        <View style={{ flex: 1, minWidth: setupGeometry.previewSidebar, gap: space.xs }}>
          {slider('Hue', hsl.hue / 360, value => editStop(value * 360, hsl.saturation || .55, hsl.lightness), Math.round(hsl.hue) + '°')}
          {slider('Saturation', hsl.saturation, value => editStop(hsl.hue, value, hsl.lightness))}
          {slider('Lightness', hsl.lightness, value => editStop(hsl.hue, hsl.saturation, value))}
        </View>
      </View>
      {slider('Intensity', theme.intensity, intensity => onTheme({ ...theme, intensity }))}
      {slider('Pass-through blur', theme.translucency, translucency => onTheme({ ...theme, translucency }))}
      {slider('Noise', theme.noise, noise => onTheme({ ...theme, noise }))}
      <PopUp label="Texture" value={theme.texture} options={textures.map(value => ({ value, title: value[0].toUpperCase() + value.slice(1) }))}
        onChange={texture => onTheme({ ...theme, texture })} />
      {slider('Direction', theme.angle / 360, value => onTheme({ ...theme, angle: Math.round(value * 360) }), theme.angle + '°')}
    </>}
  </View>;
}
