import React, { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import {
  Field, Glyph, Pressable, Text, geometry, radius, settingsArt, settingsGeometry as size, space, useEscape, useInteraction, useTheme, useTooltip,
} from '../ui';
import { SettingsIcon } from './SettingsIcon';
import { sections, type SettingsSection } from './navigation';

type LayoutProps = React.PropsWithChildren<{
  section: SettingsSection; query: string; version: string | null; icon?: string; canBack: boolean; canForward: boolean;
  onSection(id: SettingsSection): void; onSearch(query: string): void; onStep(by: -1 | 1): void; onClose(): void;
}>;

export function SettingsLayout({ section, query, version, icon, canBack, canForward, onSection, onSearch, onStep, onClose, children }: LayoutProps) {
  const { colors } = useTheme();
  const [compact, setCompact] = useState(false);
  const searching = !!query.trim();
  const title = searching ? 'Search Results' : sections.find(s => s.id === section)!.label;
  const escape = useEscape(onClose);
  const search = <Field icon="magnifyingglass" pill accessibilityLabel="Search Settings" placeholder="Search Settings"
    onKeyPress={e => { if (e.nativeEvent.key === 'Escape') escape(); }}
    value={query} onChangeText={onSearch} />;
  return <View onLayout={e => setCompact(e.nativeEvent.layout.width < size.compactWidth)} style={{ flex: 1, flexDirection: 'row' }}>
    <View style={{ width: compact ? size.rail : size.sidebar, paddingHorizontal: space.md - space.hair, backgroundColor: colors.surfaceSheetNav }}>
      <View style={{ height: size.bar, justifyContent: 'center', alignItems: compact ? 'center' : 'flex-start' }}>
        <CloseSettings onPress={onClose} />
      </View>
      {!compact && <View style={{ marginTop: space.md }}>{search}</View>}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: space.md, paddingBottom: space.lg }}>
        <View accessibilityRole="tablist" accessibilityLabel="Settings">
          {sections.map(item => <Category key={item.id} item={item} compact={compact} version={version} icon={icon}
            selected={!searching && item.id === section} onPress={() => onSection(item.id)} />)}
        </View>
      </ScrollView>
    </View>
    <View style={{ width: geometry.hairline, backgroundColor: colors.surfaceBorder }} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <View style={{ height: size.bar, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill,
          backgroundColor: colors.roundFill, borderWidth: geometry.hairline, borderColor: colors.borderDefault }}>
          <HistoryArrow forward={false} enabled={canBack} onPress={() => onStep(-1)} />
          <View style={{ width: geometry.hairline, height: space.lg + space.xs, backgroundColor: colors.borderDefault }} />
          <HistoryArrow forward enabled={canForward} onPress={() => onStep(1)} />
        </View>
        <Text variant="title" flex={1} lines={1}>{title}</Text>
      </View>
      {compact && <View style={{ marginHorizontal: space.lg, marginBottom: space.sm }}>{search}</View>}
      {children}
    </View>
  </View>;
}

function CloseSettings({ onPress }: { onPress(): void }) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel="Close Settings" onPress={onPress} {...handlers}
    style={{ width: size.arrowButton, height: size.arrowButton, alignItems: 'center', justifyContent: 'center',
      borderRadius: radius.pill, borderWidth: geometry.hairline, borderColor: focused ? colors.focusRing : colors.fillTransparent }}>
    <View style={{ width: size.close, height: size.close, borderRadius: radius.pill, backgroundColor: settingsArt.close,
      alignItems: 'center', justifyContent: 'center', borderWidth: geometry.hairline, borderColor: settingsArt.closeEdge }}>
      {(hovered || focused) && <Glyph name="xmark" color={settingsArt.closeGlyph} size={geometry.roundGlyph} weight="bold" />}
    </View>
  </Pressable>;
}

function HistoryArrow({ forward, enabled, onPress }: { forward: boolean; enabled: boolean; onPress(): void }) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel={forward ? 'Forward' : 'Back'}
    accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={onPress} {...handlers}
    style={{ width: size.arrowButton, height: size.arrowButton - space.hair, alignItems: 'center', justifyContent: 'center',
      borderRadius: radius.pill, backgroundColor: hovered && enabled ? colors.fillHover : colors.fillTransparent,
      borderWidth: geometry.hairline, borderColor: focused ? colors.focusRing : colors.fillTransparent }}>
    <Glyph name={forward ? 'chevron.right' : 'chevron.left'} color={enabled ? colors.iconPrimary : colors.iconDisabled} size={size.arrow} />
  </Pressable>;
}

function Category({ item, compact, selected, version, icon, onPress }: {
  item: typeof sections[number]; compact: boolean; selected: boolean; version: string | null; icon?: string; onPress(): void;
}) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = useInteraction();
  const ref = useRef<View>(null);
  const tip = useTooltip(compact ? { text: item.label } : null, ref);
  const about = item.id === 'about';
  const badge = about && !compact ? geometry.controlLarge : size.badge;
  const groupStart = ['general', 'appearance', 'blocking', 'config'].includes(item.id);
  return <Pressable ref={ref} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected }} onPress={onPress} {...handlers}
    onHoverIn={() => { handlers.onHoverIn(); tip.enter(); }} onHoverOut={() => { handlers.onHoverOut(); tip.leave(); }} onPressIn={tip.press}
    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: compact ? 'center' : 'flex-start',
      gap: space.sm, minHeight: about ? geometry.rowTall : size.category, paddingHorizontal: compact ? 0 : space.sm - space.hair,
      marginTop: groupStart ? space.md : 0, borderRadius: radius.control, borderWidth: geometry.hairline,
      borderColor: focused ? colors.focusRing : colors.fillTransparent,
      backgroundColor: colors[selected ? 'fillSelected' : hovered ? 'fillHover' : 'fillTransparent'] }}>
    <SettingsIcon section={item.id} appIcon={icon} size={badge} />
    {!compact && <View style={{ flex: 1 }}>
      <Text tone="tabText" weight={selected ? 'semibold' : 'regular'}>{about ? 'Merlin' : item.label}</Text>
      {about && <Text variant="caption">{version ? 'Version ' + version : 'About Merlin'}</Text>}
    </View>}
  </Pressable>;
}
