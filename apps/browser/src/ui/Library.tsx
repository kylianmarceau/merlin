import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { BookmarkItem, BookmarkView, Download, DownloadAction, EngineClient, HistoryItem } from '@merlin/engine/protocol';
import { Button, Dialog, Field, Label, Row } from './components';
import { Notice, Sheet, formatDay, formatTime, useAction, useRequest } from './controls';
import { useTheme } from './Theme';
import { space } from './tokens';

const sections = [
  { id: 'history', label: 'History', icon: 'clock' },
  { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
  { id: 'downloads', label: 'Downloads', icon: 'arrow.down.circle' },
] as const;
export type LibrarySection = typeof sections[number]['id'];

export function Library({ engine, section, onSection, downloads, onOpen, onDownload, onOpenFolder, onClose }: {
  engine: EngineClient; section: LibrarySection; onSection(section: LibrarySection): void; downloads: Download[];
  onOpen(url: string): void; onDownload(id: string, action: DownloadAction): void; onOpenFolder(): void; onClose(): void;
}) {
  return <Sheet<LibrarySection> title="Library" sections={sections} section={section} onSection={onSection} onClose={onClose}>
    {section === 'history' && <History engine={engine} onOpen={onOpen} />}
    {section === 'bookmarks' && <Bookmarks engine={engine} onOpen={onOpen} />}
    {section === 'downloads' && <Downloads downloads={downloads} onAction={onDownload} onOpenFolder={onOpenFolder} />}
  </Sheet>;
}

function Header({ title, query, onQuery, placeholder, children }: React.PropsWithChildren<{
  title: string; query: string; onQuery(text: string): void; placeholder: string;
}>) {
  return <View style={{ padding: space.xl, paddingBottom: space.md, paddingRight: 64, gap: space.md }}>
    <Label size="title" style={{ fontWeight: '600' }}>{title}</Label>
    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
      <Field style={{ flex: 1 }} accessibilityLabel={placeholder} placeholder={placeholder} value={query} onChangeText={onQuery} />
      {children}
    </View>
  </View>;
}

function useDebounced<T>(value: T, ms = 200) {
  const [current, setCurrent] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setCurrent(value), ms); return () => clearTimeout(timer); }, [value, ms]);
  return current;
}

// -- History ------------------------------------------------------------------

function History({ engine, onOpen }: { engine: EngineClient; onOpen(url: string): void }) {
  const [query, setQuery] = useState('');
  const text = useDebounced(query.trim());
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const load = async (before?: number) => {
    const mine = before ? generation.current : ++generation.current;
    setLoading(true);
    try {
      const page = await engine.request('history.search', { text, ...(before ? { before } : {}) });
      if (mine !== generation.current) return;
      setItems(current => before ? [...current, ...page.items] : page.items);
      setDone(page.done); setError(null);
    } catch (e) { if (mine === generation.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mine === generation.current) setLoading(false); }
  };
  useEffect(() => { void load(); }, [text]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { generation.current++; }, []);
  const remove = async (item: HistoryItem) => {
    try {
      await engine.request('history.remove', { urls: [item.url] });
      setItems(current => current.filter(i => i.url !== item.url));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const days = useMemo(() => {
    const groups: { day: string; items: HistoryItem[] }[] = [];
    for (const item of items) {
      const day = formatDay(item.time);
      if (groups[groups.length - 1]?.day !== day) groups.push({ day, items: [] });
      groups[groups.length - 1].items.push(item);
    }
    return groups;
  }, [items]);
  return <View style={{ flex: 1 }}>
    <Header title="History" query={query} onQuery={setQuery} placeholder="Search history" />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.xs }}>
      {error && <Notice tone="error">{error}</Notice>}
      {!loading && !items.length && !error && <Label muted>{text ? 'Nothing in your history matches.' : 'Pages you visit will appear here.'}</Label>}
      {days.map(group => <View key={group.day} style={{ gap: space.xs, marginBottom: space.md }}>
        <Label muted size="caption">{group.day.toUpperCase()}</Label>
        {group.items.map(item => <Row key={`${item.url}:${item.time}`} title={item.title || item.url}
          detail={`${formatTime(item.time)} · ${item.domain}`} onPress={() => onOpen(item.url)}
          trailing={<Button title={`Remove ${item.title || item.url} from history`} icon="trash" iconOnly quiet compact onPress={() => void remove(item)} />} />)}
      </View>)}
      {loading && <Label muted>Loading…</Label>}
      {!loading && !done && !!items.length && <Button title="Show older" onPress={() => void load(items[items.length - 1].time)} />}
    </ScrollView>
  </View>;
}

