import React from 'react';
import { Image } from 'react-native';
import { useSnapshot } from '../../state/window';
import { geometry, opacity, useTheme, type AccentName } from '../ui';

// A mound of thick paint in the workspace colour: Merlin's start page mark.
// Pre-rendered at 2x from the paint artwork, one per workspace colour, so the
// page costs nothing while it sits open.
const paint: Record<AccentName, number> = {
  fern: require('./paint/perch-fern.png'),
  ocean: require('./paint/perch-ocean.png'),
  iris: require('./paint/perch-iris.png'),
};

export function PaintMark() {
  const { appearance } = useSnapshot();
  const { dark } = useTheme();
  return <Image source={paint[appearance.accent] ?? paint.fern} accessible={false} resizeMode="contain"
    style={{ width: geometry.paintWidth, height: geometry.paintHeight, opacity: dark ? opacity.paintDark : 1 }} />;
}
