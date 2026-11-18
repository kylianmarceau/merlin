import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { PreferenceKey, Preferences } from '../../state/types';
import { useAction, useActions, useRequest, useSnapshot } from '../../state/window';
import {
  Box, Button, Field, FormGroup, FormRow, ListRow, Notice, SectionHeader, Sheet, SheetBody, Text, Toggle, geometry,
  type SheetSection,
} from '../ui';
import { AppearancePane } from './AppearancePane';
import { ClearData } from './ClearData';
import { GeneralPane } from './GeneralPane';

// Merlin's own icons for each section: a window with its sidebar, a switch, a
// closed eye, a no-entry sign, a box, stacked cards, ⌘, braces and the M.
const sections = [
  { id: 'appearance', label: 'Appearance', icon: 'sidebar.left' },
  { id: 'general', label: 'General', icon: 'switch.2' },
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
  const [section, setSection] = useState<SettingsSection>('appearance');
  const prefs = useRequest('settings.get', {});
  const action = useAction();
  const set: Set = async (key, value) => {
    const next = await action.run('settings.set', { key, value });
    if (next.ok) prefs.set(next.value);
  };
  const openPage = (key: string) => void action.run('settings.openPage', { key });
  const p = prefs.data;
  return <Sheet<SettingsSection> open={open} title="Settings" sections={sections} section={section} onSection={setSection}
    onClose={actions.closePanel}>
    <SheetBody>
      {action.error && <Box marginBottom="lg"><Notice tone="error">{action.error}</Notice></Box>}
      {prefs.error && !p ? <Notice tone="error">{prefs.error}</Notice> : !p && section !== 'appearance' ? <Text tone="textSecondary">Loading settings…</Text> : <>
        {section === 'appearance' && <AppearancePane p={p} set={set} />}
        {p && section === 'general' && <GeneralPane p={p} set={set} openPage={openPage} onChooseDownloadDir={async () => {
          // The system folder picker stays open until the person chooses.
          const dir = await action.run('settings.chooseDownloadDir', {}, 10 * 60_000);
          if (dir.ok) prefs.reload();
        }} />}
        {p && section === 'privacy' && <>
          <SectionHeader title="Privacy" detail="Passwords, site permissions and browsing data." />
          <FormGroup>
            <FormRow title="Offer to save passwords"><Toggle label="Offer to save passwords" value={p.savePasswords} onChange={v => set('savePasswords', v)} /></FormRow>
          </FormGroup>
          <PageLinks openPage={openPage} links={[['passwords', 'Saved passwords'], ['password-checkup', 'Password checkup'],
            ['site-permissions', 'Site permissions'], ['cookies', 'Cookies and site data'], ['security', 'Safe browsing and security'],
            ['addresses', 'Addresses'], ['payments', 'Payment methods'], ['certificates', 'Certificates']]} />
          <ClearData openPage={openPage} />
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
          <ModalBrowsing />
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
            if (next.ok) list.set(next.value);
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
  useEffect(() => { if (file.data && !file.loading && text === null) setText(file.data.text); }, [file.data, file.loading, text]);
  const dirty = text !== null && file.data !== null && text !== file.data.text;
  return <>
    <SectionHeader title="Config File" detail={file.data ? file.data.path : 'Merlin reads keys, commands and options from this file.'}>
      {/* Reads the file again: it may have changed since it was opened here. */}
      <Button label="Revert" disabled={!dirty || action.busy} onPress={() => { setText(null); setResult(null); file.reload(); }} />
      <Button label="Save and Reload" variant="primary" disabled={!dirty || action.busy || file.loading} onPress={async () => {
        // The save names the version it was edited from, and is refused if the file changed since.
        const saved = await action.run('settings.saveConfig', { text: text ?? '', revision: file.data?.revision ?? '' });
        if (!saved.ok) return;  // shown as action.error
        setResult(saved.value.error);
        if (!saved.value.error) {
          file.set({ ...file.data!, text: text ?? '', found: true, error: '', revision: saved.value.revision });
          onSaved();
        }
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

/**
 * The keyboard layer on or off. The value lives in the config file
 * (`modal_browsing`), so Settings writes it there and every window rereads it.
 */
function ModalBrowsing() {
  const on = useSnapshot().modal.modalBrowsing ?? true;
  const action = useAction();
  const [error, setError] = useState('');
  return <FormGroup>
    {(error || action.error) && <Notice tone="error">{error || action.error}</Notice>}
    <FormRow title="Modal browsing" detail="Vim-style keys on pages. Off, every key goes to the page as in any other browser; ⌘K, the menus and the mouse still reach everything.">
      <Toggle label="Modal browsing" value={on} disabled={action.busy} onChange={async value => {
        setError('');
        const result = await action.run('settings.setOption', { name: 'modal_browsing', value });
        if (result.ok && result.value) setError(result.value);
      }} />
    </FormRow>
  </FormGroup>;
}
