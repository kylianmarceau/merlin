import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { formatDay, formatTime } from '../../lib/format';
import type { BookmarkItem, BookmarkView, HistoryItem } from '../../state/types';
import { useAction, useActions, useBrowser, useRequest, useSnapshot } from '../../state/window';
import {
  Box, Button, Dialog, EmptyState, Field, Icon, IconButton, ListRow, Notice, Sheet, Spinner, Text, duration, geometry, radius, space,
  useTheme, type SheetSection,
} from '../ui';
import { DownloadRow } from './DownloadRow';

const sections = [
  { id: 'history', label: 'History', icon: 'clock' },
  { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
  { id: 'downloads', label: 'Downloads', icon: 'arrow.down.to.line' },
] as const satisfies readonly SheetSection<string>[];
export type LibrarySection = typeof sections[number]['id'];

export function Library({ open }: { open: boolean }) {
  const actions = useActions();
  const panel = useBrowser(s => s.panel);
  const [section, setSection] = useState<LibrarySection>(
    panel === 'bookmarks' || panel === 'downloads' ? panel : 'history');
  useEffect(() => { if (panel === 'history' || panel === 'bookmarks' || panel === 'downloads') setSection(panel); }, [panel]);
  const { downloads } = useSnapshot();
  const action = useAction();
  const running = downloads.filter(d => d.state === 'progress').length;
  const tabs = sections.map(s => (s.id === 'downloads' && running ? { ...s, badge: String(running) } : s));
  const openUrl = (url: string) => { void actions.newTab(url); actions.closePanel(); };
  return <Sheet<LibrarySection> open={open} title="Library" nav="segments" sections={tabs} section={section} onSection={setSection}
    onClose={actions.closePanel}
    footer={section === 'history' ? <Footer note="History stays on this Mac." link="Clear browsing data…"
      onPress={() => void action.run('settings.openPage', { key: 'clear-data' })} /> : undefined}>
    {section === 'history' && <History onOpen={openUrl} />}
    {section === 'bookmarks' && <Bookmarks onOpen={openUrl} />}
    {section === 'downloads' && <Downloads />}
  </Sheet>;
}

/** The search field and actions under the Library's title. */
function Header({ query, onQuery, placeholder, children }: React.PropsWithChildren<{
  query: string; onQuery(text: string): void; placeholder: string;
}>) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg + space.xs,
    paddingBottom: space.md }}>
    <View style={{ flex: 1 }}>
      <Field icon="magnifyingglass" accessibilityLabel={placeholder} placeholder={placeholder} value={query} onChangeText={onQuery} />
    </View>
    {children}
  </View>;
}

function Footer({ note, link, onPress }: { note: string; link: string; onPress(): void }) {
  const { colors } = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg + space.xs,
    paddingVertical: space.md, borderTopWidth: geometry.hairline, borderTopColor: colors.borderSubtle }}>
    <Text variant="label" weight="regular" tone="textSecondary">{note}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={link} onPress={onPress}>
      <Text variant="label" tone="textLink">{link}</Text>
    </Pressable>
  </View>;
}

/** A visit: when, what and where, with a remove button on hover. */
function HistoryRow({ item, onOpen, onRemove }: { item: HistoryItem; onOpen(): void; onRemove(): void }) {
  const { colors } = useTheme();
  const [hovered, setHovered] = useState(false);
  const title = item.title || item.url;
  return <View onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    style={{ flexDirection: 'row', alignItems: 'center', minHeight: geometry.rowTall - space.xs, borderRadius: radius.row,
      backgroundColor: colors[hovered ? 'fillHover' : 'fillTransparent'] }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${item.domain}`} onPress={onOpen}
      style={{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm + space.hair }}>
      <Text variant="label" weight="regular" tone="textSecondary" style={{ width: geometry.timeColumn, fontVariant: ['tabular-nums'] }}>
        {formatTime(item.time)}</Text>
      <Text lines={1} flex={1} tone="tabText">{title}</Text>
      <Text variant="label" weight="regular" tone="textSecondary" lines={1} style={{ width: geometry.historyHost }}>{item.domain}</Text>
    </Pressable>
    <View style={{ width: geometry.control, alignItems: 'center', opacity: hovered ? 1 : 0 }}>
      <IconButton label={`Remove ${title} from history`} icon="trash" size="small" onPress={onRemove} />
    </View>
  </View>;
}

function useDebounced<T>(value: T) {
  const [current, setCurrent] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setCurrent(value), duration.search); return () => clearTimeout(timer); }, [value]);
  return current;
}

const listStyle = { paddingHorizontal: space.md, paddingBottom: space.xl, gap: geometry.hairline };

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
    <Header query={query} onQuery={setQuery} placeholder="Search history" />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={listStyle}>
      {error && <Notice tone="error">{error}</Notice>}
      {!loading && !items.length && !error && <EmptyState icon="clock" title={text ? 'Nothing matches' : 'No history yet'}
        detail={text ? 'Try other words.' : 'Pages you visit appear here.'} />}
      {days.map(group => <Box key={group.day} gap="hair" marginBottom="sm">
        <Box row padX="sm" padTop="md" padBottom="xs">
          <Text variant="group" flex={1}>{group.day}</Text>
          <Text variant="caption" tone="textTertiary">{group.items.length === 1 ? '1 visit' : `${group.items.length} visits`}</Text>
        </Box>
        {group.items.map(item => <HistoryRow key={`${item.url}:${item.time}`} item={item} onOpen={() => onOpen(item.url)}
          onRemove={() => void remove(item)} />)}
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
    <Header query={query} onQuery={setQuery} placeholder="Search bookmarks">
      <Button label="New Folder" icon="folder.badge.plus" disabled={!!text || !view} onPress={() => setEditing('new-folder')} />
    </Header>
    {!text && folder.data && <Box row wrap align="center" padX="lg" padBottom="sm" gap="xs">
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
        leading={<Icon name={item.folder ? 'folder' : 'bookmark'} tone={item.folder ? 'accent' : 'iconSecondary'} size="small" />}
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
  const live = useSnapshot().downloads;
  // The snapshot carries running and recent downloads; the full history comes
  // on request, again whenever a download starts or one is removed.
  const liveIds = live.map(d => d.id).join(',');
  const all = useRequest('downloads.list', {}, [liveIds]);
  const downloads = useMemo(() => {
    const fresh = new Map(live.map(d => [d.id, d]));
    const merged = (all.data ?? []).map(d => fresh.get(d.id) ?? d);
    const known = new Set(merged.map(d => d.id));
    return [...live.filter(d => !known.has(d.id)), ...merged];
  }, [live, all.data]);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = downloads.filter(d => !q || `${d.name} ${d.url ?? ''}`.toLowerCase().includes(q));
  return <Box flex={1}>
    <Header query={query} onQuery={setQuery} placeholder="Search downloads">
      <Button label="Open Folder" icon="folder" onPress={() => void actions.openDownloadsFolder()} />
    </Header>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space.xl }}>
      {!shown.length && <EmptyState icon="arrow.down.to.line" title={q ? 'No downloads match' : 'No downloads'}
        detail={q ? undefined : 'Files you download appear here.'} />}
      {shown.map(d => <DownloadRow key={d.id} download={d} onAction={a => void actions.downloadAction(d.id, a)}
        onMenu={() => void actions.downloadMenu(d.id)} />)}
    </ScrollView>
  </Box>;
}
