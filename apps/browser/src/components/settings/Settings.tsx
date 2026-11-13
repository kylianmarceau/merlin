import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { PreferenceKey, Preferences } from '../../state/types';
import { useShellPrefs } from '../../state/shellPrefs';
import { setNewTabPopup, setShellFollowsSite, setToolbarColor } from '../../state/shellPrefsStorage';
import { useAction, useActions, useRequest, useSnapshot } from '../../state/window';
import {
  Box, Button, Field, FormGroup, FormRow, ListRow, Notice, SectionHeader, Segmented, Sheet, SheetBody, Text, Toggle,
  accentLabels, accentSwatch, accents, geometry, opacity, radius, space, themePreview, toolbarColorLabels, toolbarColors, useTheme,
  type AccentName, type SheetSection,
} from '../ui';
import type { Appearance } from '../../state/types';

// Merlin's own icons for each section: a window with its sidebar, a switch, a
// closed eye, a no-entry sign, a box, stacked cards, ⌘, braces and the M.
const sections = [
  { id: 'appearance', label: 'Appearance', icon: 'sidebar.left' },
  { id: 'general', label: 'General', icon: 'switch.2' },
  { id: 'downloads', label: 'Downloads', icon: 'arrow.down.to.line' },
  { id: 'privacy', label: 'Privacy', icon: 'eye.slash' },
  { id: 'blocking', label: 'Blocking', icon: 'nosign' },
  { id: 'performance', label: 'Performance', icon: 'speedometer' },
  { id: 'extensions', label: 'Extensions', icon: 'shippingbox' },
  { id: 'workspaces', label: 'Workspaces', icon: 'square.on.square' },
  { id: 'keys', label: 'Keys', icon: 'command' },
  { id: 'config', label: 'Config File', icon: 'curlybraces' },
  { id: 'about', label: 'About', icon: 'm.square' },
] as const satisfies readonly SheetSection<string>[];
export type SettingsSection = typeof sections[number]['id'];

const filterLists = [
  ['easylist', 'EasyList', 'Advertising requests and page elements.'],
  ['easyprivacy', 'EasyPrivacy', 'Tracking requests.'],
  ['ublock', 'uBlock compatibility', 'Scriptlets, quick fixes and site recovery rules.'],
  ['brave', 'Brave compatibility', 'Vetted site-specific fixes.'],
] as const;

type Set = (key: PreferenceKey, value: unknown) => void;

