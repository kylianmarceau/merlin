import React from 'react';
import { Image, View } from 'react-native';
import { liquidGlass } from '../../state/glass';
import { GLASS_DEFAULTS, PAGE_FRAME, SIDEBAR_WIDTH, useShellPrefs } from '../../state/shellPrefs';
import { setShellFollowsSite, setShellPref, setToolbarColor, setNewTabPopup } from '../../state/shellPrefsStorage';
import { ThemeEditor } from './ThemeEditor';
import { useAppIcons } from '../../state/system';
import type { Preferences, PreferenceKey } from '../../state/types';
import { useActions, useSnapshot, useSpaces } from '../../state/window';
import {
  Button, FormGroup, FormRow, GlassFill, GlassScope, PictureChoice, PopUp, Segmented, Slider, Text, Toggle, accents, accentSwatch,
  geometry, radius, space, toolbarColorLabels, toolbarColors, useLit, useTheme,
} from '../ui';
import { Swatch, ThemeChoice } from './Previews';

type Set = (key: PreferenceKey, value: unknown) => void;

/**
 * Settings › Appearance, after Ardia's: the theme, the interface style (Glass
 * or Classic, its tint and Merlin's transparency), the address bar, tabs,
 * bookmarks, the page frame, the selected tab, scroll bars and the app icon.
 */
