import React, { useEffect, useState } from 'react';
import { Image, TextInput, View } from 'react-native';
import {
  importSetupProfile, openSetupImportTool, setupImportProfiles,
  type SetupImportProfile, type SetupImportResult,
} from '../../state/setupHost';
import type { Appearance } from '../../state/types';
import { useSnapshot } from '../../state/window';
import { errorText } from '../../lib/result';
import { CatalogTile } from './SetupMarks';
import { CheckCard, OptionCard, SegmentRow, TextButton, useSetupInk } from './SetupParts';
import type { ShellPrefs } from '../../state/shellPrefs';
import { useAppIcons } from '../../state/system';
import { Button, Icon, KeyCap, PictureChoice, Pressable, Slider, Text, type SymbolName, geometry, radius, setupGeometry, space, useInteraction, useTheme } from '../ui';
import { ThemeEditor } from '../settings/ThemeEditor';
import { browsers, favorites, searchEngines, type Progress, type Screen, type Source, type SetupPreferences } from './setup';
import type { readSetupCode } from './setup';

export const headings: Record<Screen, [string, string]> = {
  source: ['Which browser feels like home?', 'Start with the settings you know, or choose your own.'],
  layout: ['Where do your tabs belong?', 'See how each layout feels in your window.'],
  address: ['Place the address bar', 'Choose where navigation sits when tabs are in the sidebar.'],
  command: ['Place the command bar', 'Choose where Merlin searches when you press ⌘L.'],
  newTab: ['Open a new tab', 'Choose what you see when you press ⌘T.'],
  position: ['Place new tabs', 'Choose where a new tab lands in your tab list.'],
  tidy: ['Manage inactive tabs', 'Keep them open or move them to Recently Closed after a set time.'],
  startup: ['Pick up where you left off', 'Choose what Merlin opens when you return.'],
  sharing: ['Share tabs between windows', 'Choose whether normal windows show the same tab list.'],
  habits: ['Customize tab shortcuts', 'Make your favorite sites and link actions easier to reach.'],
  color: ['Choose a workspace colour', 'Pick a colour or blend up to three colours for your window.'],
  appearance: ['Set your appearance', 'Follow macOS or choose a light or dark window.'],
  material: ['Choose a window material', 'Set how buttons, fields, and panels look.'],
  frame: ['Frame the page', 'Adjust the space between the page and the window.'],
  siteColor: ['Choose a toolbar colour', 'Keep your workspace colour or let each site tint the toolbar.'],
  details: ['Set the finishing details', 'Choose an app icon, toolbar behavior, and bookmarks bar.'],
  search: ['Choose a search engine', 'Merlin uses it when you enter search terms.'],
  privacy: ['Set your privacy controls', 'Merlin collects zero telemetry. You can manage blocking and list updates here.'],
  favorites: ['Pin your favorite sites', 'Keep the sites you visit most within reach when you open Merlin.'],
  system: ['Make Merlin at home', 'Choose how Merlin fits into macOS. Continue applies the selected changes.'],
  links: ['Open links from other apps', 'Choose where links from Mail, Messages, and other apps appear.'],
  cli: ['Use Merlin from Terminal', 'Install the Merlin CLI to open pages, list tabs, and work with workspaces from your Mac.'],
  finish: ['Your workspace is ready', 'Start browsing or try Merlin’s keyboard shortcuts in the field guide.'],
};

export type SetupValues = {
  progress: Progress;
  shell: ShellPrefs;
  appearance: Appearance;
  layout: 'top' | 'side';
  startup: 'last' | 'start';
  search?: string;
  managedSearch: boolean;
  blocking: { enabled: boolean; automatic: boolean };
  blockingAvailable: boolean;
  glassAvailable: boolean;
  favorites: string[];
  icon?: string;
  system: { default: boolean; dock: boolean; login: boolean; trial: boolean;
    alreadyDefault: boolean; alreadyDocked: boolean; alreadyLogin: boolean };
  hostOptions: boolean;
  code: string;
  codeEntry: boolean;
  importOpen: boolean;
  codeReview: ReturnType<typeof readSetupCode>;
  sidebar: boolean;
  installed: boolean;
  wantsCli: boolean;
  foundBrowsers: string[];
};

