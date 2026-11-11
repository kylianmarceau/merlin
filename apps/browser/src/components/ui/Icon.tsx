import React from 'react';
import { Symbol, type SymbolName } from '../../platform/shell';
import { useTheme } from './theme';
import { geometry, type ColorRole } from './tokens';

export type { SymbolName };
const sizes = { small: geometry.iconSmall, regular: geometry.icon, large: geometry.iconLarge } as const;

/** An SF Symbol tinted with a colour role. */
export function Icon({ name, tone = 'iconPrimary', size = 'regular', weight = 'medium' }: {
  name: SymbolName; tone?: ColorRole; size?: keyof typeof sizes; weight?: 'regular' | 'medium' | 'semibold' | 'bold';
}) {
  const { colors } = useTheme();
  return <Symbol name={name} color={colors[tone]} size={sizes[size]} weight={weight} />;
}
