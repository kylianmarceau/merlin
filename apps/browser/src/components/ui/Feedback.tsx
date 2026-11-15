import React from 'react';
import { ActivityIndicator, Animated, View } from 'react-native';
import { ProgressRing as NativeProgressRing } from '../../platform/shell';
import { Icon, type SymbolName } from './Icon';
import { Text } from './Text';
import { useLoadingBar } from './motion';
import { useTheme } from './theme';
import { geometry, radius, space, type ColorRole } from './tokens';

/** An inline message in a panel: information or a failure to explain. */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'warning'; children: React.ReactNode }) {
  const { colors } = useTheme();
  const fill: ColorRole = tone === 'error' ? 'dangerSoft' : tone === 'warning' ? 'warningSoft' : 'infoSoft';
  const ink: ColorRole = tone === 'error' ? 'textDanger' : tone === 'warning' ? 'textWarning' : 'accentSoftText';
  return <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start',
    padding: space.md, borderRadius: radius.field, backgroundColor: colors[fill] }}>
    <Icon name={tone === 'info' ? 'info.circle' : 'exclamationmark.triangle'} tone={ink} size="small" />
    <Text tone={ink} flex={1}>{children}</Text>
  </View>;
}

/** What an empty list says, with an optional next step. */
export function EmptyState({ icon, title, detail, action }: { icon: SymbolName; title: string; detail?: string; action?: React.ReactNode }) {
  return <View style={{ alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.xl }}>
    <Icon name={icon} tone="iconSecondary" size="large" weight="regular" />
    <Text variant="calloutStrong" align="center">{title}</Text>
    {!!detail && <Text tone="textSecondary" align="center">{detail}</Text>}
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
export function ProgressTrack({ value, thin = false, muted = false }: { value: number | null; thin?: boolean; muted?: boolean }) {
  const { colors } = useTheme();
  const height = thin ? geometry.progress - geometry.hairline : geometry.progress;
  return <View style={{ height, borderRadius: radius.pill, backgroundColor: colors.progressTrack, overflow: 'hidden' }}>
    <View style={{ height, width: `${Math.max(3, value ?? 30)}%`, borderRadius: radius.pill,
      backgroundColor: colors[muted ? 'textTertiary' : 'progressFill'] }} />
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

/**
 * Progress as a ring `size` across, filling clockwise from the top; it
 * circles while `value` is null (the total is not known yet).
 */
export function ProgressRing({ value, size, muted = false }: { value: number | null; size: number; muted?: boolean }) {
  const { colors, reduceMotion } = useTheme();
  return <NativeProgressRing pointerEvents="none" accessible={false} ringProgress={value === null ? -1 : Math.max(0, Math.min(1, value))}
    ringColor={colors[muted ? 'textTertiary' : 'progressFill']} ringTrackColor={colors.progressTrack} ringWidth={geometry.ringStroke}
    ringReduceMotion={reduceMotion} style={{ width: size, height: size }} />;
}

/**
 * A page loading, as a thin bar along the bottom of the address, as in Arc
 * and Dia: it runs quickly to a quarter, creeps on while the page loads,
 * then completes and fades. `inset` keeps it clear of the field's corners.
 */
export function LoadingBar({ loading, inset = 0 }: { loading: boolean; inset?: number }) {
  const { colors, reduceMotion } = useTheme();
  const { fill, opacity } = useLoadingBar(loading, reduceMotion);
  return <Animated.View pointerEvents="none" accessible={false} style={{ position: 'absolute', left: inset, right: inset, bottom: 0,
    height: geometry.loadingBar, opacity }}>
    {/* tabLoading follows the site's colours on a tinted toolbar, so the bar stays visible on any site. */}
    <Animated.View style={{ height: geometry.loadingBar, borderRadius: radius.pill, backgroundColor: colors.tabLoading,
      width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
  </Animated.View>;
}
