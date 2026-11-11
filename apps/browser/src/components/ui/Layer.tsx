import React from 'react';
import { View } from 'react-native';
import { layer } from './tokens';

/**
 * One overlay layer over the whole window. Layers stack in a fixed order
 * (content < sheets < dialogs < popovers < toasts) and pass clicks through
 * wherever nothing is drawn.
 */
export function Layer({ level, children }: React.PropsWithChildren<{ level: keyof typeof layer }>) {
  return <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: layer[level] }}>
    {children}
  </View>;
}
