import React, { useEffect, useReducer, useState } from 'react';
import type { PreferenceKey, Preferences } from '../../state/types';
import { useAppIcons } from '../../state/system';
import { useUpdates } from '../../state/updates';
import { followAutoPip } from '../../state/webkit';
import { useAction, useActions, useRequest, useSnapshot } from '../../state/window';
import {
  Box, Button, Field, FormGroup, FormHighlight, FormRow, Icon, ListRow, Notice, Pressable, SectionHeader, Shake, PaletteScope, SheetFrame, SheetBody, Text, Toggle,
  geometry, radius, space, useInteraction, useTheme, settingsGeometry, settingsPalette,
} from '../ui';
import { searchSettings, type SettingsHit } from './searchIndex';
import { AppearancePane } from './AppearancePane';
import { ClearData } from './ClearData';
import { GeneralPane } from './GeneralPane';
import { SettingsIcon } from './SettingsIcon';
import { SettingsLayout } from './SettingsLayout';
import { initialHistory, navigate, sections } from './navigation';

const filterLists = [
  ['easylist', 'EasyList', 'Advertising requests and page elements.'],
  ['easyprivacy', 'EasyPrivacy', 'Tracking requests.'],
  ['ublock', 'uBlock compatibility', 'Scriptlets, quick fixes and site recovery rules.'],
  ['brave', 'Brave compatibility', 'Vetted site-specific fixes.'],
] as const;

type Set = (key: PreferenceKey, value: unknown) => void;

