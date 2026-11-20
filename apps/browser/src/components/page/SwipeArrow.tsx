import React from 'react';
import { Animated, View } from 'react-native';
import { useBrowser } from '../../state/window';
import { Icon, Panel, geometry, radius, useSwipeArrow, useTheme } from '../ui';

/**
 * A two-finger swipe back or forward, drawn by the shell in place of
 * Chromium's overlay: a round arrow comes in from the page's edge as the
 * swipe goes, past its end it gives less and less, as a rubber band does,
 * and it fills with the accent once letting go would go back (or forward).
 * Let go there, it pops and fades as the page changes; short of it, it
 * springs back out.
 */
export function SwipeArrow() {
  const swipe = useBrowser(s => s.historySwipe);
  const { reduceMotion } = useTheme();
  const { x, scale, shown } = useSwipeArrow(swipe, geometry.swipeReach, reduceMotion);
  if (!swipe) return null;
  const back = swipe.direction === 'back';
  const ready = swipe.ready;
  // Clipped to the page, so the arrow comes out from behind its edge and never over the sidebar.
  return <View pointerEvents="none" accessible={false} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    overflow: 'hidden', borderRadius: radius.card }}>
    <View style={{ position: 'absolute', top: 0, bottom: 0, [back ? 'left' : 'right']: -geometry.swipeChip, justifyContent: 'center' }}>
    <Animated.View style={{ width: geometry.swipeChip, height: geometry.swipeChip, opacity: shown,
      transform: [{ translateX: back ? x : Animated.multiply(x, -1) }, { scale }] }}>
      <Panel fill={ready ? 'accent' : 'surfacePopoverSolid'} radius="pill" elevation="menu" border={ready ? null : 'surfaceBorder'}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={back ? 'arrow.left' : 'arrow.right'} tone={ready ? 'textOnAccent' : 'iconPrimary'} weight="semibold" />
      </Panel>
    </Animated.View>
    </View>
  </View>;
}
