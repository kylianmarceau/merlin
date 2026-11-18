import React, { useState } from 'react';
import { View } from 'react-native';
import { effectiveChannel } from '../../lib/updates';
import { useShellPrefs } from '../../state/shellPrefs';
import { setProtectedVideoInWebKit, forgetSiteEngines, setShellPref } from '../../state/shellPrefsStorage';
import { exportStatus } from '../../state/bookmarkExport';
import { exportBookmarks, useDefaultBrowser, useLoginItem, type ExportOutcome } from '../../state/system';
import type { Preferences, PreferenceKey } from '../../state/types';
import { checkForUpdates, useUpdates } from '../../state/updates';
import { useAction, useActions } from '../../state/window';
import { Button, FormGroup, FormRow, Icon, ListRow, Notice, PopUp, Segmented, Spinner, Text, Toggle, space } from '../ui';

type Set = (key: PreferenceKey, value: unknown) => void;

/**
 * Settings › General, after Ardia's: the default browser, starting and
 * quitting, what typed text means, downloads, updates, import and export.
 * Merlin's own startup, Control-Tab, search and protected-video settings
 * sit where they belong among them.
 */
export function GeneralPane({ p, set, openPage, onChooseDownloadDir }: {
  p: Preferences; set: Set; openPage(key: string): void; onChooseDownloadDir(): void;
}) {
  const prefs = useShellPrefs(s => s);
  const login = useLoginItem();
  return <>
    <DefaultBrowser />

    <FormGroup title="General">
      <FormRow title="Open Merlin at login"
        detail={login.status === 'requiresApproval' ? 'Allow it in System Settings › General › Login Items.' : undefined}>
        <Toggle label="Open Merlin at login" value={login.status === 'enabled' || login.status === 'requiresApproval'} onChange={login.set} />
      </FormRow>
      {login.error && <Notice tone="error">{login.error}</Notice>}
      <FormRow title="Warn before quitting" detail="Asks before Merlin quits with ⌘Q.">
        <Toggle label="Warn before quitting" value={prefs.warnBeforeQuitting} onChange={on => void setShellPref('warnBeforeQuitting', on)} />
      </FormRow>
      <FormRow title="Warn before closing a window with multiple tabs" detail="Asks before ⇧⌘W or the close button closes its tabs.">
        <Toggle label="Warn before closing a window with multiple tabs" value={prefs.warnBeforeClosingWindow}
          onChange={on => void setShellPref('warnBeforeClosingWindow', on)} />
      </FormRow>
      <FormRow title="Control-Tab switches" detail="Between tabs in the order they appear, or most recently used first.">
        <Segmented label="Control-Tab order" value={p.ctrlTab} onChange={v => set('ctrlTab', v)}
          options={[{ value: 'recent', label: 'Recent first' }, { value: 'order', label: 'In order' }]} />
      </FormRow>
      {p.autoPip !== undefined && <FormRow title="Float videos when you switch tabs"
        detail="A video playing with sound moves to a picture-in-picture window, and back when you return.">
        <Toggle label="Float videos when you switch tabs" value={p.autoPip} onChange={on => set('autoPip', on)} />
      </FormRow>}
    </FormGroup>

    <FormGroup title="When quitting Merlin:">
      <FormRow title="Windows and tabs" detail="What you see the next time you open it. Closed windows stay in History.">
        <PopUp label="Windows and tabs" value={p.startup}
          options={[{ value: 'last', title: 'Preserve tabs and windows' }, { value: 'start', title: 'Start fresh' }]}
          onChange={v => set('startup', v)} />
      </FormRow>
    </FormGroup>

    <FormGroup title="Command bar" detail="What happens when what you type could be a website or a search.">
      <FormRow title="When input looks like a website">
        <PopUp label="When input looks like a website" value={prefs.searchPreference}
          options={[{ value: 'website', title: 'Use Website First' }, { value: 'search', title: 'Prefer Search Engine' }]}
          onChange={v => void setShellPref('searchPreference', v)} />
      </FormRow>
      <FormRow title="Search engine" detail={p.engineManaged ? 'Your organisation manages the search engine.' : undefined}>
        <PopUp label="Search engine" value={p.engine} disabled={p.engineManaged} onChange={id => set('engine', id)}
          options={p.engines.map(e => ({ value: e.id, title: e.name }))} />
      </FormRow>
      <ListRow title="Manage search engines" onPress={() => openPage('search-engines')} trailing={<Text variant="caption">Open</Text>} />
    </FormGroup>

    <FormGroup title="Downloads">
      <FormRow title="Downloads folder" detail={p.downloadDir ? p.downloadDir.replace(/^\/Users\/[^/]+(?=\/|$)/, '~') : 'Not set'}>
        <Button label="Change…" onPress={onChooseDownloadDir} />
      </FormRow>
      <FormRow title="Ask where to save each file">
        <Toggle label="Ask where to save each file" value={p.askWhere} onChange={v => set('askWhere', v)} />
      </FormRow>
    </FormGroup>

    <Updates />

    <ImportExport openPage={openPage} />

    <ProtectedVideo />

    <FormGroup title="More">
      {([['languages', 'Languages'], ['fonts', 'Fonts'], ['accessibility', 'Accessibility'], ['system', 'System'],
        ['reset', 'Reset settings']] as const).map(([key, title]) =>
        <ListRow key={key} title={title} onPress={() => openPage(key)} trailing={<Text variant="caption">Open</Text>} />)}
    </FormGroup>
  </>;
}

