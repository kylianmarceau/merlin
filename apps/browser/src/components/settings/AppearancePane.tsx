import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { liquidGlass } from '../../state/glass';
import { GLASS_DEFAULTS, PAGE_FRAME, SIDEBAR_WIDTH, useShellPrefs } from '../../state/shellPrefs';
import { setShellFollowsSite, setShellPref, setToolbarColor, setNewTabPopup } from '../../state/shellPrefsStorage';
import { ThemeEditor } from './ThemeEditor';
import type { useAppIcons } from '../../state/system';
import type { Preferences, PreferenceKey } from '../../state/types';
import { useActions, useSnapshot, useSpaces } from '../../state/window';
import {
  Button, FormGroup, FormRow, PopUp, Segmented, Slider, Text, Toggle, accents, settingsArt, settingsGeometry,
  geometry, radius, space, toolbarColorLabels, toolbarColors, useTheme,
} from '../ui';
import { PreviewGroup, PreviewTile, Swatch, ThemeChoice } from './Previews';

type Set = (key: PreferenceKey, value: unknown) => void;

/**
 * Settings › Appearance: the theme, the interface style (Glass
 * or Classic, its tint and Merlin's transparency), the address bar, tabs,
 * bookmarks, the page frame, the selected tab, scroll bars and the app icon.
 */
