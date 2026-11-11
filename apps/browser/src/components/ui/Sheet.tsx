import React from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import { IconButton } from './Button';
import { Icon, type SymbolName } from './Icon';
import { useInteraction } from './interaction';
import { presenceStyle, useLatest, usePresence } from './motion';
import { Panel } from './Panel';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, radius, space } from './tokens';

export type SheetSection<K extends string> = { id: K; label: string; icon: SymbolName };

/**
 * A large two-pane surface: sections on the left, content on the right. Settings
 * and the Library share it, so every full panel has one frame and one motion.
 */
export function Sheet<K extends string>({ open = true, title, sections, section, onSection, onClose, children, footer }: {
  open?: boolean; title: string; sections: readonly SheetSection<K>[]; section: K; onSection(id: K): void; onClose(): void;
  children?: React.ReactNode; footer?: React.ReactNode;
}) {
  const { colors, reduceMotion } = useTheme();
  const { mounted, progress } = usePresence(open, 'sheet', reduceMotion);
  const body = useLatest(open ? children : null);
  if (!mounted) return null;
  return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: progress }}>
      <Pressable accessible={false} style={{ flex: 1, backgroundColor: colors.scrim }} onPress={() => { if (open) onClose(); }} />
    </Animated.View>
    <Animated.View style={[{ width: geometry.sheetWidth, maxWidth: '94%', height: geometry.sheetHeight, maxHeight: '90%' },
      presenceStyle(progress, 'sheet')]}
      keyDownEvents={[{ key: 'Escape' }]} onKeyDown={e => { if (e.nativeEvent.key === 'Escape' && open) onClose(); }}>
      <Panel fill="surfaceSheet" radius="panel" elevation="dialog" accessibilityLabel={title} accessibilityViewIsModal style={{ flex: 1 }}>
        <View style={{ flex: 1, flexDirection: 'row', borderRadius: radius.panel, overflow: 'hidden' }}>
          <View style={{ width: geometry.sheetNav, backgroundColor: colors.surfaceSheetNav, padding: space.md, gap: space.hair,
            borderRightWidth: geometry.hairline, borderRightColor: colors.borderSubtle }}>
            <View style={{ paddingHorizontal: space.sm, paddingTop: space.sm, paddingBottom: space.md }}>
              <Text variant="title">{title}</Text>
            </View>
            {sections.map(s => <NavItem key={s.id} label={s.label} icon={s.icon} selected={s.id === section} onPress={() => onSection(s.id)} />)}
            <View style={{ flex: 1 }} />
            {footer}
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ position: 'absolute', top: space.md, right: space.md, zIndex: 1 }}>
              <IconButton label={`Close ${title}`} icon="xmark" onPress={onClose} />
            </View>
            {body}
          </View>
        </View>
      </Panel>
    </Animated.View>
  </View>;
}

function NavItem({ label, icon, selected, onPress }: { label: string; icon: SymbolName; selected: boolean; onPress(): void }) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: geometry.row, paddingHorizontal: space.sm,
      borderRadius: radius.control, backgroundColor: colors[selected ? 'fillSelected' : hovered ? 'fillHover' : 'fillTransparent'] }}>
    <Icon name={icon} tone={selected ? 'accent' : 'iconSecondary'} size="small" />
    <Text weight={selected ? 'semibold' : 'regular'}>{label}</Text>
  </Pressable>;
}

/** Scrollable content for one Sheet section. */
export function SheetBody({ children }: React.PropsWithChildren) {
  return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.xl, paddingTop: space.xl + space.sm }}>{children}</ScrollView>;
}