// -- Bookmarks ----------------------------------------------------------------

function Bookmarks({ engine, onOpen }: { engine: EngineClient; onOpen(url: string): void }) {
  const [folderId, setFolderId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const text = useDebounced(query.trim());
  const folder = useRequest(engine, 'bookmarks.folder', folderId ? { folderId } : {}, [folderId]);
  const [results, setResults] = useState<BookmarkView | null>(null);
  const [editing, setEditing] = useState<BookmarkItem | 'new-folder' | null>(null);
  const action = useAction(engine);
  useEffect(() => {
    let current = true;
    if (!text) { setResults(null); return; }
    engine.request('bookmarks.search', { text }).then(v => { if (current) setResults(v); }, () => {});
    return () => { current = false; };
  }, [engine, text]);
  const view = text ? results : folder.data;
  const refresh = () => { folder.reload(); if (text) void engine.request('bookmarks.search', { text }).then(setResults, () => {}); };
  const mutate = async (run: () => Promise<unknown>) => { if ((await run()) !== undefined) refresh(); };
  const move = (item: BookmarkItem, delta: number) => {
    if (!view) return;
    const index = view.items.findIndex(i => i.id === item.id);
    // Chromium's Move index counts the moved node's old position.
    const target = delta < 0 ? index - 1 : index + 2;
    void mutate(() => action.run('bookmarks.move', { id: item.id, parentId: view.folderId, index: Math.max(0, target) }));
  };
  return <View style={{ flex: 1 }}>
    <Header title="Bookmarks" query={query} onQuery={setQuery} placeholder="Search bookmarks">
      <Button title="New folder" icon="folder.badge.plus" disabled={!!text || !view} onPress={() => setEditing('new-folder')} />
    </Header>
    {!text && folder.data && <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: space.xl, paddingBottom: space.sm, gap: space.xs }}>
      {folder.data.path.map((crumb, i) => <React.Fragment key={crumb.id || 'root'}>
        {i > 0 && <Label muted>›</Label>}
        <Button title={crumb.title} quiet compact disabled={i === folder.data!.path.length - 1}
          onPress={() => setFolderId(crumb.id || undefined)} />
      </React.Fragment>)}
    </View>}
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.xs }}>
      {(folder.error || action.error) && <Notice tone="error">{folder.error || action.error}</Notice>}
      {!view && !folder.error && <Label muted>Loading bookmarks…</Label>}
      {view && !view.items.length && <Label muted>{text ? 'No bookmarks match.' : 'This folder is empty.'}</Label>}
      {view?.items.map((item, index) => <Row key={item.id} title={item.title || item.url || 'Untitled'}
        detail={item.folder ? `${item.count ?? 0} items` : [item.domain, item.where].filter(Boolean).join(' · ')}
        onPress={() => { if (item.folder) { setQuery(''); setFolderId(item.id); } else if (item.url) onOpen(item.url); }}
        trailing={item.editable ? <View style={{ flexDirection: 'row' }}>
          {!text && <Button title="Move up" icon="arrow.up" iconOnly quiet compact disabled={index === 0} onPress={() => move(item, -1)} />}
          {!text && <Button title="Move down" icon="arrow.down" iconOnly quiet compact disabled={index === view.items.length - 1} onPress={() => move(item, 1)} />}
          <Button title={`Edit ${item.title}`} icon="pencil" iconOnly quiet compact onPress={() => setEditing(item)} />
          <Button title={`Delete ${item.title}`} icon="trash" iconOnly quiet compact onPress={() => void mutate(() => action.run('bookmarks.remove', { id: item.id }))} />
        </View> : <Label muted style={{ paddingRight: space.sm }}>{item.folder ? '›' : ''}</Label>} />)}
    </ScrollView>
    {editing && <BookmarkEditor item={editing === 'new-folder' ? null : editing} busy={action.busy} error={action.error}
      onCancel={() => { setEditing(null); action.clearError(); }}
      onSave={async (title, url) => {
        const result = editing === 'new-folder'
          ? await action.run('bookmarks.createFolder', { parentId: view!.folderId, title })
          : await action.run('bookmarks.edit', { id: editing.id, title, ...(editing.folder ? {} : { url }) });
        if (result !== undefined) { setEditing(null); refresh(); }
      }} />}
  </View>;
}

