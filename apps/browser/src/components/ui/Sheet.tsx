import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Animated, ScrollView, View } from 'react-native';
import { Pressable } from './Pressable';
import { IconButton } from './Button';
import { Icon, type SymbolName } from './Icon';
import { useInteraction } from './interaction';
import { duration, presenceStyle, useLatest, usePresence } from './motion';
import { Panel } from './Panel';
import { Text } from './Text';
import { TooltipCover } from './Tooltip';
import { useTheme } from './theme';
import { geometry, radius, space, type ColorRole } from './tokens';

export type SheetSection<K extends string> = { id: K; label: string; icon: SymbolName; badge?: string };

/** Shared sheet presentation, including dismissal, focus restoration and exit motion. */
export function SheetFrame({ open = true, title, onClose, onClosed, fill, width = geometry.sheetWidth,
  height = geometry.sheetHeight, children }: React.PropsWithChildren<{
  open?: boolean; title: string; onClose(): void; onClosed?(): void; fill: ColorRole; width?: number; height?: number;
}>) {
  const { colors, reduceMotion } = useTheme();
  const { mounted, progress } = usePresence(open, 'sheet', reduceMotion);
  const body = useLatest(open ? children : null);
  const keys = useRef<View>(null);
  const closed = useRef(onClosed);
  closed.current = onClosed;
  useEffect(() => {
    if (!open) return;
    keys.current?.focus();
    // Once more after the key or click that opened it has finished.
    const timer = setTimeout(() => keys.current?.focus(), duration.refocus);
    return () => { clearTimeout(timer); closed.current?.(); };
  }, [open]);
  if (!mounted) return null;
  return <TooltipCover><View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: progress }}>
      <Pressable accessible={false} style={{ flex: 1, backgroundColor: colors.scrim }} onPress={() => { if (open) onClose(); }} />
    </Animated.View>
    <Animated.View style={[{ width, height, maxWidth: '94%', maxHeight: '90%' },
      presenceStyle(progress, 'sheet')]}
      keyDownEvents={[{ key: 'Escape' }]} onKeyDown={e => { if (e.nativeEvent.key === 'Escape' && open) onClose(); }}>
      <View ref={keys} focusable enableFocusRing={false} style={{ flex: 1 }}>
        <Panel fill={fill} radius="panel" elevation="dialog" accessibilityLabel={title} accessibilityViewIsModal style={{ flex: 1 }}>
          <View style={{ flex: 1, borderRadius: radius.panel, overflow: 'hidden' }}>{body}</View>
        </Panel>
      </View>
    </Animated.View>
  </View></TooltipCover>;
}

export function Sheet<K extends string>({ open, title, sections, section, onSection, onClose, onClosed, children, footer,
  nav = 'tabs' }: React.PropsWithChildren<{
  open?: boolean; title: string; sections: readonly SheetSection<K>[]; section: K; onSection(id: K): void; onClose(): void;
  onClosed?(): void; footer?: React.ReactNode; nav?: 'tabs' | 'segments';
}>) {
  const { colors } = useTheme();
  return <SheetFrame open={open} title={title} onClose={onClose} onClosed={onClosed} fill={nav === 'tabs' ? 'surfaceSheetBody' : 'surfaceSheet'}>
    {nav === 'tabs' ? <View style={{ backgroundColor: colors.surfaceSheetNav, borderBottomWidth: geometry.hairline,
      borderBottomColor: colors.borderSubtle, paddingTop: space.md, paddingBottom: space.sm, paddingHorizontal: space.xxl + space.sm }}>
      <View accessibilityRole="tablist" accessibilityLabel={title}
        style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: space.hair }}>
        {sections.map(s => <IconTab key={s.id} label={s.label} icon={s.icon} selected={s.id === section} onPress={() => onSection(s.id)} />)}
      </View>
      <View style={{ position: 'absolute', top: space.md, right: space.md }}>
        <IconButton label={`Close ${title}`} icon="xmark" onPress={onClose} />
      </View>
    </View> : <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md + space.hair,
      paddingHorizontal: space.lg + space.xs, paddingTop: space.lg + space.hair, paddingBottom: space.md + space.hair }}>
      <Text variant="headline">{title}</Text>
      <View accessibilityRole="tablist" accessibilityLabel={title} style={{ flexDirection: 'row', gap: space.hair,
        padding: space.hair, borderRadius: radius.field, backgroundColor: colors.fillControl }}>
        {sections.map(s => <SegmentTab key={s.id} label={s.label} badge={s.badge} selected={s.id === section}
          onPress={() => onSection(s.id)} />)}
      </View>
      <View style={{ flex: 1 }} />
      <IconButton label={`Close ${title}`} icon="xmark" onPress={onClose} />
    </View>}
    <View style={{ flex: 1 }}>{children}</View>
    {footer}
  </SheetFrame>;
}

function IconTab({ label, icon, selected, onPress }: { label: string; icon: SymbolName; selected: boolean; onPress(): void }) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} {...handlers}
    style={{ minWidth: geometry.settingsTab, paddingHorizontal: space.xs + space.hair, height: geometry.settingsTabHeight, borderRadius: radius.field,
      alignItems: 'center',
      justifyContent: 'center', gap: space.xs,
      backgroundColor: colors[selected ? 'accentSoft' : hovered ? 'fillHover' : 'fillTransparent'] }}>
    <Icon name={icon} size="large" weight="regular" tone={selected ? 'accentSoftText' : 'iconPrimary'} />
    <Text variant="caption" weight="medium" lines={1} tone={selected ? 'accentSoftText' : 'textSecondary'}>{label}</Text>
  </Pressable>;
}

function SegmentTab({ label, badge, selected, onPress }: { label: string; badge?: string; selected: boolean; onPress(): void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="tab" accessibilityLabel={badge ? `${label}, ${badge}` : label} accessibilityState={{ selected }}
    onPress={onPress}>
    <Panel fill={selected ? 'fillSelectedStrong' : 'fillTransparent'} border={null} radius="control" elevation={selected ? 'tab' : 'none'}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair, height: geometry.control,
        paddingHorizontal: space.md + space.hair }}>
        <Text weight="medium" tone={selected ? 'textPrimary' : 'textSecondary'}>{label}</Text>
        {!!badge && <View style={{ paddingHorizontal: space.xs + space.hair, borderRadius: radius.pill, backgroundColor: colors.accent }}>
          <Text variant="caption" weight="semibold" tone="textOnAccent">{badge}</Text>
        </View>}
      </View>
    </Panel>
  </Pressable>;
}

/** What lets a row in a sheet bring itself into view (a search result being shown). */
type SheetScroll = { content: React.RefObject<View | null>; scrollTo(y: number): void };
const SheetScrollContext = createContext<SheetScroll | null>(null);
export const useSheetScroll = () => useContext(SheetScrollContext);

/** Scrollable content for one Sheet section. */
export function SheetBody({ children, inset = space.huge, top = space.xl }: React.PropsWithChildren<{ inset?: number; top?: number }>) {
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const value = React.useMemo<SheetScroll>(() => ({ content, scrollTo: y => scroll.current?.scrollTo({ y: Math.max(0, y), animated: true }) }), []);
  return <SheetScrollContext.Provider value={value}>
    <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: inset, paddingTop: top,
      paddingBottom: space.xl }}>
      <View ref={content}>{children}</View>
    </ScrollView>
  </SheetScrollContext.Provider>;
}
