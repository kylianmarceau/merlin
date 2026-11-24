import React from 'react';
import type { ViewStyle } from 'react-native';
import { Fade as NativeFade } from '../../platform/shell';
import { space } from './tokens';

const length = space.lg + space.hair;

/**
 * Fades its content out at the trailing edge instead of cutting it off with
 * an ellipsis; a scrolled lane fades at whichever edges have more beyond.
 */
export function Fade({ style, start = false, end = true, endLength = length, titlebar = false, children }: React.PropsWithChildren<{
  style?: ViewStyle; start?: boolean; end?: boolean; endLength?: number;
  /** Holds a scroll view in the window's title bar, which AppKit would otherwise inset. */
  titlebar?: boolean;
}>) {
  return <NativeFade fadeLength={end ? endLength : 0} fadeLeading={start ? length : 0} flushScroll={titlebar} style={style}>{children}</NativeFade>;
}
