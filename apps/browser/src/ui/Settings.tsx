import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { Appearance, EngineClient, PreferenceKey, Preferences } from '@merlin/engine/protocol';
import { Button, Field, Label, Row } from './components';
import { Choice, Group, Notice, Setting, Sheet, SheetBody, Toggle, useAction, useRequest } from './controls';
import { useTheme } from './Theme';
import { space } from './tokens';

const sections = [
  { id: 'appearance', label: 'Appearance', icon: 'paintbrush' },
  { id: 'general', label: 'General', icon: 'gearshape' },
  { id: 'downloads', label: 'Downloads', icon: 'arrow.down.circle' },
  { id: 'privacy', label: 'Privacy', icon: 'lock.shield' },
  { id: 'blocking', label: 'Blocking', icon: 'hand.raised' },
  { id: 'performance', label: 'Performance', icon: 'bolt' },
  { id: 'extensions', label: 'Extensions', icon: 'puzzlepiece.extension' },
  { id: 'workspaces', label: 'Workspaces', icon: 'rectangle.stack' },
  { id: 'keys', label: 'Keys', icon: 'keyboard' },
  { id: 'config', label: 'Config file', icon: 'doc.text' },
  { id: 'about', label: 'About', icon: 'info.circle' },
] as const;
export type SettingsSection = typeof sections[number]['id'];

const filterLists = [
  ['easylist', 'EasyList', 'Advertising requests and page elements.'],
  ['easyprivacy', 'EasyPrivacy', 'Tracking requests.'],
  ['ublock', 'uBlock compatibility', 'Scriptlets, quick fixes and site recovery rules.'],
  ['brave', 'Brave compatibility', 'Vetted site-specific fixes.'],
] as const;