export function Settings({ open }: { open: boolean }) {
  const actions = useActions();
  const { appearance } = useSnapshot();
  const newTabPopup = useShellPrefs(s => s.newTabPopup);
  const toolbarColor = useShellPrefs(s => s.toolbarColor);
  const shellFollowsSite = useShellPrefs(s => s.shellFollowsSite);
  const [section, setSection] = useState<SettingsSection>('appearance');
  const prefs = useRequest('settings.get', {});
  const action = useAction();
  const set: Set = async (key, value) => {
    const next = await action.run('settings.set', { key, value });
    if (next) prefs.set(next);
  };
  const openPage = (key: string) => void action.run('settings.openPage', { key });
  const p = prefs.data;
  return <Sheet<SettingsSection> open={open} title="Settings" sections={sections} section={section} onSection={setSection}
    onClose={actions.closePanel}>
    <SheetBody>
      {action.error && <Box marginBottom="lg"><Notice tone="error">{action.error}</Notice></Box>}
      {prefs.error && !p ? <Notice tone="error">{prefs.error}</Notice> : !p && section !== 'appearance' ? <Text tone="textSecondary">Loading settings…</Text> : <>
        {section === 'appearance' && <>
          <Box marginBottom="xl" gap="sm">
            <Text variant="label" weight="semibold" tone="groupLabel">Theme</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Colour scheme" style={{ flexDirection: 'row', gap: space.md + space.hair }}>
              {(['system', 'light', 'dark'] as const).map(mode => <ThemeChoice key={mode} mode={mode} accent={appearance.accent}
                selected={appearance.mode === mode} onPress={() => void actions.setAppearance({ mode })} />)}
            </View>
          </Box>
          <Box marginBottom="xl" gap="sm">
            <Text variant="label" weight="semibold" tone="groupLabel">Workspace colour</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Workspace colour" style={{ flexDirection: 'row', gap: space.lg }}>
              {accents.map(a => <Swatch key={a} name={a} selected={appearance.accent === a} onPress={() => void actions.setAppearance({ accent: a })} />)}
            </View>
          </Box>
          <FormGroup>
            <FormRow title="Reduce motion" detail="Panels and popovers appear without animation.">
              <Toggle label="Reduce motion" value={appearance.reduceMotion} onChange={reduceMotion => void actions.setAppearance({ reduceMotion })} /></FormRow>
            {p && <FormRow title="Tabs" detail="Down the side or across the top. Command-S hides them either way.">
              <Segmented label="Tab position" value={p.tabs} onChange={tabs => set('tabs', tabs)}
                options={[{ value: 'side', label: 'Sidebar' }, { value: 'top', label: 'Top' }]} /></FormRow>}
            {p?.tabs === 'top' && <FormRow title="Site colour" detail="The active tab and toolbar take the site's colour. Match continues the top of the page; Soft and Vivid use the site's brand colour. New tabs stay white.">
              <Segmented label="Site colour" value={toolbarColor} onChange={style => void setToolbarColor(style)}
                options={toolbarColors.map(value => ({ value, label: toolbarColorLabels[value] }))} /></FormRow>}
            {p?.tabs === 'top' && toolbarColor !== 'white' && <FormRow title="Tint the window with the site colour"
              detail="The space around the page takes the site's colour instead of the workspace colour.">
              <Toggle label="Tint the window with the site colour" value={shellFollowsSite} onChange={on => void setShellFollowsSite(on)} /></FormRow>}
            <FormRow title="Open new tabs as a pop-up" detail="Search over the current page; the tab opens once you choose where to go.">
              <Toggle label="Open new tabs as a pop-up" value={newTabPopup} onChange={on => void setNewTabPopup(on)} /></FormRow>
            {p && <FormRow title="Default page zoom"><Segmented label="Default zoom" value={p.zoom} onChange={zoom => set('zoom', zoom)}
              options={p.zoomChoices.filter(z => z >= 75 && z <= 150).map(z => ({ value: z, label: `${z}%` }))} /></FormRow>}
          </FormGroup>
        </>}
        {p && section === 'general' && <General p={p} set={set} openPage={openPage} />}
        {p && section === 'downloads' && <>
          <SectionHeader title="Downloads" />
          <FormGroup>
            <FormRow title="Save files to" detail={p.downloadDir || 'Not set'}>
              <Button label="Change…" disabled={action.busy} onPress={async () => {
                // The system folder picker stays open until the person chooses.
                const dir = await action.run('settings.chooseDownloadDir', {}, 10 * 60_000);
                if (dir !== undefined) prefs.reload();
              }} /></FormRow>
            <FormRow title="Ask where to save each file"><Toggle label="Ask where to save each file" value={p.askWhere} onChange={v => set('askWhere', v)} /></FormRow>
          </FormGroup>
        </>}
        {p && section === 'privacy' && <>
          <SectionHeader title="Privacy" detail="Passwords, site permissions and browsing data." />
          <FormGroup>
            <FormRow title="Offer to save passwords"><Toggle label="Offer to save passwords" value={p.savePasswords} onChange={v => set('savePasswords', v)} /></FormRow>
          </FormGroup>
          <PageLinks openPage={openPage} links={[['passwords', 'Saved passwords'], ['password-checkup', 'Password checkup'],
            ['site-permissions', 'Site permissions'], ['cookies', 'Cookies and site data'], ['security', 'Safe browsing and security'],
            ['clear-data', 'Clear browsing data'], ['addresses', 'Addresses'], ['payments', 'Payment methods'], ['certificates', 'Certificates']]} />
        </>}
        {p && section === 'blocking' && <Blocking p={p} set={set} />}
        {p && section === 'performance' && <>
          <SectionHeader title="Performance" />
          <FormGroup>
            <FormRow title="Memory Saver" detail="Frees memory from tabs you have not used in a while.">
              <Toggle label="Memory Saver" value={p.memorySaver} onChange={v => set('memorySaver', v)} /></FormRow>
            <FormRow title="Energy Saver" detail="Limits background activity when the battery is low.">
              <Toggle label="Energy Saver" value={p.energySaver} onChange={v => set('energySaver', v)} /></FormRow>
          </FormGroup>
        </>}
        {p && section === 'extensions' && <>
          <SectionHeader title="Extensions" detail="Turn installed extensions on or off.">
            <Button label="Manage" onPress={() => openPage('extensions')} />
            <Button label="Shortcuts" onPress={() => openPage('extension-shortcuts')} />
          </SectionHeader>
          {!p.extensions.length ? <Text tone="textSecondary">No extensions are installed.</Text> : <FormGroup>
            {p.extensions.map(ext => <FormRow key={ext.id} title={ext.name} detail={`Version ${ext.version}`}>
              <Toggle label={`${ext.name} enabled`} value={ext.enabled} disabled={!ext.canToggle}
                onChange={enabled => set('extension', { id: ext.id, enabled })} /></FormRow>)}
          </FormGroup>}
        </>}
        {section === 'workspaces' && <Workspaces onOpen={name => { void actions.command(`workspace open ${name}`); actions.closePanel(); }} />}
        {p && section === 'keys' && <>
          <SectionHeader title="Keys" detail={`Normal-mode bindings from your config. Link hints use: ${p.hintChars || 'the default characters'}.`} />
          <FormGroup>
            {p.bindings.map(b => <FormRow key={`${b.keys}:${b.command}`} title={b.desc || b.command} detail={b.desc ? b.command : undefined}>
              <Text variant="mono">{b.keys}</Text></FormRow>)}
          </FormGroup>
        </>}
        {section === 'config' && <ConfigEditor onSaved={prefs.reload} />}
        {p && section === 'about' && <>
          <SectionHeader title="About Merlin" />
          <FormGroup>
            <FormRow title="Version"><Text tone="textSecondary">{p.about.version}</Text></FormRow>
            <FormRow title="System"><Text tone="textSecondary">{p.about.os}</Text></FormRow>
          </FormGroup>
          <Box row gap="sm">
            <Button label="Build details" onPress={() => openPage('version')} />
            <Button label="Open-source credits" onPress={() => openPage('credits')} />
          </Box>
        </>}
      </>}
    </SheetBody>
  </Sheet>;
}

