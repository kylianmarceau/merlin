import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import type { SpaceSwatch } from '../../state/actions';
import { maxSpaces, spaceIcons, swipeOffset, swipeOutcome, type Space } from '../../state/spaces';
import { useActions, useBrowser, useSpaces } from '../../state/window';
import { newWorkspaceTheme } from '../../state/workspaceTheme';
import {
  ContextMenu, Icon, IconButton, Pressable, Text, accentLabel, accentSwatch, accents, geometry, radius, space, spring, tick, useHoverFade,
  useInteraction, useTheme, useTooltip, type ColorRole, type Swipe, type SymbolName,
} from '../ui';

/** The colours a space can take from its menu: Merlin's accent swatches, as gradients. */
export function useSpaceSwatches(): SpaceSwatch[] {
  const { dark } = useTheme();
  return useMemo(() => accents.map(name => ({ name: accentLabel(name),
    theme: newWorkspaceTheme(accentSwatch(dark ? 'dark' : 'light', name).fill) })), [dark]);
}

/** A space's icon: its SF Symbol, or the emoji it was given. */
export function SpaceIcon({ icon, tone = 'iconPrimary', size = 'small' }: { icon: string; tone?: ColorRole; size?: 'small' | 'regular' }) {
  if ((spaceIcons as readonly string[]).includes(icon) || icon === 'plus') return <Icon name={icon as SymbolName} tone={tone} size={size} weight="semibold" />;
  return <Text variant={size === 'small' ? 'caption' : 'body'}>{icon}</Text>;
}

/**
 * The space sliding with the fingers, as Arc's and Zen's do: two fingers
 * sideways move the space showing; let go past a quarter of the width (a
 * quick flick counts) and it slides out as the next one slides in, and past
 * the last space a new one is made (Zen's add swipe). A space chosen any
 * other way slides in a little from its side. `width` is the area's.
 */
