import React from 'react';
import { Animated, Image, View, type ImageSourcePropType } from 'react-native';
import { Icon, Pressable, Text, favoriteTint, geometry, pressScale, radius, setupGeometry, space, useInteraction, usePressScale, useTheme } from '../ui';
import { CheckRing, ChoiceCard, useSetupInk } from './SetupParts';

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
  const { dark, reduceMotion } = useTheme();
  const ink = useSetupInk();
  const { hovered, focused, handlers } = useInteraction();
  const tint = multiple && selected ? favoriteTint(id, dark) : undefined;
  const [down, setDown] = React.useState(false);
  const scale = usePressScale(down, pressScale.tile, reduceMotion);
  return <Pressable accessibilityRole={multiple ? 'checkbox' : 'radio'} accessibilityLabel={label}
    accessibilityState={multiple ? { checked: selected } : { selected }} onPress={onPress} {...handlers}
    onPressIn={() => setDown(true)} onPressOut={() => setDown(false)} style={{ width: '23%' }}>
    <Animated.View style={{ transform: [{ scale }] }}>
      <ChoiceCard selected={selected} hovered={hovered} focused={focused} strong
        style={{ minHeight: setupGeometry.tileHeight, alignItems: 'center', justifyContent: 'center', gap: space.xs + space.hair }}>
        {tint && <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.card,
          backgroundColor: tint.fill, borderWidth: geometry.hairline, borderColor: tint.edge }} />}
        <Mark id={id} />
        <Text variant="caption" weight="medium" lines={1} style={{ color: selected ? ink.title : ink.subtitle, paddingHorizontal: space.xs }}>{label}</Text>
        {selected && <View pointerEvents="none" style={{ position: 'absolute', top: space.xs + 1, right: space.xs + 1 }}><CheckRing on small /></View>}
      </ChoiceCard>
    </Animated.View>
  </Pressable>;
}