type SetupKey = keyof SetupPreferences | 'workspaceTheme';
type PageActions = {
  option<K extends SetupKey>(key: K, value: ShellPrefs[K]): void;
  appearance(patch: Partial<Appearance>): void;
  layout(value: SetupValues['layout']): void;
  startup(value: SetupValues['startup']): void;
  search(value: string): void;
  blocking(value: Partial<SetupValues['blocking']>): void;
  icon(value: string): void;
  system(value: Partial<SetupValues['system']>): void;
  favorite(id: string): void;
  source(value: Source): void;
  code(value: string): void;
  replayIntro?(): void;
  startCode(): void;
  startImport(): void;
  importBusy(on: boolean): void;
  copyCode(): void;
  selectCli(value: boolean): void;
};

type Choice<T> = readonly [T, string, string?];

function Rows<T extends string | number | boolean>({ label, value, choices, onChange }: {
  label: string; value: T; choices: readonly Choice<T>[]; onChange(value: T): void;
}) {
  return <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: space.sm }}>
    {choices.map(([id, title, detail]) => <ChoiceRow key={String(id)} title={title} detail={detail}
      selected={value === id} onPress={() => onChange(id)} />)}
  </View>;
}

function ChoiceRow({ title, detail, selected, onPress }: {
  title: string; detail?: string; selected: boolean; onPress(): void;
}) {
  return <OptionCard title={title} detail={detail} selected={selected} onPress={onPress} />;
}

function Switch({ label, detail, icon, value, onChange, disabled }: {
  label: string; detail?: string; icon?: SymbolName; value: boolean; onChange(value: boolean): void; disabled?: boolean;
}) {
  return <CheckCard title={label} detail={detail} icon={icon} value={value} onChange={onChange} disabled={disabled} />;
}

function Shortcut({ keys, children }: { keys: string; children: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
    <KeyCap>{keys}</KeyCap><Text flex={1} tone="textSecondary">{children}</Text>
  </View>;
}

export function SetupSlider({ title, value, unit, onChange }: {
  title: string; value: number; unit: string; onChange(value: number): void;
}) {
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: space.xs, minHeight: geometry.controlCompact }}>
    <Text variant="label">{title}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <Slider label={title} value={value} valueText={unit} onChange={onChange} />
      <Text variant="caption" tone="textSecondary" style={{ minWidth: geometry.titlebar }}>{unit}</Text>
    </View>
  </View>;
}

