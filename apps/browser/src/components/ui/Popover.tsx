import React from 'react';
import { Animated, View } from 'react-native';
import { OutsidePress } from '../../platform/shell';
import { presenceStyle, useLatest, usePresence, type PresenceKind } from './motion';
import { Panel } from './Panel';
import { useTheme } from './theme';
import { geometry, space, type ColorRole } from './tokens';

export type Frame = { x: number; y: number; width: number; height: number };
export type Placement = 'below-start' | 'below-end' | 'below-center' | 'above-start' | 'above-end' | 'right-start';

/** Where a popover of `size` goes next to `anchor`, kept inside `bounds`. */
export function placePopover(anchor: Frame, size: { width: number }, bounds: { width: number; height: number }, placement: Placement) {
  const gap = space.xs + space.hair;
  const end = placement === 'below-end' || placement === 'above-end';
  let left = end ? anchor.x + anchor.width - size.width
    : placement === 'below-center' ? anchor.x + anchor.width / 2 - size.width / 2
    : placement === 'right-start' ? anchor.x + anchor.width + gap : anchor.x;
  left = Math.max(space.sm, Math.min(left, bounds.width - size.width - space.sm));
  if (placement === 'above-start' || placement === 'above-end') {
    // Grows upwards from just above the anchor.
    const bottom = bounds.height - anchor.y + gap;
    return { left, bottom, maxHeight: Math.max(geometry.rowTall * 3, anchor.y - gap - space.md) };
  }
  const top = placement === 'right-start' ? anchor.y : anchor.y + anchor.height + gap;
  return { left, top, maxHeight: Math.max(geometry.rowTall * 3, bounds.height - top - space.md) };
}

/**
 * A non-blocking surface attached to a control. It animates in and out, closes
 * on Escape, on a press anywhere outside it (including on the web page) and
 * when the window loses focus, and never dims or blocks the page.
 */
export function Popover({ open, anchor, bounds, placement = 'below-start', width = 'popover', kind = 'popover', fill = 'surfacePopover',
  label, onClose, children, flush = false }: {
  open: boolean; anchor: Frame | undefined; bounds: { width: number; height: number }; placement?: Placement;
  width?: keyof typeof geometry | number; kind?: PresenceKind; fill?: ColorRole; label: string; onClose(): void;
  children?: React.ReactNode; flush?: boolean;
}) {
  const { reduceMotion } = useTheme();
  const { mounted, progress } = usePresence(open && !!anchor, kind, reduceMotion);
  const frame = useLatest(anchor);
  const content = useLatest(open ? children : null);
  if (!mounted || !frame) return null;
  const w = typeof width === 'number' ? width : geometry[width];
  const place = placePopover(frame, { width: w }, bounds, placement);
  return <OutsidePress onOutsidePress={() => { if (open) onClose(); }}
    style={{ position: 'absolute', top: place.top, bottom: place.bottom, left: place.left, width: w }}>
    <Animated.View style={presenceStyle(progress, kind)} accessibilityViewIsModal={false}
      keyDownEvents={[{ key: 'Escape' }]} onKeyDown={e => { if (e.nativeEvent.key === 'Escape') onClose(); }}>
      <Panel fill={fill} radius="popover" elevation={kind === 'menu' ? 'menu' : 'popover'} accessibilityLabel={label}
        style={{ maxHeight: place.maxHeight }}>
        <View style={{ padding: flush ? 0 : space.xs + space.hair, maxHeight: place.maxHeight }}>{content}</View>
      </Panel>
    </Animated.View>
  </OutsidePress>;
}
