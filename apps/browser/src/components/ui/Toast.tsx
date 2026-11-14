import React from 'react';
import { Animated, Pressable, View } from 'react-native';
import { duration, presenceStyle, usePresence, useTimeout } from './motion';
import { Panel } from './Panel';
import { Text } from './Text';
import { useTheme } from './theme';
import { geometry, radius, space } from './tokens';

export type ToastItem = { id: number; tone: 'error' | 'info'; text: string; action?: { label: string; run(): void } };

/** Short notices at the bottom centre of the window. They leave on their own or on click. */
export function ToastStack({ toasts, onDismiss }: { toasts: readonly ToastItem[]; onDismiss(id: number): void }) {
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: space.lg + space.xs, alignItems: 'center',
    gap: space.sm }}>
    {toasts.map(t => <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />)}
  </View>;
}

/** A dark capsule: a dot for its kind, then the words. */
function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss(): void }) {
  const { colors, reduceMotion } = useTheme();
  const { progress } = usePresence(true, 'toast', reduceMotion);
  useTimeout(onDismiss, duration.toast, [toast.id]);
  return <Animated.View style={[{ maxWidth: geometry.dialogWide }, presenceStyle(progress, 'toast')]}>
    <Pressable accessibilityRole="alert" accessibilityLabel={toast.text} onPress={onDismiss}>
      <Panel fill="surfaceToast" radius="pill" elevation="toast" border={null}>
        <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + space.hair,
          minHeight: geometry.toastHeight, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
          <View style={{ width: geometry.dot, height: geometry.dot, borderRadius: radius.pill,
            backgroundColor: colors[toast.tone === 'error' ? 'notice' : 'accentSoft'] }} />
          <Text tone="textOnToast" weight="medium" style={{ flexShrink: 1 }}>{toast.text}</Text>
          {toast.action && <Pressable accessibilityRole="button" accessibilityLabel={toast.action.label}
            onPress={() => { toast.action?.run(); onDismiss(); }}>
            <Text tone="textOnToast" weight="semibold" style={{ textDecorationLine: 'underline' }}>{toast.action.label}</Text>
          </Pressable>}
        </View>
      </Panel>
    </Pressable>
  </Animated.View>;
}
