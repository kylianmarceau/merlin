import React from 'react';
import { Image } from 'react-native';
import { useSnapshot } from '../../state/window';
import { geometry, opacity, useTheme, type AccentName } from '../ui';

// Merlin's start page mark, "Peek": the Wrapped logo's globe, large, peeking
// over the search card, its wing arched over the crown to the falcon, in thick
// paint in the workspace colour. The paint runs to the image's bottom edge, which sits
// under the card's top edge (StartPage). Pre-rendered at 2x by
// branding/impasto/newtab.py, one per workspace colour, so the page costs
// nothing while it sits open.
const paint: Record<AccentName, number> = {
  fern: require('./paint/peek-fern.png'),
  ocean: require('./paint/peek-ocean.png'),
  iris: require('./paint/peek-iris.png'),
};

export function PaintMark() {
  const { appearance } = useSnapshot();
  const { dark } = useTheme();
  return <Image source={paint[appearance.accent] ?? paint.fern} accessible={false} resizeMode="contain"
    style={{ width: geometry.paintWidth, height: geometry.paintHeight, opacity: dark ? opacity.paintDark : 1 }} />;
}
