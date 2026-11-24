import React from 'react';
import { View } from 'react-native';
import { Surface } from '../../platform/shell';
import { duration } from './motion';
import { space } from './tokens';
import { useTheme } from './theme';

/** Core Animation composites the last rendered frame while React mounts the new screen. */
export function PageTurn({ id, backwards, children }: {
  id: string; backwards: boolean; children: React.ReactNode;
}) {
  const { reduceMotion } = useTheme();
  return <View style={{ flex: 1, overflow: 'hidden' }}>
    <Surface style={{ flex: 1 }} surfaceTurn={{
      page: id, offset: backwards ? -space.sm : space.sm, milliseconds: reduceMotion ? 0 : duration.setup,
    }}>
      <View key={id} style={{ flex: 1 }}>{children}</View>
    </Surface>
  </View>;
}
