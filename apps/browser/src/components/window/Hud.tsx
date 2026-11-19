import React, { useEffect } from 'react';
import { Animated, View } from 'react-native';
import type { Hud as HudItem } from '../../state/types';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { Icon, Panel, Pressable, Text, duration, geometry, legibleGlass, radius, space, useAppear, useLatest, useTheme, useTimeout } from '../ui';

/**
 * A short confirmation just inside the top of the page, as in Ardia: "Link copied",
 * "Added to the Bookmarks bar", or what a command had to say. It grows in
 * from 92% on a spring, stays a moment (a failure a little longer) and goes
 * on its own; it never stays behind like the old status-line note did.
 * Messages from Merlin's keyboard layer arrive here too.
 */
export function HudLayer({ top }: { top: number }) {
  const actions = useActions();
  const hud = useBrowser(s => s.hud);
  const { modal } = useSnapshot();
  // Each new message from the keyboard layer shows once.
  useEffect(() => {
    if (modal.message) actions.showHud(modal.message, modal.messageIsError ? 'error' : 'info');
  }, [modal.message, modal.messageIsError, actions]);
  const { reduceMotion } = useTheme();
  const kept = useLatest(hud);
  const motion = useAppear(!!hud, reduceMotion);
  useTimeout(() => { if (hud) actions.dismissHud(hud.id); }, hud?.tone === 'error' || hud?.action ? duration.toast : duration.hud, [hud?.id]);
  if (!kept || !motion.mounted) return null;
  return <View pointerEvents="box-none" style={{ position: 'absolute', top: top + geometry.hudTop, left: 0, right: 0, alignItems: 'center' }}>
    <Animated.View style={{ opacity: motion.opacity, transform: [{ scale: motion.scale }], maxWidth: geometry.dialogWide }}>
      <HudBody hud={kept} onDismiss={() => actions.dismissHud(kept.id)} />
    </Animated.View>
  </View>;
}

function HudBody({ hud, onDismiss }: { hud: HudItem; onDismiss(): void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="alert" accessibilityLabel={hud.text} onPress={onDismiss}>
    <Panel glass glassFloor={legibleGlass} fill="surfacePopoverSolid" radius="pill" elevation="menu">
      <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: geometry.hud,
        paddingLeft: space.md + space.hair, paddingRight: hud.action ? space.xs + space.hair : space.lg }}>
        {hud.symbol ? <Icon name={hud.symbol} tone={hud.tone === 'error' ? 'textDanger' : 'iconPrimary'} size="small" />
          : <View style={{ width: geometry.dot, height: geometry.dot, borderRadius: radius.pill,
            backgroundColor: colors[hud.tone === 'error' ? 'danger' : 'accent'] }} />}
        <Text weight="medium" tone={hud.tone === 'error' ? 'textDanger' : 'textPrimary'} lines={2} style={{ flexShrink: 1 }}>{hud.text}</Text>
        {hud.action && <Pressable accessibilityRole="button" accessibilityLabel={hud.action.label}
          onPress={() => { hud.action?.run(); onDismiss(); }}
          style={({ pressed }) => ({ height: geometry.hud - space.sm, paddingHorizontal: space.md, borderRadius: radius.pill,
            justifyContent: 'center', backgroundColor: colors[pressed ? 'fillControlPressed' : 'fillControl'] })}>
          <Text variant="label" tone="textPrimary">{hud.action.label}</Text>
        </Pressable>}
      </View>
    </Panel>
  </Pressable>;
}