function PageLinks({ links, openPage }: { links: readonly (readonly [string, string])[]; openPage(key: string): void }) {
  return <FormGroup>
    {links.map(([key, title]) => <ListRow key={key} title={title} onPress={() => openPage(key)}
      trailing={<Text variant="caption">Open</Text>} />)}
  </FormGroup>;
}

function General({ p, set, openPage }: { p: Preferences; set: Set; openPage(key: string): void }) {
  return <>
    <SectionHeader title="General" />
    <FormGroup title="Startup">
      <FormRow title="When Merlin starts"><Segmented label="When Merlin starts" value={p.startup} onChange={v => set('startup', v)}
        options={[{ value: 'last', label: 'Reopen my tabs' }, { value: 'start', label: 'Start page' }]} /></FormRow>
      <FormRow title="Control-Tab switches" detail="Between tabs in the order they appear, or most recently used first.">
        <Segmented label="Control-Tab order" value={p.ctrlTab} onChange={v => set('ctrlTab', v)}
          options={[{ value: 'recent', label: 'Recent first' }, { value: 'order', label: 'In order' }]} /></FormRow>
    </FormGroup>
    <FormGroup title="Search" detail={p.engineManaged ? 'Your organisation manages the search engine.' : 'Used by the address field and the command menu.'}>
      <FormRow title="Search engine">
        <Segmented label="Search engine" value={p.engine} disabled={p.engineManaged} onChange={id => set('engine', id)}
          options={p.engines.map(e => ({ value: e.id, label: e.name }))} />
      </FormRow>
      <ListRow title="Manage search engines" onPress={() => openPage('search-engines')} trailing={<Text variant="caption">Open</Text>} />
    </FormGroup>
    <PageLinks openPage={openPage} links={[['languages', 'Languages'], ['fonts', 'Fonts'], ['accessibility', 'Accessibility'],
      ['system', 'System'], ['import', 'Import bookmarks and settings'], ['reset', 'Reset settings']]} />
  </>;
}

