import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { EngineClient, Request, Requests } from '@merlin/engine/protocol';
import { Symbol, type SymbolName } from '@merlin/shell';
import { Button, Label } from './components';
import { useTheme } from './Theme';
import { geometry, radius, space, typography } from './tokens';

/** An on/off switch with its label read as one control. */
export function Toggle({ label, value, onChange, disabled = false }: {
  label: string; value: boolean; onChange(value: boolean): void; disabled?: boolean;
}) {
  const t = useTheme();
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }}
    disabled={disabled} onPress={() => onChange(!value)}
    style={{ width: 40, height: 24, borderRadius: 12, padding: 3, opacity: disabled ? 0.4 : 1,
      backgroundColor: value ? t.accent : t.border, alignItems: value ? 'flex-end' : 'flex-start' }}>
    <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: value ? t.onAccent : t.raised }} />
  </Pressable>;
}

/** One choice from a short list, shown inline. */
export function Choice<T extends string | number>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange(value: T): void; disabled?: boolean;
}) {
  const t = useTheme();
  return <View accessibilityRole="radiogroup" accessibilityLabel={label}
    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 2, borderRadius: radius.control + 2, backgroundColor: t.inset,
      opacity: disabled ? 0.4 : 1, alignSelf: 'flex-start' }}>
    {options.map(option => {
      const selected = option.value === value;
      return <Pressable key={String(option.value)} accessibilityRole="radio" accessibilityState={{ selected, disabled }}
        accessibilityLabel={option.label} disabled={disabled} onPress={() => onChange(option.value)}
        style={{ paddingHorizontal: space.md, minHeight: geometry.control - 6, justifyContent: 'center', borderRadius: radius.control,
          backgroundColor: selected ? t.raised : 'transparent', borderWidth: 1, borderColor: selected ? t.border : 'transparent' }}>
        <Text style={{ color: selected ? t.text : t.muted, fontSize: typography.body, fontWeight: selected ? '600' : '400' }}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

/** A labelled setting: title and description on the left, its control on the right. */
export function Setting({ title, detail, children }: React.PropsWithChildren<{ title: string; detail?: string }>) {
  const t = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border }}>
    <View style={{ flex: 1, gap: 2 }}><Label>{title}</Label>{!!detail && <Label muted size="caption">{detail}</Label>}</View>
    {children}
  </View>;
}

export function Group({ title, detail, children }: React.PropsWithChildren<{ title: string; detail?: string }>) {
  return <View style={{ gap: space.xs, marginBottom: space.xl }}>
    <Label size="title" style={{ fontWeight: '600' }}>{title}</Label>
    {!!detail && <Label muted>{detail}</Label>}
    <View style={{ marginTop: space.sm }}>{children}</View>
  </View>;
}

export function Notice({ tone = 'info', children }: React.PropsWithChildren<{ tone?: 'info' | 'error' }>) {
  const t = useTheme();
  return <View accessibilityLiveRegion="polite" style={{ padding: space.md, borderRadius: radius.control,
    backgroundColor: tone === 'error' ? t.inset : t.selected }}>
    <Label style={tone === 'error' ? { color: t.danger } : undefined}>{children}</Label>
  </View>;
}

/**
 * A large two-pane surface: sections on the left, content on the right.
 * Used for Settings and the Library, so every full panel shares one frame.
 */
export function Sheet<K extends string>({ title, sections, section, onSection, onClose, children, footer }: React.PropsWithChildren<{
  title: string; sections: readonly { id: K; label: string; icon: SymbolName }[]; section: K; onSection(id: K): void;
  onClose(): void; footer?: React.ReactNode;
}>) {
  const t = useTheme();
  return <Modal visible transparent animationType="none" onRequestClose={onClose}>
    <View style={[StyleSheet.absoluteFillObject, { backgroundColor: t.scrim, justifyContent: 'center', alignItems: 'center' }]}>
      <View accessibilityViewIsModal accessibilityLabel={title}
        onKeyDown={event => { if (event.nativeEvent.key === 'Escape') { event.stopPropagation(); onClose(); } }}
        style={{ width: 820, maxWidth: '94%', height: 600, maxHeight: '90%', flexDirection: 'row', overflow: 'hidden',
          backgroundColor: t.raised, borderRadius: radius.panel, borderColor: t.border, borderWidth: 1 }}>
        <View style={{ width: 200, backgroundColor: t.surface, padding: space.md, gap: 2,
          borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: t.border }}>
          <Label size="title" style={{ fontWeight: '600', paddingHorizontal: space.sm, paddingVertical: space.md }}>{title}</Label>
          {sections.map(s => <NavItem key={s.id} label={s.label} icon={s.icon} selected={s.id === section} onPress={() => onSection(s.id)} />)}
          <View style={{ flex: 1 }} />{footer}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ position: 'absolute', top: space.md, right: space.md, zIndex: 1 }}>
            <Button title={`Close ${title}`} icon="xmark" iconOnly quiet compact onPress={onClose} />
          </View>
          {children}
        </View>
      </View>
    </View>
  </Modal>;
}

function NavItem({ label, icon, selected, onPress }: { label: string; icon: SymbolName; selected: boolean; onPress(): void }) {
  const t = useTheme();
  const [hover, setHover] = useState(false);
  return <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress}
    onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: geometry.control, paddingHorizontal: space.sm,
      borderRadius: radius.control, backgroundColor: selected ? t.selected : hover ? t.hover : 'transparent' }}>
    <Symbol name={icon} color={selected ? t.accent : t.muted} size={14} />
    <Text style={{ color: t.text, fontSize: typography.body, fontWeight: selected ? '600' : '400' }}>{label}</Text>
  </Pressable>;
}

/** Scrollable content for one Sheet section. */
export function SheetBody({ children }: React.PropsWithChildren) {
  return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.xl, paddingTop: space.xl + space.sm }}>{children}</ScrollView>;
}

export type Loaded<T> = { data: T | null; error: string | null; loading: boolean; reload(): void; set(value: T): void };

/**
 * Loads one browser request and reloads it on demand. A response that
 * arrives after the component closed, or after a newer load, is ignored.
 */
export function useRequest<R extends Request>(engine: EngineClient, method: R, args: Requests[R]['args'], deps: unknown[] = []): Loaded<Requests[R]['result']> {
  const [data, setData] = useState<Requests[R]['result'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    engine.request(method, args).then(value => {
      if (alive.current && mine === generation.current) { setData(value); setError(null); setLoading(false); }
    }, e => {
      if (alive.current && mine === generation.current) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, method, ...deps]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load, set: value => { generation.current++; setData(value); setLoading(false); } };
}

/** Runs a browser request from a control, reporting failure in place. */
export function useAction(engine: EngineClient) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback(async <R extends Request>(method: R, args: Requests[R]['args'], timeoutMs?: number) => {
    setBusy(true); setError(null);
    try { const value = await engine.request(method, args, timeoutMs); return value; }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); return undefined; }
    finally { if (alive.current) setBusy(false); }
  }, [engine]);
  return { run, error, busy, clearError: () => setError(null) };
}

export function formatTime(ms: number) {
  const date = new Date(ms);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export function formatDay(ms: number) {
  const date = new Date(ms);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