export function Settings({ engine, appearance, onAppearance, onCommand, onClose, initial = 'appearance' }: {
  engine: EngineClient; appearance: Appearance; onAppearance(patch: Partial<Appearance>): void;
  onCommand(text: string): void; onClose(): void; initial?: SettingsSection;
}) {
  const [section, setSection] = useState<SettingsSection>(initial);
  const prefs = useRequest(engine, 'settings.get', {});
  const action = useAction(engine);
  const set = async (key: PreferenceKey, value: unknown) => {
    const next = await action.run('settings.set', { key, value });
    if (next) prefs.set(next);
  };
  const openPage = (key: string) => void action.run('settings.openPage', { key });
  const p = prefs.data;
  return <Sheet<SettingsSection> title="Settings" sections={sections} section={section} onSection={setSection} onClose={onClose}>
    <SheetBody>
      {action.error && <View style={{ marginBottom: space.lg }}><Notice tone="error">{action.error}</Notice></View>}
      {prefs.error && !p ? <Notice tone="error">{prefs.error}</Notice> : !p && section !== 'appearance' ? <Label muted>Loading settings…</Label> : <>
        {section === 'appearance' && <Group title="Appearance" detail="How Merlin looks. Web pages follow the color scheme too.">
          <Setting title="Color scheme"><Choice label="Color scheme" value={appearance.mode} onChange={mode => onAppearance({ mode })}
            options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} /></Setting>
          <Setting title="Accent"><Choice label="Accent color" value={appearance.accent} onChange={accent => onAppearance({ accent })}
            options={[{ value: 'ocean', label: 'Ocean' }, { value: 'iris', label: 'Iris' }, { value: 'fern', label: 'Fern' }]} /></Setting>
          <Setting title="Reduce motion" detail="Panels appear without animation.">
            <Toggle label="Reduce motion" value={appearance.reduceMotion} onChange={reduceMotion => onAppearance({ reduceMotion })} /></Setting>
          {p && <Setting title="Default page zoom"><Choice label="Default zoom" value={p.zoom} onChange={zoom => void set('zoom', zoom)}
            options={p.zoomChoices.filter(z => z >= 75 && z <= 150).map(z => ({ value: z, label: `${z}%` }))} /></Setting>}
        </Group>}
        {p && section === 'general' && <General p={p} set={set} openPage={openPage} />}
        {p && section === 'downloads' && <Group title="Downloads">
          <Setting title="Save files to" detail={p.downloadDir || 'Not set'}>
            <Button title="Change…" disabled={action.busy} onPress={async () => {
              // The system folder picker stays open until the person chooses.
              const dir = await action.run('settings.chooseDownloadDir', {}, 10 * 60_000);
              if (dir !== undefined) prefs.reload();
            }} /></Setting>
          <Setting title="Ask where to save each file"><Toggle label="Ask where to save each file" value={p.askWhere} onChange={v => void set('askWhere', v)} /></Setting>
        </Group>}
        {p && section === 'privacy' && <Group title="Privacy" detail="Passwords, site permissions and browsing data.">
          <Setting title="Offer to save passwords"><Toggle label="Offer to save passwords" value={p.savePasswords} onChange={v => void set('savePasswords', v)} /></Setting>
          {([['passwords', 'Saved passwords'], ['password-checkup', 'Password checkup'], ['site-permissions', 'Site permissions'],
            ['cookies', 'Cookies and site data'], ['security', 'Safe browsing and security'], ['clear-data', 'Clear browsing data'],
            ['addresses', 'Addresses'], ['payments', 'Payment methods'], ['certificates', 'Certificates']] as const).map(([key, title]) =>
            <Row key={key} title={title} onPress={() => openPage(key)} trailing={<Label muted>Open</Label>} />)}
        </Group>}
        {p && section === 'blocking' && <Blocking p={p} set={set} />}
        {p && section === 'performance' && <Group title="Performance">
          <Setting title="Memory Saver" detail="Frees memory from tabs you have not used in a while.">
            <Toggle label="Memory Saver" value={p.memorySaver} onChange={v => void set('memorySaver', v)} /></Setting>
          <Setting title="Energy Saver" detail="Limits background activity when the battery is low.">
            <Toggle label="Energy Saver" value={p.energySaver} onChange={v => void set('energySaver', v)} /></Setting>
        </Group>}
        {p && section === 'extensions' && <Group title="Extensions" detail="Turn installed extensions on or off.">
          {!p.extensions.length && <Label muted>No extensions are installed.</Label>}
          {p.extensions.map(ext => <Setting key={ext.id} title={ext.name} detail={`Version ${ext.version}`}>
            <Toggle label={`${ext.name} enabled`} value={ext.enabled} disabled={!ext.canToggle}
              onChange={enabled => void set('extension', { id: ext.id, enabled })} /></Setting>)}
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
            <Button title="Manage extensions" onPress={() => openPage('extensions')} />
            <Button title="Keyboard shortcuts" onPress={() => openPage('extension-shortcuts')} />
          </View>
        </Group>}
        {section === 'workspaces' && <Workspaces engine={engine} onOpen={name => { onCommand(`workspace open ${name}`); onClose(); }} />}
        {p && section === 'keys' && <Group title="Keys" detail={`Normal-mode bindings from your config. Link hints use: ${p.hintChars || 'the default characters'}.`}>
          {p.bindings.map(b => <Setting key={`${b.keys}:${b.command}`} title={b.desc || b.command} detail={b.desc ? b.command : undefined}>
            <Label style={{ fontFamily: 'Menlo' }}>{b.keys}</Label></Setting>)}
        </Group>}
        {section === 'config' && <ConfigEditor engine={engine} onSaved={prefs.reload} />}
        {p && section === 'about' && <Group title="About Merlin">
          <Setting title="Version"><Label>{p.about.version}</Label></Setting>
          <Setting title="System"><Label>{p.about.os}</Label></Setting>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
            <Button title="Build details" onPress={() => openPage('version')} />
            <Button title="Open-source credits" onPress={() => openPage('credits')} />
          </View>
        </Group>}
      </>}
    </SheetBody>
  </Sheet>;
}

function General({ p, set, openPage }: { p: Preferences; set(key: PreferenceKey, value: unknown): void; openPage(key: string): void }) {
  return <>
    <Group title="Startup">
      <Setting title="When Merlin starts"><Choice label="When Merlin starts" value={p.startup} onChange={v => set('startup', v)}
        options={[{ value: 'last', label: 'Reopen my tabs' }, { value: 'start', label: 'Open a start page' }]} /></Setting>
      <Setting title="Control-Tab switches" detail="Between tabs in the order they appear, or most recently used first.">
        <Choice label="Control-Tab order" value={p.ctrlTab} onChange={v => set('ctrlTab', v)}
          options={[{ value: 'recent', label: 'Recent first' }, { value: 'order', label: 'In order' }]} /></Setting>
    </Group>
    <Group title="Search" detail={p.engineManaged ? 'Your organization manages the search engine.' : 'Used by the address field and the command menu.'}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {p.engines.map(e => <Button key={e.id} title={e.name} disabled={p.engineManaged}
          emphasis={e.id === p.engine ? 'primary' : 'normal'} onPress={() => set('engine', e.id)} />)}
      </View>
      <View style={{ marginTop: space.md }}><Row title="Manage search engines" onPress={() => openPage('search-engines')} /></View>
    </Group>
    <Group title="More">
      {([['languages', 'Languages'], ['fonts', 'Fonts'], ['accessibility', 'Accessibility'], ['system', 'System'],
        ['import', 'Import bookmarks and settings'], ['reset', 'Reset settings']] as const).map(([key, title]) =>
        <Row key={key} title={title} onPress={() => openPage(key)} trailing={<Label muted>Open</Label>} />)}
    </Group>
  </>;
}

