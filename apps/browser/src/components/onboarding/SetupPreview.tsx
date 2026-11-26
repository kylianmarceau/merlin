import React from 'react';
import { Image, StyleSheet, useColorScheme, View } from 'react-native';
import { GlassFill, GlassScope, Icon, PaletteScope, Panel, Text, WorkspaceTint, font, geometry, palette, radius, setupGeometry as g, setupPaper, space, trafficLightColors, useTheme, type SymbolName } from '../ui';
import type { SetupValues } from './SetupPages';
import { Mark } from './SetupMarks';
import { browsers, favorites, searchEngines, type Screen } from './setup';

const appIcon = require('../../../../../packages/shell/macos/AppIcons/MerlinAppIcon-default.png');
const fjord = require('../../../../../packages/shell/macos/Onboarding/MerlinAlpenglow.jpg');
const dawn = require('../../../../../packages/shell/macos/Onboarding/MerlinDawn.jpg');
const centered = { alignItems: 'center', justifyContent: 'center' } as const;
const row = { flexDirection: 'row', alignItems: 'center' } as const;

export function previewKey(screen: Screen, v: SetupValues) {
  const scene = { source: v.progress.source, layout: v.layout, address: v.shell.addressBar, command: v.shell.commandBarPlacement,
    newTab: v.shell.newTabPopup, position: v.shell.newTabPosition, sharing: v.shell.sharedTabs, links: v.shell.externalLinks,
    appearance: v.appearance.mode, favorites: v.favorites.join(','), search: v.search, startup: v.startup,
    tidy: v.shell.tabTidyHours, cli: v.installed } as Partial<Record<Screen, unknown>>;
  return screen + '/' + (scene[screen] ?? '');
}

function Lights() {
  return <View style={[row, { gap: space.xs }]}>{trafficLightColors.map(color =>
    <View key={color} style={{ width: g.stepDot, height: g.stepDot, borderRadius: radius.pill, backgroundColor: color }} />
  )}</View>;
}

function Small({ children, strong = false }: React.PropsWithChildren<{ strong?: boolean }>) {
  return <Text lines={1} tone={strong ? 'textPrimary' : 'textSecondary'} weight={strong ? 'semibold' : 'regular'}
    style={{ fontSize: g.previewText, lineHeight: g.previewLine }}>{children}</Text>;
}

function AppMark({ small = false }: { small?: boolean }) {
  const side = small ? g.previewFalcon : g.previewIcon;
  return <Image source={appIcon} accessible={false} resizeMode="contain" style={{ width: side, height: side }} />;
}

function Source({ v, compact }: { v: SetupValues; compact: boolean }) {
  const selected = v.progress.source;
  const sources = selected ? [{ id: selected, name: selected === 'fresh' ? 'Starting fresh' : browsers.find(b => b.id === selected)?.name }] :
    browsers.filter(b => v.foundBrowsers.includes(b.bundle)).slice(0, 4);
  return <View style={{ ...centered, flexDirection: compact ? 'row' : 'column', gap: space.lg }}>
    {sources.length > 0 && <>
      <View style={[row, { justifyContent: 'center', flexWrap: 'wrap', gap: space.lg }]}>
        {sources.map(b => <View key={b.id} style={{ alignItems: 'center', gap: space.sm }}>
          <Mark id={b.id} size={compact ? g.catalogIcon : g.catalogPreview} /><Text variant="micro">{b.name}</Text>
        </View>)}
      </View>
      <Icon name={compact ? 'arrow.right' : 'arrow.down'} tone="iconSecondary" />
    </>}
    <AppMark small={compact} />
  </View>;
}

function Receipt({ v, compact }: { v: SetupValues; compact: boolean }) {
  const { colors } = useTheme();
  const entries = [v.sidebar ? 'Tabs in the sidebar' : 'Tabs along the top',
    v.shell.newTabPopup ? '⌘T opens the command bar' : '⌘T opens a new tab',
    v.startup === 'last' ? 'Restore tabs at launch' : 'Start with a fresh window',
    ...(!compact ? [searchEngines.find(([id]) => id === v.search)?.[1], v.favorites.length + ' pinned favorites'].filter(Boolean) : [])];
  return <Panel fill="contentBackground" border="borderDefault" elevation="card" radius="field"
    style={{ width: '86%', padding: space.lg, transform: [{ rotate: '-3deg' }] }}>
    <View style={[row, { alignItems: 'flex-start' }]}>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ fontFamily: font.serif, fontSize: g.headingSize, lineHeight: g.headingLine }}>Welcome aboard.</Text>
        {entries.map(value => <Text key={value} variant="caption" tone="textPrimary">✓  {value}</Text>)}
      </View>
      <View style={{ paddingLeft: space.sm, borderLeftWidth: geometry.hairline, borderLeftColor: colors.borderDefault }}><AppMark small /></View>
    </View>
  </Panel>;
}