export function Settings({ open }: { open: boolean }) {
  const actions = useActions();
  const { dark } = useTheme();
  const [history, dispatch] = useReducer(navigate, initialHistory);
  const { section, query, highlight } = history.pages[history.index];
  const hits = searchSettings(query);
  const go = (hit: SettingsHit) => dispatch({ type: 'open', section: hit.section, highlight: hit.title });
  const prefs = useRequest('settings.get', {});
  const action = useAction();
  const set: Set = async (key, value) => {
    const next = await action.run('settings.set', { key, value });
    if (!next.ok) return;
    prefs.set(next.value);
    if (key === 'autoPip') followAutoPip(next.value.autoPip);
  };
  const openPage = (key: string) => void action.run('settings.openPage', { key });
  const p = prefs.data;
  const icons = useAppIcons(geometry.appIcon);
  const icon = icons.choices.find(choice => choice.id === icons.current)?.preview;
  const release = useUpdates(s => s.version);
  return <PaletteScope roles={settingsPalette[dark ? 'dark' : 'light']}>
    <SheetFrame open={open} title="Settings" fill="surfaceSheet" width={settingsGeometry.width} height={settingsGeometry.height}
      onClose={actions.closePanel} onClosed={actions.focusPage}>
      <SettingsLayout section={section} query={query} version={release} icon={icon} canBack={history.index > 0} canForward={history.index + 1 < history.pages.length}
        onStep={by => dispatch({ type: 'step', by })} onSearch={query => dispatch({ type: 'search', query })}
        onSection={section => dispatch({ type: 'open', section })} onClose={actions.closePanel}>
        {query.trim() ? <SearchResults query={query.trim()} hits={hits} onOpen={go} /> : <FormHighlight.Provider value={highlight ?? null}><SheetBody key={section} inset={settingsGeometry.inset} top={space.md}>
          {action.error && <Box marginBottom="lg"><Notice tone="error">{action.error}</Notice></Box>}
          {prefs.error && !p ? <Notice tone="error">{prefs.error}</Notice> : !p && section !== 'appearance' ? <Text tone="textSecondary">Loading settings…</Text> : <>
            {section === 'appearance' && <AppearancePane p={p} set={set} icons={icons} />}
            {p && section === 'general' && <GeneralPane p={p} set={set} icon={icon} openPage={openPage} onChooseDownloadDir={async () => {
              // The system folder picker stays open until the person chooses.
              const dir = await action.run('settings.chooseDownloadDir', {}, 10 * 60_000);
              if (dir.ok) prefs.reload();
            }} />}
            {p && section === 'privacy' && <>
              <FormGroup title="Passwords">
                <FormRow title="Offer to save passwords"><Toggle capsule label="Offer to save passwords" value={p.savePasswords} onChange={v => set('savePasswords', v)} /></FormRow>
              </FormGroup>
              <PageLinks openPage={openPage} links={[['passwords', 'Saved passwords'], ['password-checkup', 'Password checkup'],
                ['site-permissions', 'Site permissions'], ['cookies', 'Cookies and site data'], ['security', 'Safe browsing and security'],
                ['addresses', 'Addresses'], ['payments', 'Payment methods'], ['certificates', 'Certificates']]} />
              <ClearData openPage={openPage} />
            </>}
            {p && section === 'blocking' && <Blocking p={p} set={set} />}
            {p && section === 'performance' && <>
              <FormGroup title="Resource usage">
                <FormRow title="Memory Saver" detail="Frees memory from tabs you have not used in a while.">
                  <Toggle capsule label="Memory Saver" value={p.memorySaver} onChange={v => set('memorySaver', v)} /></FormRow>
                <FormRow title="Energy Saver" detail="Limits background activity when the battery is low.">
                  <Toggle capsule label="Energy Saver" value={p.energySaver} onChange={v => set('energySaver', v)} /></FormRow>
              </FormGroup>
            </>}
            {p && section === 'extensions' && <>
              <SectionHeader title="Installed extensions" detail="Turn installed extensions on or off.">
                <Button label="Manage" onPress={() => openPage('extensions')} />
                <Button label="Shortcuts" onPress={() => openPage('extension-shortcuts')} />
              </SectionHeader>
              {!p.extensions.length ? <Text tone="textSecondary">No extensions are installed.</Text> : <FormGroup>
                {p.extensions.map(ext => <FormRow key={ext.id} title={ext.name} detail={`Version ${ext.version}`}>
                  <Toggle capsule label={`${ext.name} enabled`} value={ext.enabled} disabled={!ext.canToggle}
                    onChange={enabled => set('extension', { id: ext.id, enabled })} /></FormRow>)}
              </FormGroup>}
            </>}
            {section === 'workspaces' && <Workspaces onOpen={name => { void actions.command(`space open ${name}`); actions.closePanel(); }} />}
            {p && section === 'keys' && <>
              <ModalBrowsing />
              <FormGroup title="Key bindings" detail={`Link hints use ${p.hintChars || 'the default characters'}.`}>
                {p.bindings.map(b => <FormRow key={`${b.keys}:${b.command}`} title={b.desc || b.command} detail={b.desc ? b.command : undefined}>
                  <Text variant="mono">{b.keys}</Text></FormRow>)}
              </FormGroup>
            </>}
            {section === 'config' && <ConfigEditor onSaved={prefs.reload} />}
            {p && section === 'about' && <>
              <FormGroup title="Build information">
                <FormRow title="Version"><Text tone="textSecondary">{release ?? 'Development build'}</Text></FormRow>
                <FormRow title="Engine"><Text tone="textSecondary">{`Chromium ${p.about.version}`}</Text></FormRow>
                <FormRow title="System"><Text tone="textSecondary">{p.about.os.replace(/^Mac OS X$/, 'macOS')}</Text></FormRow>
              </FormGroup>
              <Box row gap="sm">
                <Button label="Build details" onPress={() => openPage('version')} />
                <Button label="Open-source credits" onPress={() => openPage('credits')} />
              </Box>
            </>}
          </>}
        </SheetBody></FormHighlight.Provider>}
      </SettingsLayout>
    </SheetFrame>
  </PaletteScope>;
}

/** Settings that match what was typed, each with its section; choosing one shows it in place. */
function SearchResults({ query, hits, onOpen }: { query: string; hits: SettingsHit[]; onOpen(hit: SettingsHit): void }) {
  return <SheetBody inset={settingsGeometry.inset} top={space.md}>
    <SectionHeader title={hits.length ? `${hits.length} matching ${hits.length === 1 ? 'setting' : 'settings'}` : 'No results'}
      detail={hits.length ? undefined : `Nothing in Settings matches “${query}”. Try another word, such as “tabs” or “dark”.`} />
    {!!hits.length && <FormGroup>
      {hits.map(hit => <SearchHit key={`${hit.section}:${hit.title}`} hit={hit} onPress={() => onOpen(hit)} />)}
    </FormGroup>}
  </SheetBody>;
}

