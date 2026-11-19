import React from 'react';
import { Animated, ScrollView, View, type ViewStyle } from 'react-native';
import { OutsidePress, type OutsidePressEvent } from '../../platform/shell';
import { PopoverSurface } from './PopoverSurface';
import { presenceStyle, useLatest, usePresence, type PresenceKind } from './motion';
import { Panel } from './Panel';
import { useTheme } from './theme';
import { anchoredGlass, geometry, space, type ColorRole } from './tokens';

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
 * Ardia's placement for a popover with an arrow: centred under (or over) its
 * control and kept `popoverMargin` inside the window, the arrow still pointing
 * at the control's centre. Controls in the bottom half open upwards.
 */
export function placeBubble(anchor: Frame, width: number, bounds: { width: number; height: number }) {
  const margin = geometry.popoverMargin;
  const w = Math.max(0, Math.min(width, bounds.width - margin * 2));
  const centre = anchor.x + anchor.width / 2;
  const left = Math.max(margin, Math.min(centre - w / 2, bounds.width - margin - w));
  const arrowX = centre - left;
  if (anchor.y + anchor.height / 2 > bounds.height / 2) {
    const bottom = bounds.height - anchor.y + geometry.arrowGap;
    return { width: w, left, bottom, top: undefined, arrow: 'bottom' as const, arrowX,
      room: anchor.y - geometry.arrowGap - geometry.arrowHeight - margin };
  }
  const top = anchor.y + anchor.height + geometry.arrowGap;
  return { width: w, left, top, bottom: undefined, arrow: 'top' as const, arrowX,
    room: bounds.height - top - geometry.arrowHeight - margin };
}

/** Opens downwards from controls in the top half of the window and upwards from those in the bottom half. */
export function autoPlacement(anchor: Frame | undefined, bounds: { height: number }, align: 'start' | 'end'): Placement {
  const low = !!anchor && anchor.y > bounds.height / 2;
  return `${low ? 'above' : 'below'}-${align}`;
}

/**
 * A non-blocking surface attached to a control, as in Ardia: an arrow points
 * at the control, and it is Liquid Glass or solid as Settings says. It
 * animates out of its arrow, closes on Escape, on a press anywhere outside it
 * (including on the web page) and when the window loses focus, and never
 * dims or blocks the page. Its content sets its own side padding (see
 * PopoverRow and MenuRow). `arrow={false}` attaches it flush, without an
 * arrow, as the address suggestions are.
 */
export function Popover({ open, anchor, bounds, placement = 'below-start', width = 'popover', kind = 'popover', fill,
  label, onClose, children, flush = false, instant = false, arrow = true }: {
  open: boolean; anchor: Frame | undefined; bounds: { width: number; height: number }; placement?: Placement;
  width?: keyof typeof geometry | number; kind?: PresenceKind; fill?: ColorRole; label: string;
  /** Why it should close: a press outside it (also on the page), Escape, or the window losing focus. */
  onClose(reason: 'press' | 'escape' | 'blur'): void;
  children?: React.ReactNode; flush?: boolean;
  /** Shows and hides at once, like the address field's suggestions: a list that faded out over the page after Enter read as the page fading in. */
  instant?: boolean;
  arrow?: boolean;
}) {
  const { reduceMotion } = useTheme();
  const { mounted, progress } = usePresence(open && !!anchor, kind, reduceMotion || instant);
  const frame = useLatest(anchor);
  const content = useLatest(open ? children : null);
  if (!mounted || !frame) return null;
  const w = typeof width === 'number' ? width : geometry[width];
  const close = (e: OutsidePressEvent) => { if (open) onClose(e.nativeEvent.reason); };
  const keys = { keyDownEvents: [{ key: 'Escape' }], onKeyDown: (e: { nativeEvent: { key: string } }) => { if (e.nativeEvent.key === 'Escape') onClose('escape'); } };
  // Escape closes it wherever the focus is, the page included; the address
  // field's own suggestions (`instant`) leave Escape to the field.
  const escape = open && !instant;

  if (flush || !arrow) {
    const place = placePopover(frame, { width: w }, bounds, placement);
    const upward = place.bottom !== undefined;
    return <OutsidePress onOutsidePress={close} closesOnEscape={escape} style={{ position: 'absolute', top: place.top, bottom: place.bottom, left: place.left, width: w }}>
      <Animated.View style={presenceStyle(progress, kind, undefined, upward)} accessibilityViewIsModal={false} {...keys}>
        {flush
          ? <Panel fill="contentBackground" radius="card" elevation="popover" accessibilityLabel={label} style={{ maxHeight: place.maxHeight }}>
            <View style={{ maxHeight: place.maxHeight }}>{content}</View>
          </Panel>
          : <View accessibilityLabel={label}>
            <PopoverSurface fill={fill ?? 'surfacePopoverSolid'} elevation={kind === 'menu' ? 'menu' : 'popover'} glassFloor={anchoredGlass} />
            <ScrollView style={{ maxHeight: place.maxHeight }} contentContainerStyle={{ paddingVertical: space.xs + space.hair }}>
              {content}
            </ScrollView>
          </View>}
      </Animated.View>
    </OutsidePress>;
  }

  const place = placeBubble(frame, w, bounds);
  const upward = place.arrow === 'bottom';
  const origin: [number, number | string, number] = [place.arrowX, upward ? '100%' : 0, 0];
  const listMax = Math.max(geometry.panelRow * 3, place.room);
  return <OutsidePress onOutsidePress={close} closesOnEscape={escape}
    style={{ position: 'absolute', top: place.top, bottom: place.bottom, left: place.left, width: place.width }}>
    <Animated.View style={presenceStyle(progress, kind, origin, upward)} accessibilityViewIsModal={false} {...keys}>
      <View accessibilityLabel={label}>
        <PopoverSurface arrow={place.arrow} arrowX={place.arrowX} fill={fill ?? 'surfacePopoverSolid'} glassFloor={anchoredGlass} />
        <ScrollView style={{ maxHeight: listMax, marginTop: upward ? 0 : geometry.arrowHeight, marginBottom: upward ? geometry.arrowHeight : 0 }}
          contentContainerStyle={{ paddingVertical: space.xs + space.hair }}>{content}</ScrollView>
      </View>
    </Animated.View>
  </OutsidePress>;
}