function StatusLine({ icon, label, on }: { icon: SymbolName; label: string; on: boolean }) {
  const { colors } = useTheme();
  return <View style={[row, { gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill,
    backgroundColor: colors[on ? 'accentSoft' : 'fillControl'], opacity: on ? 1 : .65 }]}>
    <Icon name={icon} size="small" /><Text variant="label">{label}</Text>
    <Icon name={on ? 'checkmark' : 'minus'} size="tiny" />
  </View>;
}

function Pins({ v, compact }: { v: SetupValues; compact: boolean }) {
  const { colors } = useTheme();
  const chosen = favorites.filter(f => v.favorites.includes(f.id));
  const slots = compact ? Math.max(6, chosen.length) : Math.max(6, Math.ceil(chosen.length / 3) * 3);
  return <Panel fill="contentBackground" radius="panel" border="borderDefault" elevation="card"
    style={{ width: compact ? '90%' : '63%', maxWidth: compact ? undefined : g.previewCard, padding: compact ? space.sm : space.lg, gap: compact ? space.xs : space.md }}>
    <Lights />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
      {Array.from({ length: slots }, (_, i) => <View key={chosen[i]?.id ?? i} style={{ ...centered, width: compact ? '15%' : '31%', height: compact ? geometry.controlCompact : geometry.controlLarge,
        borderRadius: radius.control, borderStyle: chosen[i] ? 'solid' : 'dashed', borderWidth: geometry.hairline,
        borderColor: colors.borderDefault, backgroundColor: colors[chosen[i] ? 'accentSoft' : 'fillTransparent'] }}>
        {chosen[i] && <Mark id={chosen[i].id} size={geometry.iconMedium} />}
      </View>)}
    </View>
    {!compact && <View style={{ height: geometry.hairline, backgroundColor: colors.borderDefault }} />}
    {!compact && ['Field notes', 'Trail map'].map(label => <View key={label} style={[row, { gap: space.sm }]}><Icon name="doc" size="tiny" tone="iconSecondary" /><Small>{label}</Small></View>)}
  </Panel>;
}

export function SetupPreview({ values: v, screen, compact = false }: { values: SetupValues; screen: Screen; compact?: boolean }) {
  const system = useColorScheme();
  const mode = v.appearance.mode === 'system' ? system === 'dark' ? 'dark' : 'light' : v.appearance.mode;
  const translucent = v.shell.interfaceStyle === 'glass';
  const look = { on: v.glassAvailable && translucent, translucent, tint: v.shell.glassTintWithTheme ? v.shell.glassTintAmount : 0,
    transparency: v.shell.glassTransparency, workspaceColor: v.shell.workspaceTheme?.stops[0] };
  let scene;
  if (screen === 'source') scene = <Source v={v} compact={compact} />;
  else if (screen === 'finish') scene = <Receipt v={v} compact={compact} />;
  else if (screen === 'favorites') scene = <Pins v={v} compact={compact} />;
  else if (screen === 'system' || screen === 'privacy') scene = <View style={{ ...centered, flexDirection: compact ? 'row' : 'column', gap: space.xl }}>
    {screen === 'system' ? <AppMark small={compact} /> : <Icon name="lock.shield" size="large" tone="accent" />}
    <View style={{ alignItems: 'center', gap: space.sm }}>
      {screen === 'system' ? <>
        <StatusLine icon="globe" label="Default browser" on={v.system.default || v.system.trial || v.system.alreadyDefault} />
        <StatusLine icon="rectangle.stack" label="In your Dock" on={v.system.dock || v.system.alreadyDocked} />
        <StatusLine icon="bolt" label="Opens at login" on={v.system.login || v.system.alreadyLogin} />
      </> : <>
        <StatusLine icon="eye.slash" label="Telemetry-free" on />
        <StatusLine icon="hand.raised" label="Block ads and trackers" on={v.blocking.enabled} />
        <StatusLine icon="arrow.clockwise" label="Filter list updates" on={v.blocking.automatic} />
      </>}
    </View>
  </View>;
  else if (screen === 'cli') scene = <Panel fill="contentBackground" radius="card" elevation="card" border="borderDefault" style={{ width: '80%', padding: space.lg, gap: space.lg }}>
    <Lights /><View style={{ gap: space.xs }}><Text variant="mono">$ merlin tabs</Text><Text variant="mono" tone="textSecondary">1   Field notes</Text>
      <Text variant="mono" tone="textSecondary">2   Trail map</Text></View>
  </Panel>;
  else scene = <BrowserScene v={v} screen={screen} compact={compact} mode={mode} />;
  return <PaletteScope roles={palette(mode, v.appearance.accent)}><GlassScope look={look}>
    <View pointerEvents="none" accessible accessibilityLabel="Preview of your Merlin setup" style={{ flex: 1, ...centered }}>{scene}</View>
  </GlassScope></PaletteScope>;
}