function BookmarkEditor({ item, busy, error, onCancel, onSave }: {
  item: BookmarkItem | null; busy: boolean; error: string | null; onCancel(): void; onSave(title: string, url: string): void;
}) {
  const t = useTheme();
  const [title, setTitle] = useState(item?.title ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const folder = !item || item.folder;
  const valid = title.trim().length > 0 && (folder || url.trim().length > 0);
  return <Dialog title={item ? (folder ? 'Rename folder' : 'Edit bookmark') : 'New folder'} onClose={onCancel}
    actions={<><Button title="Cancel" onPress={onCancel} />
      <Button title="Save" emphasis="primary" disabled={!valid || busy} onPress={() => onSave(title.trim(), url.trim())} /></>}>
    <Label muted>Name</Label>
    <Field autoFocus accessibilityLabel="Name" value={title} onChangeText={setTitle} onSubmitEditing={() => { if (valid) onSave(title.trim(), url.trim()); }} />
    {!folder && <><Label muted>Address</Label><Field accessibilityLabel="Address" value={url} onChangeText={setUrl} /></>}
    {error && <Label style={{ color: t.danger }}>{error}</Label>}
  </Dialog>;
}

// -- Downloads ----------------------------------------------------------------

function Downloads({ downloads, onAction, onOpenFolder }: {
  downloads: Download[]; onAction(id: string, action: DownloadAction): void; onOpenFolder(): void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = downloads.filter(d => !q || `${d.name} ${d.url ?? ''}`.toLowerCase().includes(q));
  return <View style={{ flex: 1 }}>
    <Header title="Downloads" query={query} onQuery={setQuery} placeholder="Search downloads">
      <Button title="Open folder" icon="folder" onPress={onOpenFolder} />
    </Header>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.xs }}>
      {!shown.length && <Label muted>{q ? 'No downloads match.' : 'Files you download will appear here.'}</Label>}
      {shown.map(d => <DownloadRow key={d.id} download={d} onAction={action => onAction(d.id, action)} />)}
    </ScrollView>
  </View>;
}

export function DownloadRow({ download: d, onAction }: { download: Download; onAction(action: DownloadAction): void }) {
  const status = d.status ?? (d.state === 'complete' ? 'done' : d.state === 'interrupted' ? 'failed' : d.state);
  const percent = d.total > 0 ? Math.round(d.received / d.total * 100) : null;
  const detail = d.detail || (status === 'progress' && percent !== null ? `${percent}%` : status);
  return <Row title={d.name || 'Download'} detail={detail} onPress={() => { if (status === 'done') onAction('open'); }}
    trailing={<View style={{ flexDirection: 'row' }}>
      {(status === 'progress' || status === 'paused') && <Button title={status === 'paused' ? 'Resume' : 'Pause'}
        icon={status === 'paused' ? 'play' : 'pause'} iconOnly quiet compact onPress={() => onAction('pause')} />}
      {(status === 'progress' || status === 'paused') && <Button title="Cancel" icon="xmark" iconOnly quiet compact onPress={() => onAction('cancel')} />}
      {status === 'done' && <Button title="Show in Finder" icon="folder" iconOnly quiet compact onPress={() => onAction('show')} />}
      {(status === 'failed' || status === 'cancelled') && <Button title="Retry" icon="arrow.clockwise" iconOnly quiet compact onPress={() => onAction('retry')} />}
      {status === 'dangerous' && <Button title="Discard" emphasis="danger" compact onPress={() => onAction('discard')} />}
      {status !== 'progress' && status !== 'paused' && status !== 'dangerous' &&
        <Button title="Remove from list" icon="trash" iconOnly quiet compact onPress={() => onAction('forget')} />}
    </View>} />;
}