export function useSpaceSlide(width: number) {
  const actions = useActions();
  const { spaces, active } = useSpaces();
  const { reduceMotion } = useTheme();
  const swatches = useSpaceSwatches();
  const move = useBrowser(s => s.spaceMove);
  const x = useRef(new Animated.Value(0)).current;
  const [hint, setHint] = useState<{ side: 'left' | 'right'; space: Space | null } | null>(null);
  const latest = useRef({ spaces, active, width, swatches, reduceMotion });
  latest.current = { spaces, active, width, swatches, reduceMotion };
  // A swipe slides its own spaces in; a click's slide waits until it is done.
  const swiping = useRef(false);
  const seen = useRef(move?.serial ?? 0);
  useEffect(() => {
    if (!move || move.serial === seen.current) return;
    seen.current = move.serial;
    if (swiping.current || reduceMotion) return;
    x.setValue(move.direction * geometry.spaceSlide);
    const run = Animated.spring(x, { toValue: 0, ...spring.space, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [move, reduceMotion, x]);

  const settle = () => Animated.spring(x, { toValue: 0, ...spring.space, useNativeDriver: true }).start();
  const onSwipe = (swipe: Swipe) => {
    const { spaces, active, width, swatches, reduceMotion } = latest.current;
    if (!active || width <= 0) return;
    const index = spaces.findIndex(s => s.id === active.id);
    if (swipe.phase === 'begin' || swipe.phase === 'move') {
      x.stopAnimation();
      x.setValue(swipeOffset(swipe.dx, index, spaces.length, width));
      const step = swipe.dx < 0 ? 1 : -1;
      const to = spaces[index + step];
      setHint(swipe.dx === 0 ? null : to ? { side: step > 0 ? 'right' : 'left', space: to }
        : step > 0 && spaces.length < maxSpaces ? { side: 'right', space: null } : null);
      return;
    }
    setHint(null);
    const outcome = swipe.phase === 'cancel' ? { kind: 'stay' as const } : swipeOutcome(swipe.dx, swipe.velocity, width, index, spaces.length);
    if (outcome.kind === 'stay') { settle(); return; }
    tick('alignment');
    const direction = outcome.kind === 'create' || outcome.to > index ? 1 : -1;
    const go = () => outcome.kind === 'create'
      ? void actions.spaces.createSpace(undefined, swatches[spaces.length % Math.max(1, swatches.length)]?.theme ?? null)
      : void actions.spaces.switchSpace(spaces[outcome.to].id, direction);
    if (reduceMotion) { x.setValue(0); go(); return; }
    swiping.current = true;
    Animated.spring(x, { toValue: -direction * width, ...spring.space, useNativeDriver: true }).start(() => {
      x.setValue(direction * width);
      go();
      Animated.spring(x, { toValue: 0, ...spring.space, useNativeDriver: true }).start(() => { swiping.current = false; });
    });
  };
  const span = Math.max(1, width);
  const opacity = x.interpolate({ inputRange: [-span, 0, span], outputRange: [0, 1, 0], extrapolate: 'clamp' });
  return { x, opacity, hint, onSwipe, enabled: !!active };
}

/** Where the fingers are taking the space: the next one's name at the edge it comes from, or New Space past the last. */
export function SpaceHint({ hint, x, width }: { hint: { side: 'left' | 'right'; space: Space | null } | null; x: Animated.Value; width: number }) {
  const { colors } = useTheme();
  if (!hint || width <= 0) return null;
  const reach = width * 0.25;
  const shown = x.interpolate({ inputRange: hint.side === 'right' ? [-reach, 0] : [0, reach],
    outputRange: hint.side === 'right' ? [1, 0] : [0, 1], extrapolate: 'clamp' });
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', opacity: shown,
    ...(hint.side === 'right' ? { right: space.xs } : { left: space.xs }) }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, height: geometry.spaceButton, paddingHorizontal: space.sm,
      borderRadius: radius.pill, backgroundColor: colors.tabActive, borderWidth: geometry.hairline, borderColor: colors.tabActiveBorder }}>
      <SpaceIcon icon={hint.space?.icon ?? 'plus'} tone="iconSecondary" />
      <Text variant="caption" tone="textSecondary" lines={1}>{hint.space?.name ?? 'New Space'}</Text>
    </View>
  </Animated.View>;
}

/**
 * The space's heading over its tabs, as in Arc: its icon and name. Double-click
 * renames it; right-click, or the ⋯ that shows on hover, opens its menu.
 */
export function SpaceHeading({ space: current }: { space: Space }) {
  const actions = useActions();
  const swatches = useSpaceSwatches();
  const { reduceMotion } = useTheme();
  const { hovered, handlers } = useInteraction();
  const more = useHoverFade(hovered, reduceMotion);
  const menu = () => void actions.spaceMenu(current.id, swatches);
  return <ContextMenu onOpen={menu}>
    <View onDoubleClick={() => actions.nameGroup({ kind: 'renameSpace', spaceId: current.id })}>
    <Pressable accessibilityRole="header" accessibilityLabel={`Space ${current.name}`} {...handlers}
      style={{ flexDirection: 'row', alignItems: 'center', gap: geometry.tabRowTitleGap, height: geometry.spaceHeading,
        paddingLeft: geometry.tabRowInset, paddingRight: space.xs, borderRadius: radius.row }}>
      <SpaceIcon icon={current.icon} tone="iconSecondary" />
      <Text variant="bodyStrong" tone="textSecondary" lines={1} flex={1}>{current.name}</Text>
      <Animated.View style={{ opacity: more }}>
        <IconButton label={`${current.name} menu`} tip="Space menu" icon="ellipsis" size="small" onPress={menu} />
      </Animated.View>
    </Pressable>
    </View>
  </ContextMenu>;
}

