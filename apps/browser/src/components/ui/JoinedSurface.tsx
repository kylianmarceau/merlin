import React from 'react';
import { StyleSheet } from 'react-native';
import { PopoverBubble } from '../../platform/shell';
import { geometry } from './tokens';

/** A solid surface with a continuous fill across its shared edge. */
export function JoinedSurface({ fill, border, radius, join, edges }: {
  fill: string; border: string; radius: number; join: 'top' | 'bottom'; edges: { left: boolean; right: boolean };
}) {
  return <PopoverBubble pointerEvents="none" style={StyleSheet.absoluteFill}
    bubbleRadius={radius} bubbleJoin={{ top: join === 'top', ...edges }} arrowEdge="none" glass={false}
    bubbleFill={fill} bubbleEdgeColor={border} bubbleEdgeWidth={geometry.hairline} />;
}
