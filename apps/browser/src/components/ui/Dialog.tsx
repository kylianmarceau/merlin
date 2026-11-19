import React from 'react';
import { Animated, ScrollView, View } from 'react-native';
import { Pressable } from './Pressable';
import { RoundButton } from './Button';
import { type SymbolName } from './Icon';
import { presenceStyle, useLatest, usePresence } from './motion';
import { popoverInset } from './Menu';
import { Panel } from './Panel';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, space, type ColorRole } from './tokens';

export type DialogProps = {
  open?: boolean; title: string; subtitle?: string;
  /** Kept for callers; dialogs lead with their words, not an icon. */
  icon?: SymbolName; iconTone?: ColorRole;
  actions?: React.ReactNode; onClose?: () => void;
  /** "top" drops from the top of the page, like a page's own alert; "center" is for window questions. */
  place?: 'center' | 'top'; width?: keyof typeof geometry; dismissOnScrim?: boolean; children?: React.ReactNode;
  /** The content draws its own heading. */
  bare?: boolean;
};

/** A blocking question on glass over a dimmed window, with its pill actions at the bottom right. */
export function Dialog({ open = true, title, subtitle, actions, onClose, place = 'center', width = 'dialog', dismissOnScrim = false,
  children, bare = false }: DialogProps) {
  const { colors, reduceMotion } = useTheme();
  const { mounted, progress } = usePresence(open, 'dialog', reduceMotion);
  const body = useLatest(open ? { title, subtitle, actions, children } : null);
  if (!mounted || !body) return null;
  return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center',
    justifyContent: place === 'top' ? 'flex-start' : 'center', paddingTop: place === 'top' ? space.sm + space.xs : 0 }}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: progress }}>
      <Pressable accessible={false} style={{ flex: 1, backgroundColor: colors.scrim }}
        onPress={() => { if (dismissOnScrim && open) onClose?.(); }} />
    </Animated.View>
    <Animated.View style={[{ width: geometry[width], maxWidth: '90%', maxHeight: '85%' }, presenceStyle(progress, place === 'top' ? 'popover' : 'dialog')]}
      keyDownEvents={[{ key: 'Escape' }]} onKeyDown={e => { if (e.nativeEvent.key === 'Escape' && open) onClose?.(); }}>
      <Panel glass fill="surfaceDialog" radius="dialog" elevation="dialog" accessibilityLabel={body.title} accessibilityViewIsModal>
        <View style={{ paddingHorizontal: popoverInset, paddingTop: popoverInset - space.hair, paddingBottom: space.md + space.hair, gap: space.md }}>
          {!bare && <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
            <View style={{ flex: 1, gap: space.xs }}>
              <Text variant="title">{body.title}</Text>
              {!!body.subtitle && <Text tone="textSecondary" lines={2}>{body.subtitle}</Text>}
            </View>
            {onClose && <RoundButton label="Close" icon="xmark" soft onPress={onClose} />}
          </View>}
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.md }}>{body.children}</ScrollView>
          {body.actions && <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end', flexWrap: 'wrap',
            paddingTop: space.xs }}>{body.actions}</View>}
        </View>
      </Panel>
    </Animated.View>
  </View>;
}
