import React from 'react';
import { Animated, Image, View, type ImageSourcePropType } from 'react-native';
import { Icon, Pressable, Text, favoriteTint, geometry, pressScale, radius, setupGeometry, space, useInteraction, usePressScale, useTheme } from '../ui';

// Local product marks keep the catalog available offline and avoid requests to third parties during setup.
const marks: Record<string, ImageSourcePropType> = {
  arc: require('./marks/arc.png'),
  bing: require('./marks/bing.png'),
  brave: require('./marks/brave.png'),
  calendar: require('./marks/calendar.png'),
  chrome: require('./marks/chrome.png'),
  dia: require('./marks/dia.png'),
  docs: require('./marks/docs.png'),
  drive: require('./marks/drive.png'),
  duckduckgo: require('./marks/duckduckgo.png'),
  ecosia: require('./marks/ecosia.png'),
  edge: require('./marks/edge.png'),
  figma: require('./marks/figma.png'),
  firefox: require('./marks/firefox.png'),
  github: require('./marks/github.png'),
  gmail: require('./marks/gmail.png'),
  google: require('./marks/google.png'),
  helium: require('./marks/helium.png'),
  kagi: require('./marks/kagi.png'),
  linear: require('./marks/linear.png'),
  notion: require('./marks/notion.png'),
  outlook: require('./marks/outlook.png'),
  safari: require('./marks/safari.png'),
  slack: require('./marks/slack.png'),
  spotify: require('./marks/spotify.png'),
  startpage: require('./marks/startpage.png'),
  youtube: require('./marks/youtube.png'),
  zen: require('./marks/zen.png'),
};

export function Mark({ id, size = setupGeometry.catalogIcon }: { id: string; size?: number }) {
  if (!marks[id]) return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <Icon name="sparkles" tone="iconSecondary" />
  </View>;
  return <Image accessible={false} source={marks[id]} resizeMode="contain" style={{ width: size, height: size, borderRadius: id === 'github' ? size / 2 : size / 5 }} />;
}

export function CatalogTile({ id, label, selected, onPress, multiple = false }: {
  id: string; label: string; selected: boolean; onPress(): void; multiple?: boolean;
}) {
  const { colors, dark, reduceMotion } = useTheme();
  const { hovered, focused, handlers } = useInteraction();
  const tint = multiple && selected ? favoriteTint(id, dark) : undefined;
  const [down, setDown] = React.useState(false);
  const scale = usePressScale(down, pressScale.tile, reduceMotion);
  return <Pressable accessibilityRole={multiple ? 'checkbox' : 'radio'} accessibilityLabel={label}
    accessibilityState={multiple ? { checked: selected } : { selected }} onPress={onPress} {...handlers}
    onPressIn={() => setDown(true)} onPressOut={() => setDown(false)}
    style={{ width: '23%', minHeight: setupGeometry.tileHeight, alignItems: 'center', justifyContent: 'center',
      borderRadius: radius.card, borderWidth: geometry.hairline,
      borderColor: focused ? colors.focusRing : tint?.edge ?? colors[selected ? 'borderStrong' : 'borderSubtle'],
      backgroundColor: tint?.fill ?? colors[selected ? 'accentSoft' : hovered ? 'fillHover' : 'contentBackground'] }}>
    <Animated.View style={{ alignItems: 'center', gap: space.xs, transform: [{ scale }] }}>
      <Mark id={id} />
      <Text variant="micro" tone={selected ? 'textPrimary' : 'textSecondary'} lines={1}>{label}</Text>
    </Animated.View>
    {selected && <View style={{ position: 'absolute', top: space.xs, right: space.xs, backgroundColor: colors.buttonPrimary,
      width: geometry.iconSmall, height: geometry.iconSmall, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="checkmark" size="chevron" tone="textOnPrimary" />
    </View>}
  </Pressable>;
}