function DefaultBrowser() {
  const { isDefault, make, error } = useDefaultBrowser();
  return <FormGroup>
    <FormRow title={isDefault ? 'Merlin is your default browser' : 'Merlin works best as your default browser'}
      detail={isDefault ? undefined : 'Links from other apps open in Merlin. macOS asks you to confirm.'}>
      {isDefault ? <Icon name="checkmark.seal.fill" tone="textSuccess" size="large" />
        : <Button label="Set Merlin as Default" variant="primary" onPress={make} />}
    </FormRow>
    {error && <Notice tone="error">{error}</Notice>}
  </FormGroup>;
}

function Updates() {
  const actions = useActions();
  const prefs = useShellPrefs(s => s);
  const state = useUpdates(s => s);
  const ready = !!state.version;
  const channel = effectiveChannel(prefs.updateChannel, state.version);
  const status = state.status === 'checking' ? 'Checking…'
    : state.status === 'available' && state.update ? `${state.update.name} is available.`
    : state.status === 'current' ? 'Merlin is up to date.'
    : state.status === 'failed' ? `Couldn’t check: ${state.error}`
    : state.lastCheck ? `Last checked ${new Date(state.lastCheck).toLocaleString()}.` : 'Not checked yet.';
  return <FormGroup title="Updates" detail={ready
    ? 'Merlin asks GitHub Releases for a newer version only when you check, or with automatic checks on. It never installs anything itself.'
    : 'This build was not packaged as a release, so it has no version to compare.'}>
    <FormRow title="Check for updates automatically" detail="Every eight hours while Merlin is open. Off by default.">
      <Toggle label="Check for updates automatically" value={ready && prefs.updateChecks} disabled={!ready}
        onChange={on => void setShellPref('updateChecks', on)} />
    </FormRow>
    <FormRow title="Update channel" detail="Beta gets every pre-release first. Switching back to Stable never offers an older version.">
      <PopUp label="Update channel" value={channel} disabled={!ready}
        options={[{ value: 'stable', title: 'Stable' }, { value: 'beta', title: 'Beta' }]}
        onChange={v => void setShellPref('updateChannel', v)} />
    </FormRow>
    <FormRow title={ready ? `Merlin ${state.version}` : 'Merlin'} detail={ready ? status : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {state.status === 'checking' && <Spinner />}
        {state.status === 'available' && state.update
          ? <Button label="View Release" variant="primary" onPress={() => { void actions.newTab(state.update!.url); actions.closePanel(); }} />
          : <Button label="Check Now" disabled={!ready || state.status === 'checking'} onPress={() => void checkForUpdates()} />}
      </View>
    </FormRow>
  </FormGroup>;
}

function ImportExport({ openPage }: { openPage(key: string): void }) {
  const action = useAction();
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null);
  const status = exportStatus(outcome);
  return <FormGroup title="Import and Export">
    <FormRow title="Import from another browser" detail="Bookmarks, history, passwords and settings from Chrome, Safari, Firefox and more.">
      <Button label="Import…" onPress={() => openPage('import')} />
    </FormRow>
    <FormRow title="Export bookmarks" detail={status.detail}>
      <Button label="Export…" disabled={action.busy} onPress={async () => {
        const next = await exportBookmarks(file => action.run('bookmarks.export', { path: file }));
        if (next.kind !== 'cancelled') setOutcome(next);
      }} />
    </FormRow>
    {status.error && <Notice tone="error">{status.error}</Notice>}
  </FormGroup>;
}

/** Sites Chromium can't play open in WebKit (state/webkit.ts). */
function ProtectedVideo() {
  const on = useShellPrefs(s => s.protectedVideoInWebKit);
  const moved = useShellPrefs(s => Object.keys(s.siteEngines).length);
  return <FormGroup title="Protected video"
    detail="Netflix, Disney+, Prime Video, Spotify and similar services need DRM that Merlin’s Chromium doesn’t have. WebKit, Safari’s engine, plays them. WebKit keeps its own sign-ins.">
    <FormRow title="Open protected video sites in WebKit">
      <Toggle label="Open protected video sites in WebKit" value={on} onChange={v => void setProtectedVideoInWebKit(v)} /></FormRow>
    <FormRow title="Sites you moved" detail={moved ? `${moved} site${moved === 1 ? '' : 's'} open in the engine you chose from the tab menu.` : 'Right-click a tab to open its site in the other engine.'}>
      <Button label="Forget" disabled={!moved} onPress={() => void forgetSiteEngines()} /></FormRow>
  </FormGroup>;
}