export function AppearancePane({ p, set }: { p: Preferences | null; set: Set }) {
  const actions = useActions();
  const { appearance } = useSnapshot();
  const prefs = useShellPrefs(s => s);
  const top = p?.tabs === 'top';
  return <>
    <Section title="Appearance Theme" detail="Private windows follow it too.">
      <View accessibilityRole="radiogroup" accessibilityLabel="Colour scheme" style={{ flexDirection: 'row', gap: space.md + space.hair }}>
        {(['system', 'light', 'dark'] as const).map(mode => <ThemeChoice key={mode} mode={mode} accent={appearance.accent}
          selected={appearance.mode === mode} onPress={() => void actions.setAppearance({ mode })} />)}
      </View>
      <FormGroup>
        <FormRow stacked title="Space colour" detail="Colours highlights in both modes and tints the window in Light mode, for spaces without a colour of their own.">
          <View accessibilityRole="radiogroup" accessibilityLabel="Space colour" style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md }}>
            {accents.map(a => <Swatch key={a} name={a} selected={appearance.accent === a}
              onPress={() => void actions.setAppearance({ accent: a })} />)}
          </View>
        </FormRow>
        <FormRow title="Reduce motion" detail="Panels and popovers appear without animation.">
          <Toggle label="Reduce motion" value={appearance.reduceMotion} onChange={reduceMotion => void actions.setAppearance({ reduceMotion })} />
        </FormRow>
      </FormGroup>
    </Section>

    {liquidGlass && <Section title="Interface Style"
      detail="Glass uses macOS Liquid Glass for address fields, pinned tabs, and popovers. Classic uses flat fills and solid panels.">
      <View accessibilityRole="radiogroup" accessibilityLabel="Interface style" style={{ flexDirection: 'row', gap: space.xl }}>
        <StyleChoice glass selected={prefs.interfaceStyle === 'glass'} onPress={() => void setShellPref('interfaceStyle', 'glass')} />
        <StyleChoice glass={false} selected={prefs.interfaceStyle === 'classic'} onPress={() => void setShellPref('interfaceStyle', 'classic')} />
      </View>
      {prefs.interfaceStyle === 'glass' && <FormGroup>
        <FormRow title="Transparency" detail="From nearly solid to clear glass; the middle is frosted. The window around the page follows it.">
          <AmountRow label="Transparency" value={prefs.glassTransparency} onChange={v => void setShellPref('glassTransparency', v)}
            reset={GLASS_DEFAULTS.transparency} />
        </FormRow>
        <FormRow title="Tint glass with the space colour" detail="Off, the glass stays neutral whatever the space colour.">
          <Toggle label="Tint glass with the space colour" value={prefs.glassTintWithTheme}
            onChange={on => void setShellPref('glassTintWithTheme', on)} />
        </FormRow>
        {prefs.glassTintWithTheme && <FormRow title="Tint amount" detail="How much of the space colour the glass takes, from a hint to fully coloured.">
          <AmountRow label="Tint amount" value={prefs.glassTintAmount} onChange={v => void setShellPref('glassTintAmount', v)} />
        </FormRow>}
      </FormGroup>}
    </Section>}

    <Section title="Address Bar" detail={top
      ? 'Tabs are across the top of the window, so the address bar stays in the toolbar.'
      : 'Choose where the address appears. Navigation stays above the page. Hiding the sidebar moves the address into the toolbar.'}>
      {!top && <View accessibilityRole="radiogroup" accessibilityLabel="Address bar" style={{ flexDirection: 'row', gap: space.xl }}>
        <AddressBarChoice place="toolbar" selected={prefs.addressBar === 'toolbar'} onPress={() => void setShellPref('addressBar', 'toolbar')} />
        <AddressBarChoice place="sidebar" selected={prefs.addressBar !== 'toolbar'} onPress={() => void setShellPref('addressBar', 'sidebar')} />
      </View>}
      <FormGroup>
        <FormRow title="⌘L opens the command bar"
          detail="In the centre, ⌘L edits the address over the middle of the page, as in Arc. A click on the address always edits it where it is.">
          <PopUp label="⌘L opens the command bar" value={prefs.commandBarPlacement}
            options={[{ value: 'field', title: 'At the address' }, { value: 'centred', title: 'In the centre' }]}
            onChange={v => void setShellPref('commandBarPlacement', v)} />
        </FormRow>
        <FormRow title="Compact toolbar" detail="A slimmer toolbar, so the page gets more height.">
          <Toggle label="Compact toolbar" value={prefs.compactToolbar} onChange={on => void setShellPref('compactToolbar', on)} />
        </FormRow>
      </FormGroup>
    </Section>

    <Section title="Tabs">
      {p && <TabPositionRow tabs={p.tabs} onChange={tabs => set('tabs', tabs)} />}
      <FormGroup>
        {<FormRow title="Site colour" detail={top
          ? "The active tab and toolbar take the site's colour. Match continues the top of the page; Soft and Vivid use the site's brand colour. New tabs stay white."
          : "The toolbar takes the site's colour, as can the window. Match continues the top of the page; Soft and Vivid use the site's brand colour. New tabs stay white."}>
          <Segmented label="Site colour" value={prefs.toolbarColor} onChange={style => void setToolbarColor(style)}
            options={toolbarColors.map(value => ({ value, label: toolbarColorLabels[value] }))} /></FormRow>}
        {prefs.toolbarColor !== 'white' && prefs.toolbarColor !== 'workspace' && <FormRow title="Tint the window with the site colour"
          detail="The space around the page follows the site's colour in Light and Dark mode.">
          <Toggle label="Tint the window with the site colour" value={prefs.shellFollowsSite} onChange={on => void setShellFollowsSite(on)} /></FormRow>}
        <FormRow title="Open new tabs as a pop-up" detail="Search over the current page; the tab opens once you choose where to go.">
          <Toggle label="Open new tabs as a pop-up" value={prefs.newTabPopup} onChange={on => void setNewTabPopup(on)} /></FormRow>
        <FormRow title="New tabs open" detail="Choose where a new blank tab lands. Links you open keep their place.">
          <Segmented label="New tabs open" value={prefs.newTabPosition} onChange={v => void setShellPref('newTabPosition', v)}
            options={[{ value: 'end', label: 'Last' }, { value: 'top', label: 'First' },
              { value: 'adjacent', label: 'After current' }]} /></FormRow>
        <FormRow title="Favorite tiles adapt to the sidebar">
          <Toggle label="Favorite tiles adapt to the sidebar" value={prefs.adaptiveFavorites}
            onChange={value => void setShellPref('adaptiveFavorites', value)} />
        </FormRow>
        <FormRow title="Hide toolbar while scrolling" detail="Applies when the toolbar contains the address. Scroll up or press ⌘L to show it again.">
          <Toggle label="Hide toolbar while scrolling" value={prefs.hideToolbarOnScroll}
            onChange={value => void setShellPref('hideToolbarOnScroll', value)} />
        </FormRow>
        {!top && prefs.sidebarWidth !== SIDEBAR_WIDTH.default && <FormRow title="Sidebar width"
          detail={`${Math.round(prefs.sidebarWidth)} points. Drag the sidebar's edge to change it.`}>
          <Button label="Reset" size="small" onPress={() => void setShellPref('sidebarWidth', SIDEBAR_WIDTH.default)} /></FormRow>}
        {p && <FormRow title="Default page zoom"><Segmented label="Default zoom" value={p.zoom} onChange={zoom => set('zoom', zoom)}
          options={p.zoomChoices.filter(z => z >= 75 && z <= 150).map(z => ({ value: z, label: `${z}%` }))} /></FormRow>}
      </FormGroup>
    </Section>

    <Section title="Bookmarks">
      <FormGroup>
        <FormRow title="Show bookmarks"
          detail="Off hides the bookmark star, the bookmarks bar, the sidebar's Bookmarks and the Bookmarks menu. Your bookmarks stay.">
          <Toggle label="Show bookmarks" value={prefs.showBookmarks} onChange={on => void setShellPref('showBookmarks', on)} />
        </FormRow>
        {prefs.showBookmarks && <FormRow title="Bookmarks bar"
          detail="The Bookmarks bar folder over the page, where the star saves. New Tab only shows it on new tabs and the start page.">
          <Segmented label="Bookmarks bar" value={prefs.bookmarksBar} onChange={v => void setShellPref('bookmarksBar', v)}
            options={[{ value: 'always', label: 'Always' }, { value: 'newTab', label: 'New Tab only' }, { value: 'never', label: 'Never' }]} />
        </FormRow>}
        {prefs.showBookmarks && !top && <FormRow title="Bookmarks in the sidebar" detail="The Bookmarks bar folder under your pinned tabs.">
          <Toggle label="Bookmarks in the sidebar" value={prefs.sidebarBookmarks} onChange={on => void setShellPref('sidebarBookmarks', on)} />
        </FormRow>}
        {prefs.showBookmarks && prefs.bookmarksBar !== 'never' && <FormRow title="Size" detail="Large makes the bar, its icons and its text bigger.">
          <PopUp label="Bookmarks bar size" value={prefs.bookmarksBarSize}
            options={[{ value: 'default', title: 'Default' }, { value: 'large', title: 'Large' }]}
            onChange={v => void setShellPref('bookmarksBarSize', v)} />
        </FormRow>}
      </FormGroup>
    </Section>

    <Section title="Page Frame">
      <FormGroup>
        <FormRow title="Borderless mode" detail="Remove the page frame and rounded corners. Turn off to restore your frame thickness.">
          <Toggle label="Borderless mode" value={prefs.borderlessMode} onChange={on => void setShellPref('borderlessMode', on)} />
        </FormRow>
        {!prefs.borderlessMode && <FormRow title="Frame around the page"
          detail={`The room between the page and the window's edges. At 0 the page goes edge to edge with square corners; ${PAGE_FRAME.default} pt is the default.`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Slider label="Frame around the page" value={prefs.pageFrame / PAGE_FRAME.max}
              valueText={prefs.pageFrame ? `${prefs.pageFrame} points` : 'None'}
              onChange={v => void setShellPref('pageFrame', Math.round(v * PAGE_FRAME.max))} />
            <Text variant="label" weight="regular" tone="textSecondary" style={{ minWidth: space.xl + space.md }} align="right">
              {prefs.pageFrame ? `${prefs.pageFrame} pt` : 'None'}
            </Text>
          </View>
        </FormRow>}
        <FormRow title="Zero in full screen" detail="In macOS full screen the page goes edge to edge with square corners, whatever the frame above is set to.">
          <Toggle label="Zero in full screen" value={prefs.pageFrameZeroInFullScreen} disabled={prefs.borderlessMode}
            onChange={on => {
              void setShellPref('pageFrameZeroInFullScreen', on);
              if (on) void setShellPref('pageFrameZeroWhenTabsHidden', true);
            }} />
        </FormRow>
        <FormRow title="Zero in full screen when tabs are hidden"
          detail="In macOS full screen with the tabs hidden (⌘S), the page goes edge to edge. Show the tabs, or leave full screen, and the frame comes back.">
          <Toggle label="Zero in full screen when tabs are hidden" value={prefs.pageFrameZeroInFullScreen || prefs.pageFrameZeroWhenTabsHidden}
            disabled={prefs.borderlessMode || prefs.pageFrameZeroInFullScreen} onChange={on => void setShellPref('pageFrameZeroWhenTabsHidden', on)} />
        </FormRow>
      </FormGroup>
    </Section>

    <Section title="Selected Tab">
      <FormGroup>
        <FormRow title="Glow around the selected tab" detail="The soft light around the selected tab in the sidebar.">
          <PopUp label="Glow around the selected tab" value={prefs.selectedTabGlow}
            options={[{ value: 'full', title: 'Full' }, { value: 'soft', title: 'Soft' }, { value: 'off', title: 'Off' }]}
            onChange={v => void setShellPref('selectedTabGlow', v)} />
        </FormRow>
      </FormGroup>
    </Section>

    <Section title="Scroll Bars">
      <FormGroup>
        <FormRow title="Scroll bars"
          detail="Follow macOS uses System Settings › Appearance › Show scroll bars. Thin shows slim scroll bars over the page only while you scroll, even with a mouse.">
          <PopUp label="Scroll bars" value={prefs.pageScrollBars}
            options={[{ value: 'system', title: 'Follow macOS' }, { value: 'thin', title: 'Thin' }]}
            onChange={v => void setShellPref('pageScrollBars', v)} />
        </FormRow>
      </FormGroup>
    </Section>

    <WorkspaceColourEditor />
    <AppIconSection />
  </>;
}

