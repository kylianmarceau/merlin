import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useStore } from 'zustand';
import { connectEngine, type Calls, type Method, type Appearance, type Snapshot, type Tab } from '@merlin/engine';
import { BrowserPage } from '@merlin/shell';
import { attachEngine, createBrowserStore } from './state/browser';
import { ThemeScope, useTheme } from './ui/Theme';
import { Button, Dialog, Field, Label } from './ui/components';
import { Settings } from './ui/Settings';
import { Library, type LibrarySection } from './ui/Library';
import { Extensions, Profiles } from './ui/Extensions';
import { visibleSurface } from './ui/surfaces';
import { CommandMenu } from './ui/CommandMenu';
import { StartPage } from './ui/StartPage';
import { BrowserPrompt } from './ui/BrowserPrompt';
import { FindBox } from './ui/FindBox';
import { TabSidebar } from './ui/TabSidebar';
import { TabActions } from './ui/TabActions';
import { geometry, radius, space } from './ui/tokens';

export function App({ windowId }: { windowId: string }) {
  const connection = useMemo(() => {
    try { return { engine: connectEngine(windowId), error: null }; }
    catch (e) { return { engine: null, error: e instanceof Error ? e.message : String(e) }; }
  }, [windowId]);
  const store = useMemo(() => createBrowserStore(windowId), [windowId]);
  useEffect(() => connection.engine ? attachEngine(store, connection.engine) : undefined, [store, connection]);
  const state = useStore(store);
  const appearance = state.snapshot?.appearance ?? { mode: 'system', accent: 'ocean', reduceMotion: false };
  return <ThemeScope appearance={appearance}>
    {connection.engine && state.snapshot ? <Browser store={store} engine={connection.engine} /> :
      <Startup error={connection.error ?? state.error} />}
  </ThemeScope>;
}
function Startup({ error }: { error: string | null }) {
  const t = useTheme();
  return <View style={{ flex: 1, backgroundColor: t.frame, padding: space.xxl, justifyContent: 'center', gap: space.lg }}>
    <Label size="display">Merlin</Label><Label>{error ? 'The browser engine could not start.' : 'Opening your workspace…'}</Label>
    {!!error && <Label muted>{error}</Label>}
  </View>;
}
function Browser({ store, engine }: { store: ReturnType<typeof createBrowserStore>; engine: NonNullable<ReturnType<typeof connectEngine>> }) {
  const t = useTheme();
  const state = useStore(store);
  const snapshot = state.snapshot!;
  const active = snapshot.tabs.find(tab => tab.id === snapshot.activeTabId);
  const isStart = isStartTab(active);
  const split = snapshot.split && active && snapshot.split.tabs.includes(active.id) ? snapshot.split : null;
  const [address, setAddress] = useState(active?.url ?? '');
  const [editingAddress, setEditingAddress] = useState(false);
  const [command, setCommand] = useState('');
  const [tabMenuId, setTabMenuId] = useState<string | null>(null);
  const [revealedPromptId, setRevealedPromptId] = useState<string | null>(null);
  const surface = visibleSurface(snapshot, state.error, state.panel, revealedPromptId);
  const input = useRef<TextInput>(null);
  useEffect(() => { if (!editingAddress) setAddress(active?.url ?? ''); }, [active?.id, active?.url, editingAddress]);
  useEffect(() => { if (state.addressFocus) { input.current?.focus(); input.current?.setNativeProps({ selection: { start: 0, end: address.length } }); } }, [state.addressFocus]);
  useEffect(() => { if (state.addressRevert) { setAddress(active?.url ?? ''); setEditingAddress(false); input.current?.blur(); } }, [state.addressRevert]);
  async function call<M extends Method>(method: M, args: Calls[M]['args']) {
    try { await engine.call(method, args); store.setState({ error: null }); return true; }
    catch (e) { store.setState({ error: e instanceof Error ? e.message : String(e) }); return false; }
  }
  const panel = (p: typeof state.panel) => store.getState().setPanel(p);
  const nav = (method: 'navigation.back' | 'navigation.forward' | 'navigation.reload' | 'navigation.stop') => {
    if (active) void call(method, { tabId: active.id });
  };
  const applyAppearance = (patch: Partial<Appearance>) => void call('appearance.set', { ...snapshot.appearance, ...patch });
  return <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.frame }}>
    {!snapshot.modal.sidebarHidden && <TabSidebar snapshot={snapshot}
      onNew={() => void call('tabs.create', {})} onSelect={tabId => void call('tabs.activate', { tabId })}
      onClose={tabId => void call('tabs.close', { tabId })}
      onActions={tabId => { setTabMenuId(tabId); panel('tab'); }}
      onCommands={() => void call('modal.command', { text: 'palette menu' })}
      onPanel={panel} />}
    <View style={{ flex: 1, margin: space.sm, marginLeft: 0, backgroundColor: t.surface, borderRadius: radius.window,
      borderWidth: 1, borderColor: t.border, overflow: 'hidden' }}>
      <View style={{ height: geometry.toolbar, paddingHorizontal: space.md, paddingLeft: snapshot.modal.sidebarHidden ? 80 : space.md, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Button title={snapshot.modal.sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} icon="sidebar.left" iconOnly quiet compact
          onPress={() => void call('modal.command', { text: 'sidebar' })} />
        <Button title="Back" icon="arrow.left" iconOnly quiet compact disabled={!active?.canGoBack} onPress={() => nav('navigation.back')} />
        <Button title="Forward" icon="arrow.right" iconOnly quiet compact disabled={!active?.canGoForward} onPress={() => nav('navigation.forward')} />
        <Button title={active?.loading ? 'Stop' : 'Reload'} icon={active?.loading ? 'xmark' : 'arrow.clockwise'} iconOnly quiet compact disabled={!active}
          onPress={() => nav(active?.loading ? 'navigation.stop' : 'navigation.reload')} />
        {snapshot.prompt?.quiet && <Button title="Site request" compact onPress={() => setRevealedPromptId(snapshot.prompt!.id)} />}
        <Button title="Site information" icon={active?.url.startsWith('https:') ? 'lock' : 'info.circle'} iconOnly quiet compact
          disabled={!active || isStart} onPress={() => void call('modal.command', { text: 'site' })} />
        <Field ref={input} style={{ flex: 1 }} value={address} accessibilityLabel="Address or search" placeholder="Search or enter an address"
          onFocus={() => setEditingAddress(true)} onBlur={() => setEditingAddress(false)} onChangeText={setAddress}
          onSubmitEditing={() => { if (active) void call('navigation.open', { tabId: active.id, text: address }); else void call('tabs.create', { url: address }); input.current?.blur(); }} />
        <Button title="Bookmark this page" icon="bookmark" iconOnly quiet disabled={!active || isStart}
          onPress={() => { if (active) void call('tabs.bookmark', { tabId: active.id }); }} />
        <Button title="Extensions" icon="puzzlepiece.extension" iconOnly quiet disabled={!active} onPress={() => panel('extensions')} />
      </View>
      {snapshot.find?.visible && active && <FindBox key={active.id} find={snapshot.find} tabId={active.id} engine={engine}
        onError={error => store.setState({ error })} />}
      {split ? <View style={{ flex: 1, flexDirection: split.layout === 'stacked' ? 'column' : 'row', gap: space.xs }}>
        {split.tabs.map((id, index) => {
          const tab = snapshot.tabs.find(candidate => candidate.id === id)!;
          const share = index === 0 ? split.ratio : 1 - split.ratio;
          return <View key={id} style={{ flex: Math.min(Math.max(share, 0.1), 0.9), borderRadius: radius.control, overflow: 'hidden',
            borderWidth: 2, borderColor: id === active!.id ? t.accent : 'transparent' }}>
            <Pane tab={tab} snapshot={snapshot} hints={id === active!.id} call={call} onPanel={panel} />
            {id !== active!.id && <Pressable accessibilityRole="button" accessibilityLabel={`Focus ${tab.title || 'other side'}`}
              onPress={() => void call('tabs.activate', { tabId: id })}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.scrim, opacity: 0.25 }} />}
          </View>;
        })}
      </View> : active ? <Pane tab={active} snapshot={snapshot} hints call={call} onPanel={panel} /> :
        <View style={{ flex: 1, padding: space.xxl, justifyContent: 'center', alignItems: 'center', gap: space.lg }}>
          <Label size="display">Room to explore.</Label><Label muted>Open a tab or use the command menu to begin.</Label>
          <Button title="Open a tab" emphasis="primary" onPress={() => void call('tabs.create', {})} />
        </View>}
      <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, flexDirection: 'row', gap: space.md }}>
        <Label muted size="caption">{snapshot.modal.mode}</Label><Label size="caption">{snapshot.modal.pending || snapshot.modal.message}</Label>
      </View>
    </View>
    {surface === 'tab' && <TabActions tab={snapshot.tabs.find(tab => tab.id === tabMenuId)} tabs={snapshot.tabs}
      onClose={() => panel(null)}
      onPin={async pinned => { if (tabMenuId && await call('tabs.pin', { tabId: tabMenuId, pinned })) panel(null); }}
      onMove={async beforeId => { if (tabMenuId) await call('tabs.move', { tabId: tabMenuId, beforeId }); }}
      onDuplicate={async url => { if (await call('tabs.create', { url })) panel(null); }}
      onCloseTab={async () => { if (tabMenuId && await call('tabs.close', { tabId: tabMenuId })) panel(null); }} />}
    {surface === 'error' && <Dialog title="Unable to complete that action" onClose={() => store.setState({ error: null })}><Label>{state.error}</Label></Dialog>}
    {surface === 'settings' && <Settings engine={engine} appearance={snapshot.appearance} onAppearance={applyAppearance}
      onCommand={text => void call('modal.command', { text })} onClose={() => panel(null)} />}
    {(surface === 'history' || surface === 'bookmarks' || surface === 'downloads') && <Library engine={engine}
      section={surface as LibrarySection} onSection={panel} downloads={snapshot.downloads} onClose={() => panel(null)}
      onOpen={url => { void call('tabs.create', { url }); panel(null); }}
      onDownload={(downloadId, action) => void call('downloads.act', { downloadId, action })}
      onOpenFolder={() => void call('downloads.openFolder', {})} />}
    {surface === 'extensions' && <Extensions engine={engine} onClose={() => panel(null)} />}
    {surface === 'profiles' && <Profiles engine={engine} onClose={() => panel(null)} />}
    {surface === 'command' && <Dialog title="Command" subtitle="Run a Merlin command" onClose={() => panel(null)}
      actions={<Button title="Run" emphasis="primary" disabled={!command.trim()} onPress={async () => { if (await call('modal.command', { text: command })) { panel(null); setCommand(''); } }} />}>
      <Field autoFocus accessibilityLabel="Merlin command" placeholder="For example: workspace open research" value={command} onChangeText={setCommand}
        onSubmitEditing={async () => { if (command.trim() && await call('modal.command', { text: command })) { panel(null); setCommand(''); } }} />
    </Dialog>}
    {surface === 'palette' && snapshot.modal.palette && <CommandMenu palette={snapshot.modal.palette}
      revision={snapshot.revision} engine={engine} onError={error => store.setState({ error })} />}
    {surface === 'prompt' && snapshot.prompt && <BrowserPrompt key={snapshot.prompt.id} prompt={snapshot.prompt} engine={engine} />}
  </View>;
}

