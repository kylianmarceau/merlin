import React from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import { IconButton } from './Button';
import { Icon, type SymbolName } from './Icon';
import { presenceStyle, useLatest, usePresence } from './motion';
import { Panel } from './Panel';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, radius, space, type ColorRole } from './tokens';

export type DialogProps = {
  open?: boolean; title: string; subtitle?: string; icon?: SymbolName; iconTone?: ColorRole;
  actions?: React.ReactNode; onClose?: () => void;
  /** "top" attaches to the top of the page, like a page's own alert; "center" is for window questions. */
  place?: 'center' | 'top'; width?: keyof typeof geometry; dismissOnScrim?: boolean; children?: React.ReactNode;
  /** The content draws its own heading. */
  bare?: boolean;
};

/** A blocking question over a dimmed window, with its actions at the bottom right. */
export function Dialog({ open = true, title, subtitle, icon, iconTone = 'accent', actions, onClose, place = 'center',
  width = 'dialog', dismissOnScrim = false, children, bare = false }: DialogProps) {
  const { colors, reduceMotion } = useTheme();
  const { mounted, progress } = usePresence(open, 'dialog', reduceMotion);
  const body = useLatest(open ? { title, subtitle, icon, actions, children } : null);
  if (!mounted || !body) return null;
  return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center',
    justifyContent: place === 'top' ? 'flex-start' : 'center', paddingTop: place === 'top' ? geometry.toolbar + space.lg : 0 }}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: progress }}>
      <Pressable accessible={false} style={{ flex: 1, backgroundColor: colors.scrim }}
        onPress={() => { if (dismissOnScrim && open) onClose?.(); }} />
    </Animated.View>
    <Animated.View style={[{ width: geometry[width], maxWidth: '90%', maxHeight: '85%' }, presenceStyle(progress, 'dialog')]}
      keyDownEvents={[{ key: 'Escape' }]} onKeyDown={e => { if (e.nativeEvent.key === 'Escape' && open) onClose?.(); }}>
      <Panel fill="surfaceDialog" radius="panel" elevation="dialog" accessibilityLabel={body.title} accessibilityViewIsModal>
        <View style={{ padding: space.xl, gap: space.lg }}>
          {!bare && <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
            {body.icon && <View style={{ width: geometry.tile, height: geometry.tile, borderRadius: radius.control,
              alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }}>
              <Icon name={body.icon} tone={iconTone} />
            </View>}
            <View style={{ flex: 1, gap: space.xs }}>
              <Text variant="title">{body.title}</Text>
              {!!body.subtitle && <Text variant="caption" lines={2}>{body.subtitle}</Text>}
            </View>
            {onClose && <IconButton label="Close" icon="xmark" size="small" onPress={onClose} />}
          </View>}
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.md }}>{body.children}</ScrollView>
          {body.actions && <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{body.actions}</View>}
        </View>
      </Panel>
    </Animated.View>
  </View>;
}