function Section({ title, detail, children }: React.PropsWithChildren<{ title: string; detail?: string }>) {
  const lit = useLit(title);
  return <View style={{ gap: space.md, marginBottom: space.lg }}>
    <View ref={lit.ref} style={{ gap: space.hair }}>
      {lit.glow}
      <Text variant="title">{title}</Text>
      {!!detail && <Text variant="label" weight="regular" tone="textSecondary">{detail}</Text>}
    </View>
    {children}
  </View>;
}

function AmountRow({ label, value, onChange, reset }: { label: string; value: number; onChange(value: number): void; reset?: number }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
    <Slider label={label} value={value} valueText={`${Math.round(value * 100)} percent`}
      onChange={v => onChange(Math.round(v * 100) / 100)} />
    <Text variant="label" weight="regular" tone="textSecondary" style={{ minWidth: space.xl + space.md }} align="right"
      onPress={reset === undefined ? undefined : () => onChange(reset)}>{`${Math.round(value * 100)}%`}</Text>
  </View>;
}

/** Glass or Classic, drawn as three tiles on the workspace colour. */
function StyleChoice({ glass, selected, onPress }: { glass: boolean; selected: boolean; onPress(): void }) {
  const { colors, dark, accent, glass: look } = useTheme();
  const swatch = accentSwatch(dark ? 'dark' : 'light', accent);
  return <PictureChoice title={glass ? 'Glass' : 'Classic'} selected={selected} onPress={onPress}>
    <View style={{ flex: 1, alignSelf: 'stretch', backgroundColor: swatch.fill, padding: space.md, flexDirection: 'row', gap: space.sm }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: space.lg, top: space.md, width: space.huge, height: space.huge,
        borderRadius: radius.pill, backgroundColor: swatch.accent }} />
      <GlassScope look={{ ...look, on: glass && liquidGlass, translucent: glass }}>
        {[0, 1, 2].map(i => <View key={i} style={{ flex: 1, height: space.xl + space.sm, borderRadius: radius.tile, alignSelf: 'flex-end',
          backgroundColor: glass ? colors.fillTransparent : colors.surfacePopoverSolid,
          borderWidth: glass ? 0 : geometry.hairline, borderColor: colors.borderDefault }}>
          {glass && <GlassFill radius={radius.tile} state={i === 0 ? 'active' : 'rest'} />}
        </View>)}
      </GlassScope>
    </View>
  </PictureChoice>;
}

