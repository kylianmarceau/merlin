import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Icon, type SymbolName } from './Icon';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, radius, space, type ColorRole } from './tokens';

/** An inline message in a panel: information or a failure to explain. */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'warning'; children: React.ReactNode }) {
  const { colors } = useTheme();
  const fill: ColorRole = tone === 'error' ? 'dangerSoft' : tone === 'warning' ? 'warningSoft' : 'infoSoft';
  const ink: ColorRole = tone === 'error' ? 'textDanger' : tone === 'warning' ? 'textWarning' : 'accentSoftText';
  return <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start',
    padding: space.md, borderRadius: radius.control, backgroundColor: colors[fill] }}>
    <Icon name={tone === 'info' ? 'info.circle' : 'exclamationmark.triangle'} tone={ink} size="small" />
    <Text tone={ink} flex={1}>{children}</Text>
  </View>;
}

/** What an empty list says, with an optional next step. */
export function EmptyState({ icon, title, detail, action }: { icon: SymbolName; title: string; detail?: string; action?: React.ReactNode }) {
  return <View style={{ alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.xl }}>
    <IconTile icon={icon} size="large" />
    <Text variant="bodyStrong" align="center">{title}</Text>
    {!!detail && <Text variant="caption" align="center">{detail}</Text>}
    {action}
  </View>;
}

/** An icon on a soft rounded tile, for list leaders and empty states. */
export function IconTile({ icon, tone = 'iconSecondary', fill = 'fillControl', size = 'regular' }: {
  icon: SymbolName; tone?: ColorRole; fill?: ColorRole; size?: 'regular' | 'large';
}) {
  const { colors } = useTheme();
  const side = size === 'large' ? geometry.tile + space.md : geometry.tile;
  return <View style={{ width: side, height: side, borderRadius: size === 'large' ? radius.card : radius.control,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors[fill] }}>
    <Icon name={icon} tone={tone} size={size === 'large' ? 'large' : 'small'} />
  </View>;
}

/** Download or loading progress; indeterminate when `value` is null. */
export function ProgressTrack({ value }: { value: number | null }) {
  const { colors } = useTheme();
  return <View style={{ height: geometry.progress, borderRadius: radius.pill, backgroundColor: colors.progressTrack, overflow: 'hidden' }}>
    <View style={{ height: geometry.progress, width: `${value ?? 30}%`, borderRadius: radius.pill, backgroundColor: colors.progressFill }} />
  </View>;
}

/** A small count or status on a control. */
export function Badge({ children, tone = 'accent' }: { children: string; tone?: 'accent' | 'neutral' | 'danger' }) {
  const { colors } = useTheme();
  const fill: ColorRole = tone === 'accent' ? 'accent' : tone === 'danger' ? 'danger' : 'fillBadge';
  return <View style={{ minWidth: geometry.keycap - space.xs, paddingHorizontal: space.xs, height: geometry.keycap - space.xs,
    borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors[fill] }}>
    <Text variant="micro" tone={tone === 'neutral' ? 'textSecondary' : 'textOnAccent'}>{children}</Text>
  </View>;
}

export function Spinner({ small = true }: { small?: boolean }) {
  const { colors } = useTheme();
  return <ActivityIndicator size={small ? 'small' : 'large'} color={colors.textSecondary} />;
}