function Blocking({ p, set }: { p: Preferences; set: Set }) {
  const a = p.adblock;
  return <>
    <SectionHeader title="Blocking" detail={a.available ? a.status : 'Ad blocking is not available in this build.'} />
    <FormGroup>
      <FormRow title="Block ads and trackers"><Toggle label="Block ads and trackers" value={a.enabled && a.available}
        disabled={!a.available} onChange={v => set('adblock', v)} /></FormRow>
      <FormRow title="Update filter lists automatically" detail={a.private ? 'Managed by your main profile.' : a.updateStatus}>
        <Toggle label="Update filter lists automatically" value={a.automatic} disabled={!a.available || a.private}
          onChange={v => set('adblockUpdates', v)} /></FormRow>
      <FormRow title="Last update" detail={a.lastUpdate ? new Date(a.lastUpdate * 1000).toLocaleString() : 'Using the lists bundled with Merlin.'}>
        <Button label="Update Now" disabled={!a.available || a.private} onPress={() => set('adblockRefresh', null)} /></FormRow>
    </FormGroup>
    <FormGroup title="Filter lists">
      {filterLists.map(([id, name, detail]) => <FormRow key={id} title={name} detail={detail}>
        <Toggle label={name} value={a.groups.includes(id)} disabled={!a.available} onChange={on => {
          const groups = new Set(a.groups); if (on) groups.add(id); else groups.delete(id);
          set('adblockLists', [...groups]);
        }} /></FormRow>)}
    </FormGroup>
    {!!a.exceptions.length && <FormGroup title="Sites where blocking is off">
      {a.exceptions.map(host => <FormRow key={host} title={host}>
        <Button label="Turn Back On" size="small" onPress={() => set('adblockException', host)} /></FormRow>)}
    </FormGroup>}
  </>;
}

function Workspaces({ onOpen }: { onOpen(name: string): void }) {
  const list = useRequest('settings.workspaces', {});
  const action = useAction();
  return <>
    <SectionHeader title="Workspaces" detail="Saved sets of tabs. Save this window with the command “workspace save name”." />
    {(list.error || action.error) && <Notice tone="error">{list.error || action.error}</Notice>}
    {list.loading && !list.data && <Text tone="textSecondary">Loading workspaces…</Text>}
    {list.data && !list.data.length && <Text tone="textSecondary">No workspaces saved yet.</Text>}
    {!!list.data?.length && <FormGroup>
      {list.data.map(w => <FormRow key={w.name} title={w.name} detail={`Saved ${new Date(w.modified * 1000).toLocaleString()}`}>
        <Box row gap="sm">
          <Button label="Open" size="small" onPress={() => onOpen(w.name)} />
          <Button label="Delete" size="small" variant="dangerGhost" icon="trash" onPress={async () => {
            const next = await action.run('settings.deleteWorkspace', { name: w.name });
            if (next) list.set(next);
          }} />
        </Box>
      </FormRow>)}
    </FormGroup>}
  </>;
}