function SourcePage({ values, actions, busy }: { values: SetupValues; actions: PageActions; busy: boolean }) {
  const installed = values.foundBrowsers;
  const { colors } = useTheme();
  const ink = useSetupInk();
  if (values.codeEntry) return values.codeReview ? <>
    <Text>Review these preferences before applying them.</Text>
    <Text variant="bodyStrong">{values.codeReview.layout === 'side' ? 'Sidebar tabs' : 'Top tabs'} · {values.codeReview.mode} appearance</Text>
    <Text>{values.codeReview.favorites.length} favorite sites · {values.codeReview.startup === 'last' ? 'Restore tabs' : 'Start fresh'}</Text>
    <Text>{values.codeReview.shell.sharedTabs ? 'Shared windows' : 'Separate windows'}{values.codeReview.engine ?
      ' · ' + searchEngines.find(([id]) => id === values.codeReview?.engine)?.[1] : ''}</Text>
    {values.codeReview.blocking && <Text>{values.codeReview.blocking.enabled ? 'Ad blocking on' : 'Ad blocking off'} ·
      {values.codeReview.blocking.automatic ? ' Automatic list updates' : ' Manual list updates'}</Text>}
  </> : <TextInput value={values.code} onChangeText={actions.code} accessibilityLabel="Merlin setup code" autoFocus
    placeholder="MERLIN1:…" placeholderTextColor={colors.textSecondary} multiline
    style={{ color: colors.textPrimary, backgroundColor: colors.sidebarFallback, minHeight: setupGeometry.codeHeight, borderRadius: radius.control, padding: space.sm }} />;
  const found = browsers.filter(b => installed.includes(b.bundle));
  const others = browsers.filter(b => !installed.includes(b.bundle) && b.id !== 'helium');
  const selected = found.find(b => b.id === values.progress.source);
  if (selected && values.importOpen) return <ImportChoices key={selected.id} browser={selected} onBusy={actions.importBusy} />;
  const tiles = (items: Array<{ id: Source; name: string }>) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
    {items.map(browser => <CatalogTile key={browser.id} id={browser.id} label={browser.name}
      selected={values.progress.source === browser.id} onPress={() => actions.source(browser.id)} />)}
  </View>;
  return <>
    {!!found.length && <View style={{ gap: space.sm }}><Text variant="label" style={{ color: ink.label }}>Found on this Mac</Text>{tiles(found)}</View>}
    <View style={{ gap: space.sm }}><Text variant="label" style={{ color: ink.label }}>{found.length ? 'Others' : 'Browser presets'}</Text>
      {tiles([...others, { id: 'fresh', name: 'Starting fresh' }])}</View>
    {!!selected && <Button label={'Import from ' + selected.name + '…'} icon="arrow.down" variant="secondary" onPress={actions.startImport} disabled={busy} />}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      <TextButton label="Have a setup code?" onPress={actions.startCode} />
      {actions.replayIntro && <TextButton label="Replay intro" icon="play" onPress={actions.replayIntro} />}
    </View>
  </>;
}

const importCategories = [
  ['bookmarks', 'Bookmarks'], ['history', 'Browsing history'], ['tabs', 'Open and pinned tabs'],
] as const;

function ImportChoices({ browser, onBusy }: { browser: { id: Source; name: string }; onBusy(on: boolean): void }) {
  const { windowId } = useSnapshot();
  const [profiles, setProfiles] = useState<SetupImportProfile[]>();
  const [profile, setProfile] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [results, setResults] = useState<SetupImportResult[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let mounted = true;
    setError('');
    setProfiles(undefined);
    void setupImportProfiles(browser.id).then(values => {
      if (!mounted) return;
      setProfiles(values);
      setProfile(values[0]?.id ?? '');
    }, reason => {
      if (!mounted) return;
      setError(errorText(reason));
      setProfiles([]);
    });
    return () => { mounted = false; };
  }, [browser.id, reload]);

  async function run(categoriesToImport: string[]) {
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const report = await importSetupProfile(windowId, browser.id, profile, categoriesToImport);
      setResults(previous => [...previous.filter(item => !categoriesToImport.includes(item.category)), ...report]);
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); onBusy(false); }
  }

  const tool = (category: 'passwords' | 'bookmarks') =>
    void openSetupImportTool(windowId, category).catch(reason => setError(errorText(reason)));

  return <View style={{ gap: space.sm }}>
    <Text variant="title">Import from {browser.name}</Text>
    {!profiles && <Text tone="textSecondary">Looking for local profiles…</Text>}
    {profiles && (profiles.length ? <Rows label="Source profile" value={profile}
      choices={profiles.map(item => [item.id, item.name])} onChange={value => { setProfile(value); setResults([]); }} />
      : <View style={{ gap: space.xs }}>
        <Text tone="textSecondary">Merlin couldn’t find a readable profile.</Text>
        <Button label="Check again" variant="secondary" onPress={() => setReload(value => value + 1)} />
      </View>)}
    {!!profiles?.length && importCategories.map(([id, label]) => <Switch key={id} label={label} disabled={busy}
      value={categories.includes(id)} onChange={enabled => setCategories(previous =>
        enabled ? [...previous, id] : previous.filter(category => category !== id))} />)}
    {!!profiles?.length && <Button label={busy ? 'Importing…' : 'Import selected data'} variant="primary"
      disabled={busy || !profile || !categories.length} onPress={() => void run(categories)} />}
    {results.map(result => <View key={result.category} accessibilityLiveRegion="polite" style={{ gap: space.xs }}>
      <Text variant="bodyStrong">{importCategories.find(([id]) => id === result.category)?.[1]} · {result.count} imported</Text>
      {result.error ? <>
        <Text tone="textDanger">{result.error}</Text>
        <Button label="Retry category" variant="secondary" disabled={busy} onPress={() => void run([result.category])} />
      </> : !!result.skipped && <Text variant="caption" tone="textSecondary">{result.skipped} skipped</Text>}
    </View>)}
    {!!error && <Text tone="textDanger" accessibilityLiveRegion="polite">{error}</Text>}
    <Text variant="caption" tone="textSecondary">Export bookmarks as HTML or passwords as CSV from your source browser to import them from a file.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      <Button label="Import a bookmarks file…" variant="secondary" disabled={busy} onPress={() => tool('bookmarks')} />
      <Button label="Import passwords…" variant="secondary" disabled={busy} onPress={() => tool('passwords')} />
    </View>
  </View>;
}

