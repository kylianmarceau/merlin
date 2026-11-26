import React from 'react';
import { Image, useColorScheme, View } from 'react-native';
import { GlassScope, Icon, PaletteScope, Panel, Text, font, geometry, palette, radius, setupGeometry as g, space, trafficLightColors, useTheme, type SymbolName } from '../ui';
import { MockWindow, demos, type Demo, type Shape } from './previews/MockWindow';
import type { SetupValues } from './SetupPages';
import { Mark } from './SetupMarks';
import { browsers, searchEngines, type Screen } from './setup';

const appIcon = require('../../../../../packages/shell/macos/AppIcons/MerlinAppIcon-default.png');
const centered = { alignItems: 'center', justifyContent: 'center' } as const;
const row = { flexDirection: 'row', alignItems: 'center' } as const;

/** The preview's identity, so it turns like a page only where it isn't the one window. */
export function previewKey(screen: Screen, v: SetupValues) {
  if (showsWindow(screen)) return 'window';
  const scene = { source: v.progress.source, favorites: v.favorites.join(','), cli: v.installed } as Partial<Record<Screen, unknown>>;
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

const mockScreens = new Set<Screen>(['layout', 'address', 'command', 'newTab', 'position', 'tidy', 'startup', 'sharing', 'habits',
  'color', 'appearance', 'material', 'frame', 'siteColor', 'details', 'search', 'favorites', 'links']);
export const showsWindow = (screen: Screen) => mockScreens.has(screen);

function demoFor(screen: Screen, v: SetupValues): Demo {
  const s = v.shell;
  switch (screen) {
    case 'layout': case 'address': case 'habits': return demos.tabs;
    case 'command': return s.commandBarPlacement === 'centred' ? demos.cmdlCentred : demos.cmdlField;
    case 'newTab': return s.newTabPopup ? demos.newTabBar : demos.newTabPage;
    case 'position': return s.newTabPosition === 'top' ? demos.newTabTop : s.newTabPosition === 'adjacent' ? demos.newTabNext : demos.newTabEnd;
    case 'tidy': return s.tabTidyHours === 'off' ? demos.tidyKeep : demos.tidyAuto;
    case 'startup': return v.startup === 'start' ? demos.quitFresh : demos.quitRestore;
    case 'sharing': return s.sharedTabs ? demos.windowsShared : demos.windowsSeparate;
    case 'appearance': return v.appearance.mode === 'light' ? demos.appearanceLight : v.appearance.mode === 'dark' ? demos.appearanceDark : demos.appearanceSystem;
    case 'material': return s.interfaceStyle === 'glass' && v.glassAvailable ? demos.glass : demos.classic;
    case 'siteColor': return ['workspace', 'white'].includes(s.toolbarColor) ? demos.siteOff : demos.siteOn;
    case 'links': return s.externalLinks === 'compact' ? demos.linksSmall : demos.linksTab;
    case 'search': return demos.newTabPage;
    case 'favorites': return demos.favourites;
    default: return demos.still;
  }
}

/** The one window that stays through setup's browser questions, sized to the stage. */
function MockStage({ v, screen, dark }: { v: SetupValues; screen: Screen; dark: boolean }) {
  const [box, setBox] = React.useState<{ width: number; height: number } | null>(null);
  const shape: Shape = {
    top: !v.sidebar, addressInSidebar: v.sidebar && v.shell.addressBar === 'sidebar', dark,
    siteColor: !['workspace', 'white'].includes(v.shell.toolbarColor), frame: v.shell.borderlessMode ? 0 : v.shell.pageFrame,
    accent: v.appearance.accent, theme: v.shell.workspaceTheme ?? null,
  };
  const width = box ? Math.max(0, Math.min(g.mockMaxWidth, box.width, box.height * g.mockAspect)) : 0;
  return <View style={{ flex: 1, alignSelf: 'stretch', ...centered }} onLayout={e => setBox(e.nativeEvent.layout)}>
    {width > 0 && <MockWindow width={width} height={width / g.mockAspect} shape={shape} demo={demoFor(screen, v)} favorites={v.favorites} />}
  </View>;
}

export function SetupPreview({ values: v, screen, compact = false }: { values: SetupValues; screen: Screen; compact?: boolean }) {
  const system = useColorScheme();
  const mode = v.appearance.mode === 'system' ? system === 'dark' ? 'dark' : 'light' : v.appearance.mode;
  const translucent = v.shell.interfaceStyle === 'glass';
  const look = { on: v.glassAvailable && translucent, translucent, tint: v.shell.glassTintWithTheme ? v.shell.glassTintAmount : 0,
    transparency: v.shell.glassTransparency, workspaceColor: v.shell.workspaceTheme?.stops[0] };
  let scene;
  if (showsWindow(screen)) return <PaletteScope roles={palette(mode, v.appearance.accent)}><GlassScope look={look}>
    <View pointerEvents="none" accessible accessibilityLabel="Preview of your Merlin setup" style={{ flex: 1, ...centered }}>
      <MockStage v={v} screen={screen} dark={mode === 'dark'} />
    </View>
  </GlassScope></PaletteScope>;
  if (screen === 'source') scene = <Source v={v} compact={compact} />;
  else if (screen === 'finish') scene = <Receipt v={v} compact={compact} />;
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
  else scene = <Panel fill="contentBackground" radius="card" elevation="card" border="borderDefault" style={{ width: '80%', padding: space.lg, gap: space.lg }}>
    <Lights /><View style={{ gap: space.xs }}><Text variant="mono">$ merlin tabs</Text><Text variant="mono" tone="textSecondary">1   Field notes</Text>
      <Text variant="mono" tone="textSecondary">2   Trail map</Text></View>
  </Panel>;
  return <PaletteScope roles={palette(mode, v.appearance.accent)}><GlassScope look={look}>
    <View pointerEvents="none" accessible accessibilityLabel="Preview of your Merlin setup" style={{ flex: 1, ...centered }}>{scene}</View>
  </GlassScope></PaletteScope>;
}