/** One space's button in the switcher: its icon, bright when it shows; a dot when they don't all fit. */
function SpaceButton({ item, active, dot }: { item: Space; active: boolean; dot: boolean }) {
  const actions = useActions();
  const swatches = useSpaceSwatches();
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  const ref = useRef<View>(null);
  const tooltip = useTooltip({ text: item.name }, ref);
  return <ContextMenu onOpen={() => void actions.spaceMenu(item.id, swatches)}>
    <Pressable ref={ref} accessibilityRole="tab" accessibilityLabel={item.name} accessibilityState={{ selected: active }} {...handlers}
      onHoverIn={() => { handlers.onHoverIn(); tooltip.enter(); }} onHoverOut={() => { handlers.onHoverOut(); tooltip.leave(); }}
      onPress={() => { tooltip.press(); void actions.spaces.switchSpace(item.id); }}
      style={{ width: dot ? geometry.spaceButton / 2 + space.hair : geometry.spaceButton, height: geometry.spaceButton,
        borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
        backgroundColor: !dot && hovered ? colors.tabHover : colors.fillTransparent }}>
      {dot
        ? <View style={{ width: geometry.spaceDot, height: geometry.spaceDot, borderRadius: radius.pill,
          backgroundColor: colors[active ? 'iconPrimary' : hovered ? 'iconSecondary' : 'iconDisabled'] }} />
        : <SpaceIcon icon={item.icon} tone={active ? 'iconPrimary' : hovered ? 'iconSecondary' : 'iconDisabled'} />}
    </Pressable>
  </ContextMenu>;
}

/**
 * Arc's space switcher, in the sidebar's bottom row: a button per space, the
 * one showing brightest; dots once the icons no longer fit. A two-finger
 * swipe over the tabs goes to the next one too.
 */
export function SpaceSwitcher() {
  const { spaces, active } = useSpaces();
  const [room, setRoom] = useState(0);
  if (!active) return <View style={{ flex: 1 }} />;
  const dot = room > 0 && spaces.length * geometry.spaceButton > room;
  return <View accessibilityRole="tablist" accessibilityLabel="Spaces" onLayout={e => setRoom(e.nativeEvent.layout.width)}
    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {spaces.map(item => <SpaceButton key={item.id} item={item} active={item.id === active.id} dot={dot} />)}
  </View>;
}

/** New Space, beside the switcher, as in Arc: names it, with the next colour. */
export function NewSpaceButton() {
  const actions = useActions();
  const swatches = useSpaceSwatches();
  const { spaces, active } = useSpaces();
  if (!active) return null;
  return <IconButton label="New Space" icon="plus" disabled={spaces.length >= maxSpaces}
    onPress={() => actions.nameGroup({ kind: 'newSpace', theme: swatches[spaces.length % Math.max(1, swatches.length)]?.theme ?? null })} />;
}

/**
 * With tabs on top, the space showing at the start of the strip, as Zen
 * shows it when its sidebar is collapsed: its icon and name; a click lists
 * the spaces, a right-click opens its menu. A two-finger swipe over the
 * strip goes to the next space, or past the last makes one.
 */
export function SpaceChip() {
  const actions = useActions();
  const swatches = useSpaceSwatches();
  const { colors } = useTheme();
  const { active } = useSpaces();
  const { hovered, handlers } = useInteraction();
  const ref = useRef<View>(null);
  const tooltip = useTooltip({ text: 'Spaces', detail: 'Swipe with two fingers to change space' }, ref);
  if (!active) return null;
  return <ContextMenu onOpen={() => void actions.spaceMenu(active.id, swatches)}>
    <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={`Space ${active.name}`} {...handlers}
      onHoverIn={() => { handlers.onHoverIn(); tooltip.enter(); }} onHoverOut={() => { handlers.onHoverOut(); tooltip.leave(); }}
      onPress={() => { tooltip.press(); void actions.spaceSwitchMenu(swatches); }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + space.hair, height: geometry.stripTabHeight,
        paddingHorizontal: space.sm, borderRadius: radius.tab, maxWidth: geometry.stripTabActive,
        backgroundColor: hovered ? colors.tabHover : colors.fillTransparent }}>
      <SpaceIcon icon={active.icon} tone="iconSecondary" />
      <Text variant="label" tone="textSecondary" lines={1}>{active.name}</Text>
    </Pressable>
  </ContextMenu>;
}
