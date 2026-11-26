// Setup's controls, drawn as Ardia's onboarding draws them (Buttons.tsx,
// OptionCard.tsx, ChoiceCard.tsx, Parts.tsx; Apache-2.0, see NOTICE): pill
// buttons, cards that lift when chosen, ring radios and checks.
import React, { createContext, useContext } from 'react';
import { Animated, View, type ViewStyle } from 'react-native';
import {
  Icon, Plate, Pressable, Text, font, geometry, opacity, pressScale, radius, setupGeometry as G, setupInk, shadow, space, usePressScale,
  useInteraction, useTheme, type SetupInk, type SymbolName,
} from '../ui';

const InkContext = createContext<SetupInk>(setupInk.dark);
export const SetupInkScope = InkContext.Provider;
export const useSetupInk = () => useContext(InkContext);

/** A card's fill, edge and lift: plain at rest, lit under the pointer or when chosen. */
export function ChoiceCard({ selected = false, hovered = false, focused = false, strong = false, r = radius.card, style, children }: {
  selected?: boolean; hovered?: boolean; focused?: boolean; strong?: boolean; r?: number; style?: ViewStyle | ViewStyle[]; children?: React.ReactNode;
}) {
  const ink = useSetupInk();
  const { dark, colors } = useTheme();
  const lit = selected || hovered;
  const drop = selected ? shadow.menu : shadow.tab;
  return <View style={style}>
    <Plate fill={lit ? ink.tileLit : ink.tile} radius={r} edge={focused ? colors.focusRing : selected && strong ? ink.tileBorderSelected : ink.tileBorder}
      edgeWidth={focused ? geometry.focusRing : geometry.hairline}
      shadow={{ color: colors.shadowColor, opacity: (dark ? 2.5 : 0.6) * drop.opacity, radius: drop.radius, offsetY: drop.offsetY }}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    {children}
  </View>;
}

export function Radio({ on }: { on: boolean }) {
  const ink = useSetupInk();
  return <View style={{ width: G.radioRing, height: G.radioRing, borderRadius: G.radioRing / 2, borderWidth: on ? G.radioOn : G.radioOff,
    borderColor: on ? ink.radioOn : ink.radioBorder, backgroundColor: ink.radioFill }} />;
}

/** A round check: an empty ring, or filled with a tick. */
export function CheckRing({ on, small = false }: { on: boolean; small?: boolean }) {
  const ink = useSetupInk();
  const side = small ? geometry.iconMedium : geometry.iconLarge;
  return <View style={{ width: side, height: side, borderRadius: side / 2, alignItems: 'center', justifyContent: 'center',
    borderWidth: on ? 0 : G.radioOff, borderColor: ink.radioBorder, backgroundColor: on ? ink.radioOn : ink.radioFill }}>
    {on && <Icon name="checkmark" size="tiny" weight="bold" tone="textInverse" />}
  </View>;
}

function Press({ label, onPress, disabled, depth = pressScale.control, children, role = 'button', state }: {
  label: string; onPress?: () => void; disabled?: boolean; depth?: number; role?: 'button' | 'radio' | 'checkbox';
  state?: { selected?: boolean; checked?: boolean; disabled?: boolean };
  children: (s: { hovered: boolean; focused: boolean }) => React.ReactNode;
}) {
  const { reduceMotion } = useTheme();
  const { hovered, focused, handlers } = useInteraction();
  const [down, setDown] = React.useState(false);
  const scale = usePressScale(down, depth, reduceMotion);
  return <Pressable accessibilityRole={role} accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, ...state }} disabled={disabled}
    onPress={onPress} {...handlers} onPressIn={() => setDown(true)} onPressOut={() => setDown(false)}
    style={{ opacity: disabled ? opacity.disabled : 1 }}>
    <Animated.View style={{ transform: [{ scale }] }}>{children({ hovered: hovered && !disabled, focused })}</Animated.View>
  </Pressable>;
}

export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const ink = useSetupInk();
  return <Press label={label} onPress={onPress} disabled={disabled}>
    {({ hovered, focused }) => <View style={{ height: G.button, borderRadius: G.button / 2, paddingHorizontal: G.buttonPad, alignItems: 'center',
      justifyContent: 'center', backgroundColor: hovered ? ink.primaryHover : ink.primary, borderWidth: focused ? geometry.focusRing : 0, borderColor: ink.radioBorder }}>
      <Text weight="semibold" style={{ color: ink.primaryText }}>{label}</Text>
    </View>}
  </Press>;
}

export function SecondaryButton({ label, onPress, disabled, filled }: { label: string; onPress: () => void; disabled?: boolean; filled?: boolean }) {
  const ink = useSetupInk();
  return <Press label={label} onPress={onPress} disabled={disabled}>
    {({ hovered, focused }) => <View style={{ height: G.button, borderRadius: G.button / 2, paddingHorizontal: G.buttonPadSecondary, alignItems: 'center',
      justifyContent: 'center', backgroundColor: filled ? hovered ? ink.buttonHover : ink.button : hovered ? ink.outlinedHover : ink.radioFill,
      borderWidth: filled ? 0 : focused ? geometry.focusRing : geometry.hairline, borderColor: focused ? ink.radioBorder : ink.outlineBorder }}>
      <Text weight="medium" style={{ color: filled ? ink.title : ink.outlineText }}>{label}</Text>
    </View>}
  </Press>;
}

