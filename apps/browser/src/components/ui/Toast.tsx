import React from 'react';
import { Animated, Pressable, View } from 'react-native';
import { Icon } from './Icon';
import { duration, presenceStyle, usePresence, useTimeout } from './motion';
import { Panel } from './Panel';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, space } from './tokens';

export type ToastItem = { id: number; tone: 'error' | 'info'; text: string };

/** Short notices at the bottom of the window. They leave on their own or on click. */
export function ToastStack({ toasts, onDismiss }: { toasts: readonly ToastItem[]; onDismiss(id: number): void }) {
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: space.lg, alignItems: 'center', gap: space.sm }}>
    {toasts.map(t => <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />)}
  </View>;
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss(): void }) {
  const { reduceMotion } = useTheme();
  const { progress } = usePresence(true, 'toast', reduceMotion);
  useTimeout(onDismiss, duration.toast, [toast.id]);
  return <Animated.View style={[{ width: geometry.toastWidth }, presenceStyle(progress, 'toast')]}>
    <Pressable accessibilityRole="alert" accessibilityLabel={toast.text} onPress={onDismiss}>
      <Panel fill="surfaceToast" radius="card" elevation="toast" border={null}>
        <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm,
          paddingHorizontal: space.md, paddingVertical: space.sm + space.hair }}>
          <Icon name={toast.tone === 'error' ? 'exclamationmark.triangle' : 'info.circle'} tone={toast.tone === 'error' ? 'danger' : 'textOnToast'} size="small" />
          <Text tone="textOnToast" flex={1}>{toast.text}</Text>
        </View>
      </Panel>
    </Pressable>
  </Animated.View>;
}