function IconChoices({ icon, onChange }: { icon?: string; onChange(value: string): void }) {
  const { choices, current } = useAppIcons(32);
  if (!choices.length) return null;
  return <View style={{ gap: space.sm }}>
    <Text variant="label">App icon</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {choices.map(choice => <PictureChoice key={choice.id} title={choice.name} size="icon"
        selected={(icon ?? current) === choice.id} onPress={() => onChange(choice.id)}>
        <Image accessible={false} source={{ uri: choice.preview }} style={{ width: geometry.control, height: geometry.control }} />
      </PictureChoice>)}
    </View>
  </View>;
}

export function SetupPage({ screen, values: v, actions: a, busy }: {
  screen: Screen; values: SetupValues; actions: PageActions; busy: boolean;
}) {
  const option = <K extends SetupKey>(key: K) => (value: ShellPrefs[K]) => a.option(key, value);
  const pick = <K extends SetupKey>(key: K, label: string, choices: readonly Choice<ShellPrefs[K] & (string | number | boolean)>[]) =>
    <Rows<ShellPrefs[K] & (string | number | boolean)> label={label}
      value={v.shell[key] as ShellPrefs[K] & (string | number | boolean)} choices={choices} onChange={option(key)} />;
  const toggle = (key: 'adaptiveFavorites' | 'undoReopensTab' | 'groupLinkTabs' | 'glassTintWithTheme' | 'hideToolbarOnScroll', label: string) =>
    <Switch label={label} value={v.shell[key]} onChange={option(key)} />;
  switch (screen) {
    case 'source': return <SourcePage values={v} actions={a} busy={busy} />;
    case 'layout': return <Rows label="Tab layout" value={v.layout} onChange={a.layout}
      choices={[[ 'side', 'In the sidebar', 'A vertical list of tabs' ], ['top', 'Across the top', 'A tab strip above the page']]} />;
    case 'address': return pick('addressBar', 'Address bar', [['toolbar', 'In the toolbar', 'Above the page, with the back and forward buttons'], ['sidebar', 'In the sidebar', 'Above your tabs, leaving the page more room']]);
    case 'command': return pick('commandBarPlacement', 'Command bar', [['field', 'Under the address', 'Drops down from the address field'], ['centred', 'In the centre', 'Floats over the page']]);
    case 'newTab': return pick('newTabPopup', 'New Tab behavior', [[false, 'The New Tab page', 'Your favourite sites and a search field'], [true, 'The command bar', 'Start typing right away']]);
    case 'position': return pick('newTabPosition', 'New tab placement', [
      ['end', v.sidebar ? 'At the bottom' : 'On the right', 'After the other tabs'],
      ['top', v.sidebar ? 'At the top' : 'On the left', 'Before the other tabs'],
      ['adjacent', v.sidebar ? 'Below the current tab' : 'Beside the current tab', 'Right after the tab you’re on'],
    ]);
    case 'tidy': return <>
      <Rows label="Inactive tabs" value={v.shell.tabTidyHours !== 'off'} onChange={enabled => a.option('tabTidyHours', enabled ? '12' : 'off')}
        choices={[[false, 'Keep them open', 'Tabs stay until you close them'], [true, 'Tidy them up', 'Close the ones you haven’t used in a while']]} />
      {v.shell.tabTidyHours !== 'off' && pick('tabTidyHours', 'Tidy after', [['12', '12 hours'], ['24', 'One day'], ['168', 'One week']])}
    </>;
    case 'startup': return <Rows label="At launch" value={v.startup} onChange={a.startup}
      choices={[[ 'last', 'Restore my tabs', 'Pick up where you left off' ], ['start', 'Start fresh', 'Open to a new tab']]} />;
    case 'sharing': return pick('sharedTabs', 'Window behavior', [[false, 'Separate', 'Each window has its own tabs'],
      [true, 'Shared', 'Normal windows show the same open tabs']]);
    case 'habits': return <>
      {toggle('adaptiveFavorites', 'Favorite tiles grow with the sidebar')}
      <SegmentRow title="Peek a link with" value={v.shell.peekModifier} options={[['shift', '⇧-click'], ['option', '⌥-click'], ['off', 'Off']]}
        onChange={option('peekModifier')} />
      {toggle('undoReopensTab', '⌘Z reopens tabs outside text fields')}
      {toggle('groupLinkTabs', '⌘-click groups related tabs')}
    </>;
    case 'color': return <ThemeEditor accent={v.appearance.accent} theme={v.shell.workspaceTheme}
      onAccent={accent => a.appearance({ accent })} onTheme={option('workspaceTheme')} />;
    case 'appearance': return <Rows label="Appearance" value={v.appearance.mode} onChange={mode => a.appearance({ mode })}
      choices={[[ 'system', 'System', 'Follow your Mac' ], ['light', 'Light', 'Always light'], ['dark', 'Dark', 'Always dark']]} />;
    case 'material': return <>
      {pick('interfaceStyle', 'Window material', [['glass', 'Liquid Glass', 'Buttons and panels catch the light'], ['classic', 'Classic', 'Solid and quiet']])}
      {v.shell.interfaceStyle === 'glass' && toggle('glassTintWithTheme', 'Tint the glass with the workspace colour')}
      {v.shell.interfaceStyle === 'glass' && v.shell.glassTintWithTheme &&
        <SetupSlider title="Tint strength" value={v.shell.glassTintAmount} unit={Math.round(v.shell.glassTintAmount * 100) + '%'} onChange={option('glassTintAmount')} />}
    </>;
    case 'frame': {
      const frame = v.shell.borderlessMode ? 0 : v.shell.pageFrame;
      const setFrame = (next: number) => { a.option('borderlessMode', false); a.option('pageFrame', next); };
      return <>
        <Rows label="Page frame" value={frame} onChange={setFrame} choices={[[8, 'Framed', 'Rounded corners with a little room around the page'], [4, 'Thin', 'A slim frame and softer corners'],
          [0, 'Edge to edge', 'The page meets the window and the sidebar']]} />
        <SetupSlider title="Thickness" value={frame / 12} unit={frame + ' pt'} onChange={value => setFrame(Math.round(value * 12))} />
      </>;
    }
    case 'siteColor': return <Rows label="Toolbar colour" value={!['workspace', 'white'].includes(v.shell.toolbarColor)} onChange={on => a.option('toolbarColor', on ? 'match' : 'workspace')}
      choices={[[true, 'Use the site colour', 'The toolbar blends into the page'], [false, 'Use the workspace colour', 'The same colour on every site']]} />;
    case 'details': return <>
      <IconChoices icon={v.icon} onChange={a.icon} />
      {toggle('hideToolbarOnScroll', 'Hide the toolbar while scrolling')}
      <SegmentRow title="Bookmarks bar" value={v.shell.bookmarksBar} options={[['always', 'Always'], ['newTab', 'New Tab'], ['never', 'Never']]}
        onChange={option('bookmarksBar')} />
    </>;
    case 'search': return v.managedSearch ? <Text>Your organization manages the search engine.</Text> :
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {searchEngines.map(([id, name]) => <CatalogTile key={id} id={id} label={name} onPress={() => a.search(id)} selected={v.search === id} />)}
      </View>;
    case 'privacy': return <>
      <Switch label="Block ads and trackers" value={v.blocking.enabled} disabled={!v.blockingAvailable} onChange={enabled => a.blocking({ enabled })} />
      <Switch label="Update filter lists automatically" value={v.blocking.automatic} disabled={!v.blockingAvailable} onChange={automatic => a.blocking({ automatic })} />
    </>;
    case 'favorites': return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {favorites.map(site => <CatalogTile key={site.id} id={site.id} label={site.label} multiple
        selected={v.favorites.includes(site.id)} onPress={() => a.favorite(site.id)} />)}
    </View>;
    case 'system': return <>
      <Switch icon="globe" label="Set Merlin as default browser" detail="Open web links in Merlin" disabled={!v.hostOptions || v.system.alreadyDefault}
        value={v.system.default || v.system.alreadyDefault} onChange={value => a.system({ default: value, trial: false })} />
      {!v.system.alreadyDefault && !v.system.default && <Switch icon="clock" label="Try Merlin for seven days" detail="Check in on this Mac after a week"
        value={v.system.trial} onChange={trial => a.system({ trial })} />}
      <Switch icon="rectangle.stack" label="Keep Merlin in the Dock" detail="Keep the app within reach" disabled={!v.hostOptions || v.system.alreadyDocked}
        value={v.system.dock || v.system.alreadyDocked} onChange={dock => a.system({ dock })} />
      <Switch icon="arrow.clockwise" label="Open Merlin at login" detail="Ready when you sign in" disabled={!v.hostOptions || v.system.alreadyLogin}
        value={v.system.login || v.system.alreadyLogin} onChange={login => a.system({ login })} />
    </>;
    case 'links': return pick('externalLinks', 'External links', [['compact', 'Compact Merlin window', 'A small window for the link'],
      ['tab', 'A new tab', 'In your main Merlin window']]);
    case 'cli': return <Switch icon="chevron.right" label="Command line" detail={v.installed ? 'Installed at ~/.local/bin/merlin' : 'Install merlin in ~/.local/bin'}
      value={v.wantsCli || v.installed} disabled={v.installed || busy} onChange={a.selectCli} />;
    case 'finish': return <>
      <Shortcut keys="⌘T">{v.shell.newTabPopup ? 'Open the command bar' : 'Open a new tab'}</Shortcut>
      <Shortcut keys="⌘L">{v.shell.commandBarPlacement === 'centred' ? 'Search from the centre of the window' : 'Search from the address field'}</Shortcut>
      <Shortcut keys="⌘S">{v.sidebar ? 'Hide the sidebar' : 'Hide the tab strip'}</Shortcut>
      {v.shell.undoReopensTab && <Shortcut keys="⌘Z">Reopen a closed tab outside text fields</Shortcut>}
      <Button label="Copy setup code" icon="doc.on.doc" variant="secondary" disabled={busy} onPress={a.copyCode} />
    </>;
  }
}