export function AppearancePane({ p, set, icons }: { p: Preferences | null; set: Set; icons: ReturnType<typeof useAppIcons> }) {
  const actions = useActions();
  const { appearance } = useSnapshot();
  const prefs = useShellPrefs(s => s);
  const { colors } = useTheme();
  const [wideGallery, setWideGallery] = useState(true);
  const top = p?.tabs === 'top';
  const glass = liquidGlass && prefs.interfaceStyle === 'glass';
  return <>
    <FormGroup title="Appearance">
      <View onLayout={e => setWideGallery(e.nativeEvent.layout.width >= settingsGeometry.galleryWidth)}
        style={{ flexDirection: wideGallery ? 'row' : 'column', gap: space.sm, paddingVertical: space.md }}>
        <PreviewGroup title="Colour scheme" expanded={wideGallery && liquidGlass}>
          {(['system', 'light', 'dark'] as const).map(mode => <ThemeChoice expand={wideGallery && liquidGlass} key={mode} mode={mode}
            selected={appearance.mode === mode} onPress={() => void actions.setAppearance({ mode })} />)}
        </PreviewGroup>
        {liquidGlass && wideGallery && <View style={{ width: geometry.hairline, backgroundColor: colors.borderSubtle }} />}
        {liquidGlass && <PreviewGroup title="Interface style" expanded={wideGallery}>
          {(['classic', 'glass'] as const).map(style => <PreviewTile expand={wideGallery} key={style} title={style === 'glass' ? 'Glass' : 'Classic'}
            selected={prefs.interfaceStyle === style} onPress={() => void setShellPref('interfaceStyle', style)}>
            <View style={{ width: settingsGeometry.material, height: settingsGeometry.material, borderRadius: radius.pill,
              backgroundColor: settingsArt[style], borderWidth: geometry.hairline,
              borderColor: style === 'glass' ? settingsArt.glassEdge : colors.surfaceSheet }} />
          </PreviewTile>)}
        </PreviewGroup>}
      </View>
      {glass && <FormRow title="Transparency">
        <AmountRow label="Transparency" value={prefs.glassTransparency} onChange={v => void setShellPref('glassTransparency', v)}
          reset={GLASS_DEFAULTS.transparency} />
      </FormRow>}
      {glass && <FormRow title="Tint glass with the space colour">
        <Toggle capsule label="Tint glass with the space colour" value={prefs.glassTintWithTheme}
          onChange={on => void setShellPref('glassTintWithTheme', on)} />
      </FormRow>}
      {glass && prefs.glassTintWithTheme && <FormRow title="Tint amount">
        <AmountRow label="Tint amount" value={prefs.glassTintAmount} onChange={v => void setShellPref('glassTintAmount', v)} />
      </FormRow>}
      <FormRow title="Reduce motion">
        <Toggle capsule label="Reduce motion" value={appearance.reduceMotion} onChange={reduceMotion => void actions.setAppearance({ reduceMotion })} />
      </FormRow>
    </FormGroup>

    <FormGroup title="Toolbar">
      <FormRow title="Address Bar" detail={top ? 'Top tabs keep the address in the toolbar.' : 'Hiding the sidebar moves the address into the toolbar.'}>
        {top ? <Text tone="textSecondary">Toolbar</Text> : <Segmented label="Address bar" value={prefs.addressBar}
          options={[{ value: 'toolbar', label: 'Toolbar', icon: 'rectangle.topthird.inset.filled' }, { value: 'sidebar', label: 'Sidebar', icon: 'sidebar.left' }]}
          onChange={place => void setShellPref('addressBar', place)} />}
      </FormRow>
      <FormRow title="⌘L opens the command bar"
        detail="Choose where to edit the address with ⌘L.">
        <PopUp label="⌘L opens the command bar" value={prefs.commandBarPlacement}
          options={[{ value: 'field', title: 'At the address' }, { value: 'centred', title: 'In the centre' }]}
          onChange={v => void setShellPref('commandBarPlacement', v)} />
      </FormRow>
      <FormRow title="Compact toolbar">
        <Toggle capsule label="Compact toolbar" value={prefs.compactToolbar} onChange={on => void setShellPref('compactToolbar', on)} />
      </FormRow>
    </FormGroup>

    <FormGroup title="Tabs">
      {p && <FormRow title="Tab position" detail="Press ⌘S to show or hide your tabs.">
        <Segmented label="Tab position" value={p.tabs} onChange={value => set('tabs', value)}
          options={[{ value: 'side', label: 'Sidebar', icon: 'sidebar.left' }, { value: 'top', label: 'Top', icon: 'rectangle.topthird.inset.filled' }]} />
      </FormRow>}
      <FormRow stacked title="Site colour" detail={top
        ? "The active tab and toolbar take the site's colour. Match continues the top of the page; Soft and Vivid use the site's brand colour. New tabs stay white."
        : "The toolbar takes the site's colour, as can the window. Match continues the top of the page; Soft and Vivid use the site's brand colour. New tabs stay white."}>
        <Segmented label="Site colour" value={prefs.toolbarColor} onChange={style => void setToolbarColor(style)}
          options={toolbarColors.map(value => ({ value, label: toolbarColorLabels[value] }))} /></FormRow>
      {prefs.toolbarColor !== 'white' && prefs.toolbarColor !== 'workspace' && <FormRow title="Tint the window with the site colour"
        detail="The space around the page follows the site's colour in Light and Dark mode.">
        <Toggle capsule label="Tint the window with the site colour" value={prefs.shellFollowsSite} onChange={on => void setShellFollowsSite(on)} /></FormRow>}
      <FormRow title="Open new tabs as a pop-up" detail="Search over the current page; the tab opens once you choose where to go.">
        <Toggle capsule label="Open new tabs as a pop-up" value={prefs.newTabPopup} onChange={on => void setNewTabPopup(on)} /></FormRow>
      <FormRow title="New tabs open" detail="Choose where a new blank tab lands. Links you open keep their place.">
        <Segmented label="New tabs open" value={prefs.newTabPosition} onChange={v => void setShellPref('newTabPosition', v)}
          options={[{ value: 'end', label: 'Last' }, { value: 'top', label: 'First' },
            { value: 'adjacent', label: 'After current' }]} /></FormRow>
      <FormRow title="Favorite tiles adapt to the sidebar">
        <Toggle capsule label="Favorite tiles adapt to the sidebar" value={prefs.adaptiveFavorites}
          onChange={value => void setShellPref('adaptiveFavorites', value)} />
      </FormRow>
      <FormRow title="Hide toolbar while scrolling" detail="Applies when the toolbar contains the address. Scroll up or press ⌘L to show it again.">
        <Toggle capsule label="Hide toolbar while scrolling" value={prefs.hideToolbarOnScroll}
          onChange={value => void setShellPref('hideToolbarOnScroll', value)} />
      </FormRow>
      {!top && prefs.sidebarWidth !== SIDEBAR_WIDTH.default && <FormRow title="Sidebar width"
        detail={`${Math.round(prefs.sidebarWidth)} points. Drag the sidebar's edge to change it.`}>
        <Button label="Reset" size="small" onPress={() => void setShellPref('sidebarWidth', SIDEBAR_WIDTH.default)} /></FormRow>}
      {p && <FormRow title="Default page zoom"><PopUp label="Default zoom" value={String(p.zoom)} onChange={zoom => set('zoom', Number(zoom))}
        options={p.zoomChoices.filter(z => z >= 75 && z <= 150).map(z => ({ value: String(z), title: `${z}%` }))} /></FormRow>}
    </FormGroup>

    <FormGroup title="Bookmarks">
      <FormRow title="Show bookmarks"
        detail="Off hides the bookmark star, the bookmarks bar, the sidebar's Bookmarks and the Bookmarks menu. Your bookmarks stay.">
        <Toggle capsule label="Show bookmarks" value={prefs.showBookmarks} onChange={on => void setShellPref('showBookmarks', on)} />
      </FormRow>
      {prefs.showBookmarks && <FormRow title="Bookmarks bar"
        detail="The Bookmarks bar folder over the page, where the star saves. New Tab only shows it on new tabs and the start page.">
        <Segmented label="Bookmarks bar" value={prefs.bookmarksBar} onChange={v => void setShellPref('bookmarksBar', v)}
          options={[{ value: 'always', label: 'Always' }, { value: 'newTab', label: 'New Tab only' }, { value: 'never', label: 'Never' }]} />
      </FormRow>}
      {prefs.showBookmarks && !top && <FormRow title="Bookmarks in the sidebar" detail="The Bookmarks bar folder under your pinned tabs.">
        <Toggle capsule label="Bookmarks in the sidebar" value={prefs.sidebarBookmarks} onChange={on => void setShellPref('sidebarBookmarks', on)} />
      </FormRow>}
      {prefs.showBookmarks && prefs.bookmarksBar !== 'never' && <FormRow title="Size" detail="Large makes the bar, its icons and its text bigger.">
        <PopUp label="Bookmarks bar size" value={prefs.bookmarksBarSize}
          options={[{ value: 'default', title: 'Default' }, { value: 'large', title: 'Large' }]}
          onChange={v => void setShellPref('bookmarksBarSize', v)} />
      </FormRow>}
    </FormGroup>

    <FormGroup title="Page Frame">
      <FormRow title="Borderless mode" detail="Remove the page frame and rounded corners. Turn off to restore your frame thickness.">
        <Toggle capsule label="Borderless mode" value={prefs.borderlessMode} onChange={on => void setShellPref('borderlessMode', on)} />
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
        <Toggle capsule label="Zero in full screen" value={prefs.pageFrameZeroInFullScreen} disabled={prefs.borderlessMode}
          onChange={on => {
            void setShellPref('pageFrameZeroInFullScreen', on);
            if (on) void setShellPref('pageFrameZeroWhenTabsHidden', true);
          }} />
      </FormRow>
      <FormRow title="Zero in full screen when tabs are hidden"
        detail="In macOS full screen with the tabs hidden (⌘S), the page goes edge to edge. Show the tabs, or leave full screen, and the frame comes back.">
        <Toggle capsule label="Zero in full screen when tabs are hidden" value={prefs.pageFrameZeroInFullScreen || prefs.pageFrameZeroWhenTabsHidden}
          disabled={prefs.borderlessMode || prefs.pageFrameZeroInFullScreen} onChange={on => void setShellPref('pageFrameZeroWhenTabsHidden', on)} />
      </FormRow>
    </FormGroup>

    <FormGroup title="Selected Tab">
      <FormRow title="Glow around the selected tab" detail="The soft light around the selected tab in the sidebar.">
        <PopUp label="Glow around the selected tab" value={prefs.selectedTabGlow}
          options={[{ value: 'full', title: 'Full' }, { value: 'soft', title: 'Soft' }, { value: 'off', title: 'Off' }]}
          onChange={v => void setShellPref('selectedTabGlow', v)} />
      </FormRow>
    </FormGroup>

    <FormGroup title="Scroll Bars">
      <FormRow title="Scroll bars"
        detail="Follow macOS uses System Settings › Appearance › Show scroll bars. Thin shows slim scroll bars over the page only while you scroll, even with a mouse.">
        <PopUp label="Scroll bars" value={prefs.pageScrollBars}
          options={[{ value: 'system', title: 'Follow macOS' }, { value: 'thin', title: 'Thin' }]}
          onChange={v => void setShellPref('pageScrollBars', v)} />
      </FormRow>
    </FormGroup>

    <FormGroup title="Window colour">
      <FormRow stacked title="Space colour" detail="Colours highlights in both modes and tints the window in Light mode, for spaces without a colour of their own.">
        <View accessibilityRole="radiogroup" accessibilityLabel="Space colour" style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md }}>
          {accents.map(a => <Swatch key={a} name={a} selected={appearance.accent === a}
            onPress={() => void actions.setAppearance({ accent: a })} />)}
        </View>
      </FormRow>
    </FormGroup>
    <WorkspaceColourEditor />
    <AppIconSection {...icons} />
  </>;
}