function BrowserScene({ v, screen, compact, mode }: { v: SetupValues; screen: Screen; compact: boolean; mode: 'light' | 'dark' }) {
  const { colors, glass } = useTheme();
  const stock = setupPaper[mode];
  const sharing = screen === 'sharing';
  const little = screen === 'links' && v.shell.externalLinks === 'compact';
  const start = screen === 'newTab' && !v.shell.newTabPopup || screen === 'startup' && v.startup === 'start' || screen === 'search';
  const popup = screen === 'command' || screen === 'newTab' && v.shell.newTabPopup;
  function window(second: boolean) {
    const side = v.sidebar && !little && (!sharing || v.shell.sharedTabs);
    const addressInSidebar = side && v.shell.addressBar === 'sidebar';
    const frame = v.shell.borderlessMode ? 0 : Math.max(space.hair, v.shell.pageFrame * .55);
    const tabs = second && !v.shell.sharedTabs ? ['Trail map', 'Weekend plans'] : ['Field notes', 'Inbox', 'Trail map', 'Weekend plans'];
    if (screen === 'position') tabs.splice(v.shell.newTabPosition === 'top' ? 0 : v.shell.newTabPosition === 'adjacent' ? 1 : tabs.length, 0, 'New Tab');
    if (screen === 'tidy' && v.shell.tabTidyHours !== 'off') tabs.splice(2);
    const tabList = <View style={{ flex: side ? undefined : 1, flexDirection: side ? 'column' : 'row', gap: space.hair, overflow: 'hidden' }}>
      {tabs.map((name, index) => <View key={name} style={[row, { flex: side ? undefined : 1, gap: space.hair, padding: space.xs,
        borderRadius: radius.xs, overflow: 'hidden', backgroundColor: colors[index === 0 ? 'contentBackground' : 'fillTransparent'] }]}>
        <Mark id={['safari', 'gmail', 'google', 'calendar'][index % 4]} size={space.sm} /><View style={{ flex: 1 }}><Small strong={index === 0}>{name}</Small></View>
      </View>)}
    </View>;
    const address = <View style={[row, { flex: addressInSidebar ? undefined : 1, paddingHorizontal: space.sm, borderRadius: radius.sm, height: geometry.controlCompact,
      backgroundColor: glass.on ? colors.fillTransparent : screen === 'siteColor'
        ? v.shell.toolbarColor === 'workspace' ? stock.chrome : stock.stock : colors.contentBackground }]}>
      {glass.on && <GlassFill radius={radius.sm} state="rest" dark={mode === 'dark'} />}
      <View style={{ flex: 1 }}><Small strong>{start ? 'New Tab' : 'fieldnotes.merlin  /  Journal'}</Small></View>
    </View>;
    return <Panel key={String(second)} radius="card" border="borderDefault" elevation="card" fill="sidebarFallback"
      style={{ width: sharing ? '47%' : little ? '74%' : '96%', height: compact ? g.smallPreviewHeight : g.previewHeight }}>
      <View style={{ flex: 1, borderRadius: radius.card, backgroundColor: stock.chrome, overflow: 'hidden', padding: frame }}>
        {v.shell.workspaceTheme ? <WorkspaceTint theme={v.shell.workspaceTheme} /> : <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.accentSoft }]} />}
        {!side && <View style={[row, { gap: space.sm, height: geometry.controlCompact, paddingHorizontal: space.xs }]}><Lights />{!little && tabList}</View>}
        <View style={{ flex: 1, flexDirection: 'row', gap: space.xs }}>
          {side && <View style={{ width: sharing ? g.previewFalcon : g.previewSidebar, paddingHorizontal: space.xs, gap: space.sm }}>
            <View style={{ height: geometry.controlCompact, justifyContent: 'center' }}><Lights /></View>
            {addressInSidebar && address}
            {(screen === 'material' || screen === 'habits') && <View style={{ flexDirection: 'row', gap: space.hair, flexWrap: 'wrap' }}>
              {['gmail', 'github', 'calendar', 'spotify'].map(id => <View key={id} style={{ ...centered,
                width: v.shell.adaptiveFavorites ? '22%' : '44%', height: geometry.icon, borderRadius: radius.xs,
                backgroundColor: glass.on ? colors.fillTransparent : colors.fillControl }}>
                {glass.on && <GlassFill radius={radius.xs} state="rest" dark={mode === 'dark'} />}
                <Mark id={id} size={geometry.iconSmall} />
              </View>)}
            </View>}
            {tabList}<Small>＋ New tab</Small>
          </View>}
          <View style={{ flex: 1, borderRadius: frame ? radius.sm : 0, overflow: 'hidden', backgroundColor: colors.contentBackground }}>
            {(addressInSidebar || !(screen === 'details' && v.shell.hideToolbarOnScroll)) &&
              <View style={[row, { height: geometry.controlCompact, gap: space.xs, paddingHorizontal: space.xs }]}>
                {side && <Icon name="sidebar.left" size="chevron" tone="iconSecondary" />}
                <Icon name="chevron.left" size="chevron" tone="iconSecondary" />
                <Icon name="chevron.right" size="chevron" tone="iconSecondary" />
                <Icon name="arrow.clockwise" size="chevron" tone="iconSecondary" />
                {!addressInSidebar && address}
              </View>}
            {(v.shell.bookmarksBar === 'always' || v.shell.bookmarksBar === 'newTab' && start) &&
              <View style={{ paddingHorizontal: space.sm }}><Small>☆ Bookmarks     Field notes     Trail map</Small></View>}
            {start ? <View style={{ flex: 1, ...centered, gap: space.sm }}>
              <AppMark small /><View style={[row, { gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: colors.fillControl }]}>
                <Mark id={v.search || 'google'} size={geometry.iconSmall} /><Small>Search or enter an address</Small>
              </View>
            </View> : <>
              <View style={[row, { justifyContent: 'space-between', paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: stock.stock }]}>
                <Text weight="semibold" style={{ fontFamily: font.serif, fontSize: font.size.caption }}>Field notes</Text><Small>Journal  ·  Maps</Small>
              </View>
              <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs }}>
                <Image accessible={false} source={second && !v.shell.sharedTabs ? dawn : fjord} resizeMode="cover"
                  style={{ width: '100%', height: compact ? geometry.controlLarge : g.pictureHeight, borderRadius: radius.sm }} />
                <Text lines={2} style={{ fontFamily: font.serif, fontSize: font.size.title, lineHeight: font.line.body }} weight="semibold">
                  {second && !v.shell.sharedTabs ? 'The coastal route' : 'First light on the fjord'}
                </Text>
                <Small>Western Norway  ·  5 min read</Small>
                {!compact && <Text lines={2} tone="textSecondary" style={{ fontSize: g.previewText, lineHeight: g.previewLine }}>
                  From the shore, the peaks catch the sun long before the village wakes.
                </Text>}
              </View>
            </>}
            {popup && <View style={{ position: 'absolute', left: space.sm, right: space.sm, top: v.shell.commandBarPlacement === 'centred' ? '32%' : space.xl }}>
              <Panel fill="contentBackground" border="borderDefault" elevation="popover" radius="control" style={{ padding: space.sm, gap: space.xs }}>
                <View style={[row, { gap: space.xs }]}><Icon name="magnifyingglass" size="tiny" /><Small strong>Search or enter an address</Small></View>
                <Small>↗  Field notes</Small><Small>↗  Trail map</Small>
              </Panel>
            </View>}
          </View>
        </View>
      </View>
    </Panel>;
  }
  return <View style={{ ...centered, width: '100%', gap: space.sm }}>
    <View style={{ ...centered, width: '100%', flexDirection: 'row', gap: space.xs }}>
      {window(false)}{sharing && window(true)}
      {screen === 'links' && <View style={{ position: 'absolute', left: space.xs, bottom: space.lg, width: '36%' }}>
        <Panel fill="contentBackground" border="borderDefault" elevation="popover" radius="control" style={{ padding: space.sm, gap: space.sm }}>
          <Small strong>Messages</Small>
          <View style={{ backgroundColor: colors.accentSoft, padding: space.xs, borderRadius: radius.sm }}>
            <Small>The route for Saturday</Small><Small strong>↗  Field notes</Small>
          </View>
        </Panel>
      </View>}
    </View>
    {screen === 'habits' && <Small>{[v.shell.peekModifier === 'off' ? '' : v.shell.peekModifier === 'shift' ? '⇧ Click to peek' : '⌥ Click to peek',
      v.shell.undoReopensTab ? '⌘Z to reopen' : '', v.shell.groupLinkTabs ? '⌘ Click to group' : ''].filter(Boolean).join('    ·    ')}</Small>}
  </View>;
}
