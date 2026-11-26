import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, ScrollView, View } from 'react-native';
import type { Appearance, Preferences } from '../../state/types';
import { errorText } from '../../lib/result';
import {
  addMerlinToDock, copyText, installCli, installedSetupApps, isDefaultBrowser, isLiquidGlass, loginItem,
  makeDefaultBrowser, setAppIcon, setLoginItem, setPreference, setupDockStatus,
} from '../../state/setupHost';
import { useShellPrefs, type ShellPrefs } from '../../state/shellPrefs';
import { setShellPref } from '../../state/shellPrefsStorage';
import { useActions, useSnapshot } from '../../state/window';
import { Button, Icon, PageTurn, Panel, Pressable, Text, useInteraction, geometry, radius, setupGeometry, space, setupPaper, useTheme } from '../ui';
import { SetupPage, headings, type SetupValues } from './SetupPages';
import { SetupPreview, previewKey } from './SetupPreview';
import { browsers, browserPreset, makeSetupCode, nextScreen, readProgress, readSetupCode, route, screens, type Progress, type Screen, type SetupPreferences } from './setup';

type ShellPatch = Partial<SetupPreferences & Pick<ShellPrefs, 'workspaceTheme'>>;

function saveShell(patch: ShellPatch) {
  return Promise.all(Object.entries(patch).map(([key, value]) =>
    setShellPref(key as Parameters<typeof setShellPref>[0], value)));
}

