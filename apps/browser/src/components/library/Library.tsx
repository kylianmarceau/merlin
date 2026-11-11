import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { formatDay, formatTime } from '../../lib/format';
import type { BookmarkItem, BookmarkView, HistoryItem } from '../../state/types';
import { useAction, useActions, useBrowser, useRequest, useSnapshot } from '../../state/window';
import {
  Box, Button, Dialog, EmptyState, Field, IconButton, IconTile, ListRow, Notice, Sheet, Spinner, Text, duration, space,
  type SheetSection,
} from '../ui';
import { DownloadRow } from './DownloadRow';

const sections = [
  { id: 'history', label: 'History', icon: 'clock' },
  { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
  { id: 'downloads', label: 'Downloads', icon: 'arrow.down.circle' },
] as const satisfies readonly SheetSection<string>[];
export type LibrarySection = typeof sections[number]['id'];

export function Library({ open }: { open: boolean }) {
  const actions = useActions();
  const panel = useBrowser(s => s.panel);
  const [section, setSection] = useState<LibrarySection>(
    panel === 'bookmarks' || panel === 'downloads' ? panel : 'history');
  useEffect(() => { if (panel === 'history' || panel === 'bookmarks' || panel === 'downloads') setSection(panel); }, [panel]);
  const openUrl = (url: string) => { void actions.newTab(url); actions.closePanel(); };
  return <Sheet<LibrarySection> open={open} title="Library" sections={sections} section={section} onSection={setSection}
    onClose={actions.closePanel}>
    {section === 'history' && <History onOpen={openUrl} />}
    {section === 'bookmarks' && <Bookmarks onOpen={openUrl} />}
    {section === 'downloads' && <Downloads />}
  </Sheet>;
}

function Header({ title, query, onQuery, placeholder, children }: React.PropsWithChildren<{
  title: string; query: string; onQuery(text: string): void; placeholder: string;
}>) {
  return <Box pad="xl" padBottom="md" padRight="huge" gap="md">
    <Text variant="headline">{title}</Text>
    <Box row gap="sm" align="center">
      <View style={{ flex: 1 }}>
        <Field icon="magnifyingglass" accessibilityLabel={placeholder} placeholder={placeholder} value={query} onChangeText={onQuery} />
      </View>
      {children}
    </Box>
  </Box>;
}

function useDebounced<T>(value: T) {
  const [current, setCurrent] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setCurrent(value), duration.search); return () => clearTimeout(timer); }, [value]);
  return current;
}

const listStyle = { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.hair };

function History({ onOpen }: { onOpen(url: string): void }) {
  const actions = useActions();
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
      const page = await actions.request('history.search', { text, ...(before ? { before } : {}) });
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
      await actions.request('history.remove', { urls: [item.url] });
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
  return <Box flex={1}>
    <Header title="History" query={query} onQuery={setQuery} placeholder="Search history" />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={listStyle}>
      {error && <Notice tone="error">{error}</Notice>}
      {!loading && !items.length && !error && <EmptyState icon="clock" title={text ? 'Nothing matches' : 'No history yet'}
        detail={text ? 'Try other words.' : 'Pages you visit appear here.'} />}
      {days.map(group => <Box key={group.day} gap="hair" marginBottom="md">
        <Box padX="sm" padY="xs"><Text variant="section">{group.day}</Text></Box>
        {group.items.map(item => <ListRow key={`${item.url}:${item.time}`} title={item.title || item.url}
          detail={`${formatTime(item.time)} · ${item.domain}`} onPress={() => onOpen(item.url)}
          leading={<IconTile icon="globe" />}
          hoverTrailing={<IconButton label={`Remove ${item.title || item.url} from history`} icon="trash" size="small"
            onPress={() => void remove(item)} />} />)}
      </Box>)}
      {loading && <Box center pad="md"><Spinner /></Box>}
      {!loading && !done && !!items.length && <Button label="Show Older" variant="ghost" onPress={() => void load(items[items.length - 1].time)} />}
    </ScrollView>
  </Box>;
}