function SearchHit({ hit, onPress }: { hit: SettingsHit; onPress(): void }) {
  const { colors } = useTheme();
  const { hovered, handlers } = useInteraction();
  const place = sections.find(s => s.id === hit.section);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${hit.title}, in ${place?.label ?? hit.section}`} onPress={onPress} {...handlers}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: geometry.rowTall, marginHorizontal: -space.sm,
      paddingHorizontal: space.sm, borderRadius: radius.control, backgroundColor: colors[hovered ? 'fillHover' : 'fillTransparent'] }}>
    {place && <SettingsIcon section={place.id} />}
    <Text flex={1}>{hit.title}</Text>
    <Text variant="label" weight="regular" tone="textSecondary">{place?.label}</Text>
    <Icon name="chevron.right" tone="iconSecondary" size="chevron" />
  </Pressable>;
}

function PageLinks({ links, openPage }: { links: readonly (readonly [string, string])[]; openPage(key: string): void }) {
  return <FormGroup title="Site settings and saved information">
    {links.map(([key, title]) => <ListRow key={key} title={title} onPress={() => openPage(key)}
      tall trailing={<Icon name="chevron.right" size="chevron" tone="iconSecondary" />} />)}
  </FormGroup>;
}

function Blocking({ p, set }: { p: Preferences; set: Set }) {
  const a = p.adblock;
  return <>
    <FormGroup title="Ad and tracker blocking" detail={a.available ? a.status : 'Ad blocking is not available in this build.'}>
      <FormRow title="Block ads and trackers"><Toggle capsule label="Block ads and trackers" value={a.enabled && a.available}
        disabled={!a.available} onChange={v => set('adblock', v)} /></FormRow>
      <FormRow title="Update filter lists automatically" detail={a.private ? 'Managed by your main profile.' : a.updateStatus}>
        <Toggle capsule label="Update filter lists automatically" value={a.automatic} disabled={!a.available || a.private}
          onChange={v => set('adblockUpdates', v)} /></FormRow>
      <FormRow title="Last update" detail={a.lastUpdate ? new Date(a.lastUpdate * 1000).toLocaleString() : 'Using the lists bundled with Merlin.'}>
        <Button label="Update Now" disabled={!a.available || a.private} onPress={() => set('adblockRefresh', null)} /></FormRow>
    </FormGroup>
    <FormGroup title="Filter lists">
      {filterLists.map(([id, name, detail]) => <FormRow key={id} title={name} detail={detail}>
        <Toggle capsule label={name} value={a.groups.includes(id)} disabled={!a.available} onChange={on => {
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
    <SectionHeader title="Saved spaces" detail="Spaces kept in a file too, with their tabs. Save the space showing from its ⋯ menu or with “space save name”; opening one adds it to this window as a space." />
    {(list.error || action.error) && <Notice tone="error">{list.error || action.error}</Notice>}
    {list.loading && !list.data && <Text tone="textSecondary">Loading saved spaces…</Text>}
    {list.data && !list.data.length && <Text tone="textSecondary">No spaces saved yet.</Text>}
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
  // A save the config refuses (it doesn't parse) shakes the editor, every time.
  const [refused, setRefused] = useState(0);
  useEffect(() => { if (file.data && !file.loading && text === null) setText(file.data.text); }, [file.data, file.loading, text]);
  const dirty = text !== null && file.data !== null && text !== file.data.text;
  return <>
    <SectionHeader title="Configuration" detail={file.data ? file.data.path : 'Merlin reads keys, commands and options from this file.'}>
      {/* Reads the file again: it may have changed since it was opened here. */}
      <Button label="Revert" disabled={!dirty || action.busy} onPress={() => { setText(null); setResult(null); file.reload(); }} />
      <Button label="Save and Reload" variant="primary" disabled={!dirty || action.busy || file.loading} onPress={async () => {
        // The save names the version it was edited from, and is refused if the file changed since.
        const saved = await action.run('settings.saveConfig', { text: text ?? '', revision: file.data?.revision ?? '' });
        if (!saved.ok) return;  // shown as action.error
        setResult(saved.value.error);
        if (saved.value.error) setRefused(n => n + 1);
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
      <Shake count={refused} radius={radius.field} style={{ minHeight: geometry.sheetHeight / 2 }}>
        <Field multiline mono grow accessibilityLabel="Config file" value={text ?? ''} editable={text !== null && !action.busy}
          placeholder={file.data && !file.data.found ? '# No config file yet. Anything you write here creates it.' : ''}
          onChangeText={value => { setText(value); setResult(null); }} style={{ textAlignVertical: 'top' }} />
      </Shake>
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
      <Toggle capsule label="Modal browsing" value={on} disabled={action.busy} onChange={async value => {
        setError('');
        const result = await action.run('settings.setOption', { name: 'modal_browsing', value });
        if (result.ok && result.value) setError(result.value);
      }} />
    </FormRow>
  </FormGroup>;
}