function ConfigEditor({ onSaved }: { onSaved(): void }) {
  const file = useRequest('settings.config', {});
  const action = useAction();
  const [text, setText] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => { if (file.data && text === null) setText(file.data.text); }, [file.data, text]);
  const dirty = text !== null && file.data !== null && text !== file.data.text;
  return <>
    <SectionHeader title="Config File" detail={file.data ? file.data.path : 'Merlin reads keys, commands and options from this file.'}>
      <Button label="Revert" disabled={!dirty || action.busy} onPress={() => { setText(file.data?.text ?? ''); setResult(null); }} />
      <Button label="Save and Reload" variant="primary" disabled={!dirty || action.busy} onPress={async () => {
        const error = await action.run('settings.saveConfig', { text: text ?? '' });
        if (error === undefined) return;
        setResult(error);
        if (!error) { file.set({ ...file.data!, text: text ?? '', found: true, error: '' }); onSaved(); }
      }} />
    </SectionHeader>
    <Box gap="md">
      {file.error && <Notice tone="error">{file.error}</Notice>}
      {file.data?.error && <Notice tone="error">{file.data.error}</Notice>}
      {result !== null && (result ? <Notice tone="error">{result}</Notice> : <Notice>Saved. Every window has reloaded the config.</Notice>)}
      {action.error && <Notice tone="error">{action.error}</Notice>}
      <View style={{ minHeight: geometry.sheetHeight / 2 }}>
        <Field multiline mono grow accessibilityLabel="Config file" value={text ?? ''} editable={text !== null && !action.busy}
          placeholder={file.data && !file.data.found ? '# No config file yet. Anything you write here creates it.' : ''}
          onChangeText={value => { setText(value); setResult(null); }} style={{ textAlignVertical: 'top' }} />
      </View>
    </Box>
  </>;
}

/** A colour-scheme choice drawn as a small Merlin window. */
function ThemeChoice({ mode, accent, selected, onPress }: {
  mode: Appearance['mode']; accent: AccentName; selected: boolean; onPress(): void;
}) {
  const { colors } = useTheme();
  const label = mode === 'system' ? 'Match system' : mode === 'light' ? 'Light' : 'Dark';
  const halves = mode === 'system' ? (['light', 'dark'] as const) : [mode];
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress}
    style={{ flex: 1, gap: space.sm, alignItems: 'center' }}>
    <View style={{ alignSelf: 'stretch', height: geometry.themePreview, borderRadius: radius.card, overflow: 'hidden', flexDirection: 'row',
      borderWidth: selected ? geometry.focusRing : geometry.hairline, borderColor: colors[selected ? 'accent' : 'borderDefault'] }}>
      {halves.map(half => {
        const c = themePreview(half, accent);
        return <View key={half} style={{ flex: 1, flexDirection: 'row', gap: space.xs + space.hair, padding: space.sm, backgroundColor: c.shell }}>
          {(half === 'light' || mode !== 'system') && <View style={{ width: geometry.previewSidebar, gap: space.xs }}>
            {[0, 1, 2].map(i => <View key={i} style={{ height: space.xs + space.hair, borderRadius: radius.xs, backgroundColor: c.bar,
              opacity: i === 1 ? 1 : opacity.dim }} />)}
          </View>}
          <View style={{ flex: 1, borderRadius: radius.sm, backgroundColor: c.card }} />
        </View>;
      })}
    </View>
    <Text weight="medium">{label}</Text>
  </Pressable>;
}

/** A workspace colour: the tint it gives the window, with its name. */
function Swatch({ name, selected, onPress }: { name: AccentName; selected: boolean; onPress(): void }) {
  const { colors, dark } = useTheme();
  const swatch = accentSwatch(dark ? 'dark' : 'light', name);
  return <Pressable accessibilityRole="radio" accessibilityLabel={accentLabels[name]} accessibilityState={{ selected }} onPress={onPress}
    style={{ alignItems: 'center', gap: space.xs + space.hair }}>
    <View style={{ padding: space.hair, borderRadius: radius.pill, borderWidth: geometry.focusRing,
      borderColor: colors[selected ? 'accent' : 'fillTransparent'] }}>
      <View style={{ width: geometry.swatch, height: geometry.swatch, borderRadius: radius.pill, backgroundColor: swatch.fill,
        alignItems: 'flex-end', justifyContent: 'flex-end' }}>
        <View style={{ width: geometry.dot + space.hair, height: geometry.dot + space.hair, borderRadius: radius.pill,
          backgroundColor: swatch.accent, borderWidth: geometry.hairline, borderColor: colors.contentBackground }} />
      </View>
    </View>
    <Text variant="label" tone={selected ? 'textPrimary' : 'textSecondary'}>{accentLabels[name]}</Text>
  </Pressable>;
}