function Blocking({ p, set }: { p: Preferences; set(key: PreferenceKey, value: unknown): void }) {
  const a = p.adblock;
  return <Group title="Blocking" detail={a.available ? a.status : 'Ad blocking is not available in this build.'}>
    <Setting title="Block ads and trackers"><Toggle label="Block ads and trackers" value={a.enabled && a.available}
      disabled={!a.available} onChange={v => set('adblock', v)} /></Setting>
    <Setting title="Update filter lists automatically" detail={a.private ? 'Managed by your main profile.' : a.updateStatus}>
      <Toggle label="Update filter lists automatically" value={a.automatic} disabled={!a.available || a.private}
        onChange={v => set('adblockUpdates', v)} /></Setting>
    <Setting title="Last update" detail={a.lastUpdate ? new Date(a.lastUpdate * 1000).toLocaleString() : 'Using the lists bundled with Merlin.'}>
      <Button title="Update now" disabled={!a.available || a.private} onPress={() => set('adblockRefresh', null)} /></Setting>
    {filterLists.map(([id, name, detail]) => <Setting key={id} title={name} detail={detail}>
      <Toggle label={name} value={a.groups.includes(id)} disabled={!a.available} onChange={on => {
        const groups = new Set(a.groups); if (on) groups.add(id); else groups.delete(id);
        set('adblockLists', [...groups]);
      }} /></Setting>)}
    {!!a.exceptions.length && <View style={{ marginTop: space.lg }}>
      <Label muted size="caption">SITES WHERE BLOCKING IS OFF</Label>
      {a.exceptions.map(host => <Setting key={host} title={host}>
        <Button title="Turn blocking back on" onPress={() => set('adblockException', host)} /></Setting>)}
    </View>}
  </Group>;
}

function Workspaces({ engine, onOpen }: { engine: EngineClient; onOpen(name: string): void }) {
  const list = useRequest(engine, 'settings.workspaces', {});
  const action = useAction(engine);
  return <Group title="Workspaces" detail="Saved sets of tabs. Save the current window with the command “workspace save name”.">
    {(list.error || action.error) && <Notice tone="error">{list.error || action.error}</Notice>}
    {list.loading && !list.data && <Label muted>Loading workspaces…</Label>}
    {list.data && !list.data.length && <Label muted>No workspaces saved yet.</Label>}
    {list.data?.map(w => <Setting key={w.name} title={w.name} detail={`Saved ${new Date(w.modified * 1000).toLocaleString()}`}>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button title="Open" onPress={() => onOpen(w.name)} />
        <Button title={`Delete ${w.name}`} icon="trash" iconOnly emphasis="danger" onPress={async () => {
          const next = await action.run('settings.deleteWorkspace', { name: w.name });
          if (next) list.set(next);
        }} />
      </View>
    </Setting>)}
  </Group>;
}

function ConfigEditor({ engine, onSaved }: { engine: EngineClient; onSaved(): void }) {
  const t = useTheme();
  const file = useRequest(engine, 'settings.config', {});
  const action = useAction(engine);
  const [text, setText] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => { if (file.data && text === null) setText(file.data.text); }, [file.data, text]);
  const dirty = text !== null && file.data !== null && text !== file.data.text;
  return <Group title="Config file" detail={file.data ? file.data.path : 'Merlin reads keys, commands and options from this file.'}>
    {file.error && <Notice tone="error">{file.error}</Notice>}
    {file.data?.error && <Notice tone="error">{file.data.error}</Notice>}
    {result !== null && (result ? <Notice tone="error">{result}</Notice> : <Notice>Saved. Every window has reloaded the config.</Notice>)}
    <Field multiline accessibilityLabel="Config file" value={text ?? ''} editable={text !== null && !action.busy}
      placeholder={file.data && !file.data.found ? '# No config file yet. Anything you write here creates it.' : ''}
      onChangeText={value => { setText(value); setResult(null); }}
      style={{ minHeight: 320, fontFamily: 'Menlo', fontSize: 12, textAlignVertical: 'top', marginTop: space.md }} />
    <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md, justifyContent: 'flex-end' }}>
      <Button title="Revert" disabled={!dirty || action.busy} onPress={() => { setText(file.data?.text ?? ''); setResult(null); }} />
      <Button title="Save and reload" emphasis="primary" disabled={!dirty || action.busy} onPress={async () => {
        const error = await action.run('settings.saveConfig', { text: text ?? '' });
        if (error === undefined) return;
        setResult(error);
        if (!error) { file.set({ ...file.data!, text: text ?? '', found: true, error: '' }); onSaved(); }
      }} />
    </View>
    {action.error && <Label style={{ color: t.danger }}>{action.error}</Label>}
  </Group>;
}
