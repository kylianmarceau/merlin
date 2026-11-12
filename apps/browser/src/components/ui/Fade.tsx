import React from 'react';
import type { ViewStyle } from 'react-native';
import { Fade as NativeFade } from '../../platform/shell';
import { space } from './tokens';

/** Fades its content out at the trailing edge instead of cutting it off with an ellipsis. */
export function Fade({ style, children }: React.PropsWithChildren<{ style?: ViewStyle }>) {
  return <NativeFade fadeLength={space.lg + space.hair} style={style}>{children}</NativeFade>;
}