function AmountRow({ label, value, onChange, reset }: { label: string; value: number; onChange(value: number): void; reset?: number }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
    <Slider label={label} value={value} valueText={`${Math.round(value * 100)} percent`}
      onChange={v => onChange(Math.round(v * 100) / 100)} />
    <Text variant="label" weight="regular" tone="textSecondary" style={{ minWidth: space.xl + space.md }} align="right"
      onPress={reset === undefined ? undefined : () => onChange(reset)}>{`${Math.round(value * 100)}%`}</Text>
  </View>;
}

function AppIconSection({ choices, current, choose }: ReturnType<typeof useAppIcons>) {
  if (choices.length < 2) return null;
  return <FormGroup title="App Icon" detail="Shown in the Dock and the app switcher. The Dock keeps it after you quit.">
    <View accessibilityRole="radiogroup" accessibilityLabel="App icon" style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm, rowGap: space.md, paddingVertical: space.md }}>
      {choices.map(icon => <PreviewTile key={icon.id} title={icon.name} selected={icon.id === current} onPress={() => choose(icon.id)}>
        <Image source={{ uri: icon.preview }} style={{ width: geometry.appIcon, height: geometry.appIcon }} />
      </PreviewTile>)}
    </View>
  </FormGroup>;
}


/** The gradient over the window: the space showing's own, as Arc and Zen colour each space; Appearance's in a window without spaces. */
function WorkspaceColourEditor() {
  const actions = useActions();
  const { appearance } = useSnapshot();
  const fallback = useShellPrefs(p => p.workspaceTheme);
  const { active } = useSpaces();
  return <FormGroup title={active ? `${active.name} gradient` : 'Window gradient'}>
    <View style={{ paddingVertical: space.md }}><ThemeEditor accent={appearance.accent} theme={active ? active.theme ?? fallback : fallback}
      onAccent={accent => { void actions.setAppearance({ accent }); }}
      onTheme={value => { if (active) actions.spaces.setSpaceTheme(active.id, value); else void setShellPref('workspaceTheme', value); }} /></View>
  </FormGroup>;
}