function Bookmarks({ onOpen }: { onOpen(url: string): void }) {
  const actions = useActions();
  const [folderId, setFolderId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const text = useDebounced(query.trim());
  const folder = useRequest('bookmarks.folder', folderId ? { folderId } : {}, [folderId]);
  const [results, setResults] = useState<BookmarkView | null>(null);
  const [editing, setEditing] = useState<BookmarkItem | 'new-folder' | null>(null);
  const action = useAction();
  useEffect(() => {
    let current = true;
    if (!text) { setResults(null); return; }
    actions.request('bookmarks.search', { text }).then(v => { if (current) setResults(v); }, () => {});
    return () => { current = false; };
  }, [actions, text]);
  const view = text ? results : folder.data;
  const refresh = () => { folder.reload(); if (text) void actions.request('bookmarks.search', { text }).then(setResults, () => {}); };
  const mutate = async (run: () => Promise<unknown>) => { if ((await run()) !== undefined) refresh(); };
  const move = (item: BookmarkItem, delta: number) => {
    if (!view) return;
    const index = view.items.findIndex(i => i.id === item.id);
    // Chromium's Move index counts the moved node's old position.
    const target = delta < 0 ? index - 1 : index + 2;
    void mutate(() => action.run('bookmarks.move', { id: item.id, parentId: view.folderId, index: Math.max(0, target) }));
  };
  return <Box flex={1}>
    <Header title="Bookmarks" query={query} onQuery={setQuery} placeholder="Search bookmarks">
      <Button label="New Folder" icon="folder.badge.plus" disabled={!!text || !view} onPress={() => setEditing('new-folder')} />
    </Header>
    {!text && folder.data && <Box row wrap align="center" padX="xl" padBottom="sm" gap="xs">
      {folder.data.path.map((crumb, i) => <React.Fragment key={crumb.id || 'root'}>
        {i > 0 && <Text tone="textTertiary">›</Text>}
        <Button label={crumb.title} variant="ghost" size="small" disabled={i === folder.data!.path.length - 1}
          onPress={() => setFolderId(crumb.id || undefined)} />
      </React.Fragment>)}
    </Box>}
    <ScrollView style={{ flex: 1 }} contentContainerStyle={listStyle}>
      {(folder.error || action.error) && <Notice tone="error">{folder.error || action.error}</Notice>}
      {!view && !folder.error && <Box center pad="md"><Spinner /></Box>}
      {view && !view.items.length && <EmptyState icon="bookmark" title={text ? 'No bookmarks match' : 'This folder is empty'} />}
      {view?.items.map((item, index) => <ListRow key={item.id} title={item.title || item.url || 'Untitled'}
        detail={item.folder ? `${item.count ?? 0} items` : [item.domain, item.where].filter(Boolean).join(' · ')}
        leading={<IconTile icon={item.folder ? 'folder' : 'bookmark'} tone={item.folder ? 'accent' : 'iconSecondary'} />}
        onPress={() => { if (item.folder) { setQuery(''); setFolderId(item.id); } else if (item.url) onOpen(item.url); }}
        hoverTrailing={item.editable ? <View style={{ flexDirection: 'row' }}>
          {!text && <IconButton label="Move up" icon="arrow.up" size="small" disabled={index === 0} onPress={() => move(item, -1)} />}
          {!text && <IconButton label="Move down" icon="arrow.down" size="small" disabled={index === view.items.length - 1} onPress={() => move(item, 1)} />}
          <IconButton label={`Edit ${item.title}`} icon="pencil" size="small" onPress={() => setEditing(item)} />
          <IconButton label={`Delete ${item.title}`} icon="trash" size="small" onPress={() => void mutate(() => action.run('bookmarks.remove', { id: item.id }))} />
        </View> : undefined}
        trailing={item.folder ? <Text tone="textTertiary">›</Text> : undefined} />)}
    </ScrollView>
    {editing && <BookmarkEditor item={editing === 'new-folder' ? null : editing} busy={action.busy} error={action.error}
      onCancel={() => { setEditing(null); action.clearError(); }}
      onSave={async (title, url) => {
        const result = editing === 'new-folder'
          ? await action.run('bookmarks.createFolder', { parentId: view!.folderId, title })
          : await action.run('bookmarks.edit', { id: editing.id, title, ...(editing.folder ? {} : { url }) });
        if (result !== undefined) { setEditing(null); refresh(); }
      }} />}
  </Box>;
}

function BookmarkEditor({ item, busy, error, onCancel, onSave }: {
  item: BookmarkItem | null; busy: boolean; error: string | null; onCancel(): void; onSave(title: string, url: string): void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const folder = !item || item.folder;
  const valid = title.trim().length > 0 && (folder || url.trim().length > 0);
  return <Dialog title={item ? (folder ? 'Rename Folder' : 'Edit Bookmark') : 'New Folder'} icon={folder ? 'folder' : 'bookmark'}
    onClose={onCancel} dismissOnScrim
    actions={<><Button label="Cancel" onPress={onCancel} />
      <Button label="Save" variant="primary" disabled={!valid || busy} onPress={() => onSave(title.trim(), url.trim())} /></>}>
    <Box gap="xs">
      <Text variant="label" tone="textSecondary">Name</Text>
      <Field autoFocus accessibilityLabel="Name" value={title} onChangeText={setTitle} onSubmitEditing={() => { if (valid) onSave(title.trim(), url.trim()); }} />
    </Box>
    {!folder && <Box gap="xs">
      <Text variant="label" tone="textSecondary">Address</Text>
      <Field accessibilityLabel="Address" value={url} onChangeText={setUrl} />
    </Box>}
    {error && <Notice tone="error">{error}</Notice>}
  </Dialog>;
}

function Downloads() {
  const actions = useActions();
  const { downloads } = useSnapshot();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = downloads.filter(d => !q || `${d.name} ${d.url ?? ''}`.toLowerCase().includes(q));
  return <Box flex={1}>
    <Header title="Downloads" query={query} onQuery={setQuery} placeholder="Search downloads">
      <Button label="Open Folder" icon="folder" onPress={() => void actions.openDownloadsFolder()} />
    </Header>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={listStyle}>
      {!shown.length && <EmptyState icon="arrow.down.circle" title={q ? 'No downloads match' : 'No downloads'}
        detail={q ? undefined : 'Files you download appear here.'} />}
      {shown.map(d => <DownloadRow key={d.id} download={d} onAction={a => void actions.downloadAction(d.id, a)} />)}
    </ScrollView>
  </Box>;
}
