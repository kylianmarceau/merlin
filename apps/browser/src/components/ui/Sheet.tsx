import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import { IconButton } from './Button';
import { Icon, type SymbolName } from './Icon';
import { useInteraction } from './interaction';
import { duration, presenceStyle, useLatest, usePresence } from './motion';
import { Panel } from './Panel';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, radius, space } from './tokens';

export type SheetSection<K extends string> = { id: K; label: string; icon: SymbolName; badge?: string };

/**
 * A large centred surface over a dimmed window. Settings shows its sections as
 * icon tabs across the top; the Library as a segmented control beside its
 * title. Both share one frame and one motion.
 *
 * It takes the keyboard as it opens, so Escape closes it: opened from a
 * button or Command-comma, the keyboard stayed in the page, which never
 * passed Escape on. `onClosed` gives it back (to the page) once it closes.
 */
export function Sheet<K extends string>({ open = true, title, sections, section, onSection, onClose, onClosed, children, footer,
  nav = 'tabs' }: {
  open?: boolean; title: string; sections: readonly SheetSection<K>[]; section: K; onSection(id: K): void; onClose(): void;
  onClosed?(): void; children?: React.ReactNode; footer?: React.ReactNode; nav?: 'tabs' | 'segments';
}) {
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
  return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: progress }}>
      <Pressable accessible={false} style={{ flex: 1, backgroundColor: colors.scrim }} onPress={() => { if (open) onClose(); }} />
    </Animated.View>
    <Animated.View style={[{ width: geometry.sheetWidth, maxWidth: '94%', height: geometry.sheetHeight, maxHeight: '90%' },
      presenceStyle(progress, 'sheet')]}
      keyDownEvents={[{ key: 'Escape' }]} onKeyDown={e => { if (e.nativeEvent.key === 'Escape' && open) onClose(); }}>
      <View ref={keys} focusable enableFocusRing={false} style={{ flex: 1 }}>
      <Panel fill={nav === 'tabs' ? 'surfaceSheetBody' : 'surfaceSheet'} radius="panel" elevation="dialog" accessibilityLabel={title}
        accessibilityViewIsModal style={{ flex: 1 }}>
        <View style={{ flex: 1, borderRadius: radius.panel, overflow: 'hidden' }}>
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
          <View style={{ flex: 1 }}>{body}</View>
          {footer}
        </View>
      </Panel>
      </View>
    </Animated.View>
  </View>;
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

/** Scrollable content for one Sheet section. */
export function SheetBody({ children }: React.PropsWithChildren) {
  return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.huge + space.sm, paddingTop: space.xl,
    paddingBottom: space.xl }}>{children}</ScrollView>;
}