/** A small window with the address in its sidebar or in the page's toolbar. */
function AddressBarChoice({ place, selected, onPress }: { place: 'toolbar' | 'sidebar'; selected: boolean; onPress(): void }) {
  const { colors } = useTheme();
  const pill = { height: space.sm, borderRadius: radius.xs, backgroundColor: colors.accent } as const;
  return <PictureChoice title={place === 'toolbar' ? 'In the toolbar' : 'In the sidebar'} selected={selected} onPress={onPress}>
    <View style={{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', padding: space.sm, gap: space.sm, backgroundColor: colors.shellTint }}>
      <View style={{ width: space.xxl + space.sm, gap: space.xs }}>
        {place === 'sidebar' && <View style={pill} />}
        {[0, 1, 2].map(i => <View key={i} style={{ height: space.xs + space.hair, borderRadius: radius.xs, backgroundColor: colors.fillShellControl }} />)}
      </View>
      <View style={{ flex: 1, borderRadius: radius.sm, backgroundColor: colors.contentBackground, overflow: 'hidden' }}>
        <View style={{ height: space.md, justifyContent: 'center', paddingHorizontal: space.xs, borderBottomWidth: geometry.hairline,
          borderBottomColor: colors.toolbarDivider }}>
          {place === 'toolbar' && <View style={[pill, { height: space.xs + space.hair }]} />}
        </View>
      </View>
    </View>
  </PictureChoice>;
}

/** Tab position as two small windows, like the theme and address bar choices: tabs down the side or across the top. */
function TabPositionRow({ tabs, onChange }: { tabs: Preferences['tabs']; onChange(tabs: Preferences['tabs']): void }) {
  const lit = useLit('Tab position');
  return <View ref={lit.ref} style={{ gap: space.sm }}>
    {lit.glow}
    <Text variant="label" weight="regular" tone="textSecondary">Tab position: down the side or across the top. Command-S hides them either way.</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Tab position" style={{ flexDirection: 'row', gap: space.xl, marginBottom: space.sm }}>
      <TabPositionChoice place="side" selected={tabs !== 'top'} onPress={() => onChange('side')} />
      <TabPositionChoice place="top" selected={tabs === 'top'} onPress={() => onChange('top')} />
    </View>
  </View>;
}

function TabPositionChoice({ place, selected, onPress }: { place: 'side' | 'top'; selected: boolean; onPress(): void }) {
  const { colors } = useTheme();
  const tab = (active: boolean) => ({ borderRadius: radius.xs, backgroundColor: colors[active ? 'contentBackground' : 'fillShellControl'] });
  return <PictureChoice title={place === 'side' ? 'Sidebar' : 'Top'} selected={selected} onPress={onPress}>
    <View style={{ flex: 1, alignSelf: 'stretch', flexDirection: place === 'side' ? 'row' : 'column', padding: space.sm, gap: space.sm,
      backgroundColor: colors.shellTint }}>
      {place === 'side'
        ? <View style={{ width: space.xxl + space.sm, gap: space.xs }}>
          {[1, 0, 0].map((active, i) => <View key={i} style={[tab(!!active), { height: space.sm }]} />)}
        </View>
        : <View style={{ flexDirection: 'row', gap: space.xs, height: space.sm, paddingLeft: space.lg }}>
          {[1, 0, 0].map((active, i) => <View key={i} style={[tab(!!active), { width: space.xl }]} />)}
        </View>}
      <View style={{ flex: 1, borderRadius: radius.sm, backgroundColor: colors.contentBackground }} />
    </View>
  </PictureChoice>;
}

function AppIconSection() {
  const { choices, current, choose } = useAppIcons(geometry.appIcon);
  if (choices.length < 2) return null;
  return <Section title="App Icon" detail="Shown in the Dock and the app switcher. The Dock keeps it after you quit.">
    <View accessibilityRole="radiogroup" accessibilityLabel="App icon" style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm, rowGap: space.md }}>
      {choices.map(icon => <PictureChoice key={icon.id} size="icon" title={icon.name} selected={icon.id === current} onPress={() => choose(icon.id)}>
        <Image source={{ uri: icon.preview }} style={{ width: geometry.appIcon, height: geometry.appIcon }} />
      </PictureChoice>)}
    </View>
  </Section>;
}


/** The gradient over the window: the space showing's own, as Arc and Zen colour each space; Appearance's in a window without spaces. */
function WorkspaceColourEditor() {
  const actions = useActions();
  const { appearance } = useSnapshot();
  const fallback = useShellPrefs(p => p.workspaceTheme);
  const { active } = useSpaces();
  return <Section title={active ? `${active.name} gradient` : 'Window gradient'}>
    <ThemeEditor accent={appearance.accent} theme={active ? active.theme ?? fallback : fallback}
      onAccent={accent => { void actions.setAppearance({ accent }); }}
      onTheme={value => { if (active) actions.spaces.setSpaceTheme(active.id, value); else void setShellPref('workspaceTheme', value); }} />
  </Section>;
}