const startPattern = /^(chrome|merlin):\/\/(newtab|new-tab-page|merlin-start|start)\/?$/;
function isStartTab(tab: Tab | undefined) {
  return !tab || !tab.url || tab.url === 'about:blank' || startPattern.test(tab.url);
}

type Call = <M extends Method>(method: M, args: Calls[M]['args']) => Promise<boolean>;
/** One page: the start page for a new tab, otherwise the tab's own web view. */
function Pane({ tab, snapshot, hints, call, onPanel }: {
  tab: Tab; snapshot: Snapshot; hints: boolean; call: Call; onPanel(panel: 'history' | 'bookmarks'): void;
}) {
  const t = useTheme();
  if (isStartTab(tab)) return <StartPage snapshot={snapshot} onOpen={text => void call('navigation.open', { tabId: tab.id, text })}
    onCommand={text => void call('modal.command', { text })} onPanel={onPanel} onSelectTab={tabId => void call('tabs.activate', { tabId })} />;
  return <View style={{ flex: 1 }}>
    <BrowserPage key={tab.id} windowId={snapshot.windowId} tabId={tab.id} style={{ flex: 1 }} />
    {hints && <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      {snapshot.modal.hints?.filter(h => h.label.startsWith(snapshot.modal.hintPrefix ?? '')).map(h =>
        <View key={h.label} style={{ position: 'absolute', left: h.x, top: h.y, backgroundColor: t.accent,
          borderRadius: radius.control, paddingHorizontal: space.xs, borderWidth: 1, borderColor: t.surface }}>
          <Label size="caption" style={{ color: t.onAccent, fontWeight: '700' }}>{h.label}</Label>
        </View>)}
    </View>}
  </View>;
}