export function CircleButton({ label, icon, onPress, disabled }: { label: string; icon: SymbolName; onPress: () => void; disabled?: boolean }) {
  const ink = useSetupInk();
  return <Press label={label} onPress={onPress} disabled={disabled} depth={pressScale.icon}>
    {({ hovered, focused }) => <View style={{ width: G.button, height: G.button, borderRadius: G.button / 2, alignItems: 'center', justifyContent: 'center',
      backgroundColor: hovered ? ink.outlinedHover : ink.radioFill, borderWidth: focused ? geometry.focusRing : geometry.hairline, borderColor: ink.outlineBorder }}>
      <Icon name={icon} size="small" weight="semibold" tone="textSecondary" />
    </View>}
  </Press>;
}

/** A quiet text action, such as "Have a setup code?". */
export function TextButton({ label, icon, onPress }: { label: string; icon?: SymbolName; onPress: () => void }) {
  const ink = useSetupInk();
  return <Press label={label} onPress={onPress}>
    {({ hovered }) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, height: G.button }}>
      {icon && <Icon name={icon} size="small" tone="textSecondary" />}
      <Text weight="medium" style={{ color: hovered ? ink.title : ink.subtitle }}>{label}</Text>
    </View>}
  </Press>;
}

/** One of a question's answers. */
export function OptionCard({ title, detail, selected, onPress }: { title: string; detail?: string; selected: boolean; onPress: () => void }) {
  const ink = useSetupInk();
  return <Press label={detail ? title + ', ' + detail : title} onPress={onPress} role="radio" state={{ selected }}>
    {({ hovered, focused }) => <ChoiceCard selected={selected} hovered={hovered} focused={focused} style={{ flexDirection: 'row', alignItems: 'center',
      gap: space.md, minHeight: G.choiceHeight, paddingVertical: space.sm + space.hair, paddingHorizontal: space.lg }}>
      <Radio on={selected} />
      <View style={{ flex: 1, gap: space.hair }}>
        <Text weight="medium" style={{ color: ink.title }}>{title}</Text>
        {detail && <Text variant="label" weight="regular" lines={2} style={{ color: ink.rowSubtitle }}>{detail}</Text>}
      </View>
    </ChoiceCard>}
  </Press>;
}

/** An answer that is on or off, with an optional icon tile. */
export function CheckCard({ title, detail, icon, value, onChange, disabled }: {
  title: string; detail?: string; icon?: SymbolName; value: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  const ink = useSetupInk();
  return <Press label={title} onPress={() => onChange(!value)} disabled={disabled} role="checkbox" state={{ checked: value }}>
    {({ hovered, focused }) => <ChoiceCard hovered={hovered} focused={focused} style={{ flexDirection: 'row', alignItems: 'center',
      gap: space.md, minHeight: detail ? G.choiceHeight : geometry.rowTall, paddingVertical: space.sm, paddingHorizontal: space.md }}>
      {icon && <View style={{ width: geometry.tile, height: geometry.tile, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center',
        backgroundColor: ink.iconContainer }}><Icon name={icon} size="small" tone="textPrimary" /></View>}
      <View style={{ flex: 1, gap: space.hair }}>
        <Text weight="medium" style={{ color: ink.title }}>{title}</Text>
        {detail && <Text variant="label" weight="regular" lines={2} style={{ color: ink.rowSubtitle }}>{detail}</Text>}
      </View>
      <CheckRing on={value} />
    </ChoiceCard>}
  </Press>;
}

/** A row with a label and segmented choices, as Ardia's "Peek a link with". */
export function SegmentRow<T extends string>({ title, value, options, onChange }: {
  title: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void;
}) {
  const ink = useSetupInk();
  const { colors } = useTheme();
  return <ChoiceCard style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: G.button, paddingVertical: space.xs + space.hair, paddingHorizontal: space.md }}>
    <Text variant="label" style={{ flex: 1, color: ink.title }}>{title}</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ flexDirection: 'row', gap: space.hair, padding: space.hair,
      borderRadius: radius.control, backgroundColor: ink.button }}>
      {options.map(([id, label]) => <Press key={id} label={label} onPress={() => onChange(id)} role="radio" state={{ selected: id === value }}>
        {({ hovered }) => <View style={{ minWidth: geometry.controlLarge, height: geometry.controlCompact - space.hair, paddingHorizontal: space.sm,
          alignItems: 'center', justifyContent: 'center', borderRadius: radius.xs + space.hair,
          backgroundColor: id === value ? ink.card : hovered ? ink.outlinedHover : colors.fillTransparent }}>
          <Text variant="caption" weight={id === value ? 'semibold' : 'medium'} style={{ color: id === value ? ink.title : ink.subtitle }}>{label}</Text>
        </View>}
      </Press>)}
    </View>
  </ChoiceCard>;
}

export function Tag({ title }: { title: string }) {
  const ink = useSetupInk();
  return <View style={{ alignSelf: 'flex-start', height: G.tagHeight, paddingHorizontal: space.sm, borderRadius: G.tagHeight / 2, justifyContent: 'center',
    backgroundColor: ink.button }}>
    <Text variant="caption" weight="semibold" style={{ color: ink.title }}>{title}</Text>
  </View>;
}

export const setupType = {
  title: { fontSize: G.headingSize, lineHeight: G.headingLine, letterSpacing: G.tracking, fontWeight: font.weight.light },
} as const;