function Back({ disabled, onPress }: { disabled: boolean; onPress(): void }) {
  const { colors } = useTheme();
  const { focused, hovered, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={disabled} onPress={onPress} {...handlers}
    style={{ width: geometry.controlLarge, height: geometry.controlLarge, borderRadius: radius.pill, borderWidth: geometry.hairline,
      borderColor: colors[focused ? 'focusRing' : 'borderDefault'], backgroundColor: colors[hovered ? 'fillHover' : 'fillTransparent'],
      alignItems: 'center', justifyContent: 'center' }}>
    <Icon name="chevron.left" size="small" tone="iconSecondary" />
  </Pressable>;
}

function Heading({ title, detail, focus }: { title: string; detail: string; focus: boolean }) {
  const heading = useRef<View>(null);
  useEffect(() => {
    if (!focus) return;
    const frame = requestAnimationFrame(() => {
      const node = findNodeHandle(heading.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    });
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  return <View ref={heading} accessible focusable accessibilityRole="header" accessibilityLabel={title} enableFocusRing={false}
    style={{ gap: space.sm, paddingBottom: space.md }}>
    <Text weight="regular" style={{ fontSize: setupGeometry.headingSize, lineHeight: setupGeometry.headingLine, letterSpacing: setupGeometry.tracking }}>{title}</Text>
    <Text variant="body" tone="textSecondary">{detail}</Text>
  </View>;
}

export function SetupWizard({ replayIntro }: { replayIntro?: () => void }) {
  const actions = useActions();
  const snapshot = useSnapshot();
  const { colors, dark } = useTheme();
  const paper = setupPaper[dark ? 'dark' : 'light'];
  const shell = useShellPrefs(prefs => prefs);
  const [progress, setProgress] = useState(() => readProgress(snapshot.welcomeProgress));
  const [preferences, setPreferences] = useState<Preferences>();
  const [patch, setPatch] = useState<ShellPatch>({});
  const [appearance, setAppearance] = useState<Partial<Appearance>>({});
  const [layout, setLayout] = useState<'top' | 'side'>();
  const [startup, setStartup] = useState<'last' | 'start'>();
  const [search, setSearch] = useState<string>();
  const [blocking, setBlocking] = useState<Partial<{ enabled: boolean; automatic: boolean }>>({});
  const [icon, setIcon] = useState<string>();
  const [system, setSystem] = useState({ default: false, dock: false, login: false, alreadyDefault: false, alreadyDocked: false, alreadyLogin: false, trial: false });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeEntry, setCodeEntry] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [codeReview, setCodeReview] = useState<ReturnType<typeof readSetupCode>>(null);
  const [size, setSize] = useState({ width: setupGeometry.width as number, height: setupGeometry.height as number });
  const [code, setCode] = useState('');
  const [wantsCli, setWantsCli] = useState(true);
  const [installed, setInstalled] = useState(false);
  const [favoriteDraft, setFavoriteDraft] = useState<string[]>();
  const [hostOptions, setHostOptions] = useState(false);
  const working = useRef(false);
  const drafts = useRef(new Map<Screen, {
    patch: ShellPatch; appearance: Partial<Appearance>; layout: typeof layout; startup: typeof startup;
    search: typeof search; blocking: typeof blocking; icon: typeof icon; favorites: typeof favoriteDraft;
  }>());
  const screen = progress.screen;
  const [backwards, setBackwards] = useState(false);
  const [foundBrowsers, setFoundBrowsers] = useState<string[]>([]);
  useEffect(() => { void installedSetupApps(browsers.map(b => b.bundle)).then(setFoundBrowsers, () => {}); }, []);
  const group = screens[screen];
  const chosenLayout = layout ?? (snapshot.modal.tabLayout === 'top' ? 'top' : 'side');
  const selectedSearch = search ?? preferences?.engines.find(engine => engine.id === preferences.engine)?.setupKey;
  const visible = route(progress, chosenLayout, isLiquidGlass());
  const values: SetupValues = {
    progress, shell: { ...shell, ...patch }, appearance: { ...snapshot.appearance, ...appearance }, layout: chosenLayout,
    startup: startup ?? preferences?.startup ?? 'last', search: selectedSearch, managedSearch: !!preferences?.engineManaged,
    blocking: { enabled: blocking.enabled ?? preferences?.adblock.enabled ?? true,
      automatic: blocking.automatic ?? preferences?.adblock.automatic ?? false },
    blockingAvailable: !!preferences?.adblock.available, glassAvailable: isLiquidGlass(),
    favorites: favoriteDraft ?? progress.favorites, icon, system, hostOptions, code, codeEntry, codeReview, importOpen,
    sidebar: chosenLayout === 'side', installed, wantsCli, foundBrowsers,
  };

  useEffect(() => {
    let mounted = true;
    void actions.request('settings.get', {}).then(result => { if (mounted) setPreferences(result); }, () => {});
    return () => { mounted = false; };
  }, [actions, screen]);

  useEffect(() => {
    if (screen !== 'system') return;
    let mounted = true;
    void Promise.allSettled([isDefaultBrowser(), setupDockStatus(), loginItem()]).then(([browser, dock, login]) => {
      if (!mounted) return;
      const alreadyLogin = login.status === 'fulfilled' && ['enabled', 'requiresApproval'].includes(login.value);
      setSystem(previous => ({ ...previous,
        alreadyDefault: browser.status === 'fulfilled' && browser.value,
        alreadyDocked: dock.status === 'fulfilled' && dock.value, alreadyLogin }));
      setHostOptions(true);
    });
    return () => { mounted = false; };
  }, [screen]);

  async function perform(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await task(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); working.current = false; }
  }

  async function changeScreen(next: Progress) {
    if (!await actions.advanceWelcome('setup', next)) throw new Error('Merlin couldn’t save your place.');
    setBackwards(Object.keys(screens).indexOf(next.screen) < Object.keys(screens).indexOf(screen));
    const draft = drafts.current.get(next.screen);
    setProgress(next);
    setLayout(draft?.layout);
    setStartup(draft?.startup);
    setSearch(draft?.search);
    setAppearance(draft?.appearance ?? {});
    setPatch(draft?.patch ?? {});
    setIcon(draft?.icon);
    setBlocking(draft?.blocking ?? {});
    setCodeEntry(false);
    setCodeReview(null);
    setImportOpen(false);
    setFavoriteDraft(draft?.favorites);
  }

  async function setPreferenceValue<K extends 'engine' | 'startup' | 'tabs' | 'adblock' | 'adblockUpdates'>(key: K, value: unknown) {
    setPreferences(await actions.request('settings.set', { key, value }));
  }

  async function applyPreset(source: Exclude<Progress['source'], '' | 'fresh'>) {
    const preset = browserPreset(source);
    await saveShell(preset.shell);
    await setPreferenceValue('tabs', preset.layout);
    await setPreferenceValue('startup', 'last');
    if (!preferences?.engineManaged) await setPreferenceValue('engine', preset.engine);
  }

  async function advance(move: 'next' | 'back' | 'skip', custom?: boolean) {
    await perform(async () => {
      if (move === 'back' && codeEntry) { setCodeEntry(false); setCodeReview(null); return; }
      let selected = progress;
      if (screen === 'source' && move !== 'back') {
        selected = move === 'skip' ? { ...progress, source: '', custom: true } :
          { ...progress, custom: custom ?? false };
        if (selected.source && selected.source !== 'fresh') await applyPreset(selected.source);
      }
      if (move === 'next' && screen !== 'source') {
        if (layout) await setPreferenceValue('tabs', layout);
        if (startup) await setPreferenceValue('startup', startup);
        if (search) await setPreferenceValue('engine', search);
        if (blocking.enabled !== undefined) await setPreferenceValue('adblock', blocking.enabled);
        if (blocking.automatic !== undefined) await setPreferenceValue('adblockUpdates', blocking.automatic);
        if (Object.keys(patch).length) await saveShell(patch);
        if (Object.keys(appearance).length && !await actions.setAppearance(appearance))
          throw new Error('Merlin couldn’t save this appearance.');
        if (icon) await setAppIcon(icon);
        if (screen === 'favorites') selected = { ...selected, favorites: values.favorites };
        if (screen === 'system') {
          if ((system.default || system.trial) && !await makeDefaultBrowser())
            throw new Error('macOS didn’t make Merlin the default. You can try again or skip this group.');
          if (system.trial) await setPreference('defaultBrowserCheckIn', String(Date.now() + 7 * 86400000));
          if (system.dock && !await addMerlinToDock()) throw new Error('The Dock didn’t save the change.');
          if (system.login) {
            const state = await setLoginItem(true);
            if (state !== 'enabled' && state !== 'requiresApproval') throw new Error('macOS didn’t add Merlin to Login Items.');
          }
        }
        if (screen === 'cli' && wantsCli && !installed) {
          await installCli();
          setInstalled(true);
          setNotice('Installed at ~/.local/bin/merlin. If your shell can’t find it, add ~/.local/bin to PATH.');
          return;
        }
      }
      if (move === 'back') {
        drafts.current.set(screen, { patch, appearance, layout, startup, search, blocking, icon, favorites: favoriteDraft });
      } else {
        drafts.current.delete(screen);
      }
      const path = route(selected, chosenLayout, values.glassAvailable);
      await changeScreen({ ...selected, screen: nextScreen(screen, path, move) });
    });
  }

  async function applyCode() {
    const parsed = codeReview;
    if (!parsed) return;
    await perform(async () => {
      await saveShell({ ...parsed.shell, workspaceTheme: parsed.theme });
      await setPreferenceValue('tabs', parsed.layout);
      await setPreferenceValue('startup', parsed.startup);
      if (parsed.engine && !preferences?.engineManaged) await setPreferenceValue('engine', parsed.engine);
      if (parsed.blocking && preferences?.adblock.available) {
        await setPreferenceValue('adblock', parsed.blocking.enabled);
        await setPreferenceValue('adblockUpdates', parsed.blocking.automatic);
      }
      if (!await actions.setAppearance({ accent: parsed.accent, mode: parsed.mode })) throw new Error('Merlin couldn’t apply this appearance.');
      await changeScreen({ screen: 'layout', source: '', custom: true, favorites: parsed.favorites });
    });
  }

  const compact = size.width < setupGeometry.compactWidth;
  const question = visible.filter(item => screens[item] === group);
  const footer = importOpen ? <Button label="Back to browsers" variant="secondary" disabled={importBusy}
    onPress={() => setImportOpen(false)} /> : codeEntry ? <>
    <Back disabled={busy} onPress={() => void advance('back')} />
    <Button label={codeReview ? 'Apply setup code' : 'Review code'} variant="primary" size="large" disabled={busy || !code.trim()}
      onPress={() => codeReview ? void applyCode() : void perform(async () => {
        const parsed = readSetupCode(code);
        if (!parsed) throw new Error('This isn’t a valid Merlin setup code.');
        setCodeReview(parsed);
      })} />
  </> : screen === 'finish' ? <>
    <Back disabled={busy} onPress={() => void advance('back')} />
    <Button label="Start browsing" variant="primary" size="large" disabled={busy}
      onPress={() => void perform(async () => {
        if (!await actions.advanceWelcome('browse')) throw new Error('Merlin couldn’t close setup.');
      })} />
    <Button label="Take the Tour" variant="outline" size="large" disabled={busy}
      onPress={() => void perform(async () => {
        if (!await actions.advanceWelcome('tutorial')) throw new Error('Merlin couldn’t open the field guide.');
      })} />
  </> : <>
    {screen !== 'source' && <Back disabled={busy}
      onPress={() => void advance('back')} />}
    <Button label={screen === 'cli' && wantsCli && !installed ? 'Install Merlin CLI' :
      screen === 'favorites' && values.favorites.length ? 'Pin ' + values.favorites.length + (values.favorites.length === 1 ? ' Tab' : ' Tabs') : 'Continue'}
      variant="primary" size="large" disabled={busy || screen === 'source' && !progress.source || screen === 'system' && !hostOptions}
      onPress={() => void advance('next')} />
    <Button label="Skip" variant="outline" size="large" disabled={busy} onPress={() => void advance('skip')} />

  </>;

  const title = importOpen ? 'Import browser data' : codeEntry ? 'Bring your Merlin setup' : headings[screen][0];
  const detail = importOpen ? 'Select a source profile and the data to bring over.' :
    codeEntry ? 'Paste a code copied from another Merlin installation.' : headings[screen][1];
  const pageId = screen + (importOpen ? '-import' : codeEntry ? codeReview ? '-review' : '-code' : '');
  const preview = <SetupPreview values={values} screen={screen} compact={compact} />;
  return <View onLayout={event => setSize(event.nativeEvent.layout)}
    style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: compact ? space.lg : space.xl, backgroundColor: paper.canvas }}>
    <Panel fill="contentBackground" radius="dialog" border="borderSubtle" elevation="popover"
      style={{ width: '100%', height: '100%', maxWidth: compact ? setupGeometry.compactCard : setupGeometry.width, maxHeight: setupGeometry.height }}>
      <View style={{ flex: 1, flexDirection: 'row', borderRadius: radius.dialog, overflow: 'hidden', backgroundColor: paper.card }}>
      <View style={{ flex: 1, paddingHorizontal: space.xl, paddingTop: space.xxl, paddingBottom: space.md }}>
        <View accessible accessibilityLabel={'Step ' + group + ' of 9, question ' + (question.indexOf(screen) + 1) + ' of ' + question.length}
          style={{ gap: space.sm, paddingBottom: space.xl }}>
          <View style={{ flexDirection: 'row', gap: space.xs, maxWidth: setupGeometry.progressWidth }}>
            {Array.from({ length: 9 }, (_, index) => <View key={index} style={{ flex: 1, height: setupGeometry.stepHeight,
              borderRadius: radius.pill, backgroundColor: index < group ? paper.progress : colors.borderDefault }} />)}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text variant="section" tone="textSecondary">{'Step ' + group + ' of 9'}</Text>
            {question.length > 1 && <View style={{ flexDirection: 'row', gap: space.xs }}>
              {question.map((id, i) => <View key={id} style={{ width: setupGeometry.stepDot, height: setupGeometry.stepDot,
                borderRadius: radius.pill, backgroundColor: colors[id === screen ? 'textPrimary' : i < question.indexOf(screen) ? 'iconSecondary' : 'borderDefault'] }} />)}
            </View>}
          </View>
        </View>
        <PageTurn id={pageId} backwards={backwards}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: space.lg, gap: space.md }}>
            <Heading title={title} detail={detail} focus={!codeEntry || !!codeReview} />
            {compact && <View style={{ height: screen === 'favorites' ? setupGeometry.compactPinsHeight : setupGeometry.compactPreview, backgroundColor: paper.stage, borderRadius: radius.card }}>{preview}</View>}
            <SetupPage screen={screen} values={values} busy={busy} actions={{
              option: (key, value) => setPatch(previous => ({ ...previous, [key]: value })),
              appearance: value => setAppearance(previous => ({ ...previous, ...value })),
              layout: setLayout, startup: setStartup, search: setSearch,
              blocking: value => setBlocking(previous => ({ ...previous, ...value })),
              icon: setIcon, system: value => setSystem(previous => ({ ...previous, ...value })),
              source: source => setProgress(previous => ({ ...previous, source })), code: value => { setCode(value); setCodeReview(null); },
              startCode: () => { setError(''); setCodeEntry(true); }, replayIntro,
              startImport: () => { setError(''); setImportOpen(true); }, importBusy: setImportBusy,
              favorite: id => setFavoriteDraft(previous => {
                const current = previous ?? progress.favorites;
                return current.includes(id) ? current.filter(value => value !== id) : [...current, id];
              }),
              selectCli: setWantsCli,
              copyCode: () => void perform(async () => {
                await copyText(makeSetupCode({ layout: values.layout, startup: values.startup, mode: values.appearance.mode,
                  accent: values.appearance.accent, engine: values.search || undefined, favorites: values.favorites,
                  blocking: values.blockingAvailable ? values.blocking : undefined,
                  theme: shell.workspaceTheme }, shell));
                setNotice('Setup code copied.');
              }),
            }} />
    {screen === 'source' && progress.source && progress.source !== 'fresh' &&
      <Button label="Customize more" variant="secondary" disabled={busy} onPress={() => void advance('next', true)} />}
        </ScrollView>
        </PageTurn>
        {!!(error || notice) && <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }} accessibilityLiveRegion="polite">
          <Icon name={error ? 'exclamationmark.triangle' : 'checkmark'} tone={error ? 'textDanger' : 'textSuccess'} />
          <Text flex={1} variant="caption" tone={error ? 'textDanger' : 'textSuccess'}>{error || notice}</Text>
        </View>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.sm, paddingTop: space.md, paddingBottom: space.md }}>
          {footer}
        </View>
      </View>
      {!compact && <View style={{ width: '51.2%', marginVertical: space.md, marginRight: space.md, padding: space.lg,
        borderRadius: radius.panel, borderWidth: geometry.hairline, borderColor: colors.borderDefault, backgroundColor: paper.stage }}>
        <PageTurn id={previewKey(screen, values)} backwards={backwards}>{preview}</PageTurn>
      </View>}
      </View>
    </Panel>
  </View>;
}
