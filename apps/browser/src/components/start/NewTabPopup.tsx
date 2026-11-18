import React, { useState } from 'react';
import { View } from 'react-native';
import { displayHost, isStartUrl } from '../../lib/format';
import type { Tab } from '../../state/types';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { CenteredPopup, Icon, PopupField, PopupFooter, PopupRow, Text, radius, space, useTheme } from '../ui';
import { Favicon } from '../favicon/Favicon';
import { suggestionDetail, suggestionIcons, useSearch } from '../omnibox/useSearch';

/**
 * A new tab as a pop-up (Settings > Appearance). Command-T shows it straight
 * over the current page: Chromium opens no tab until there is somewhere to
 * go. Before typing it offers the window's other pages; while typing,
 * Chromium's suggestions.
 */
export function NewTabPopup({ open, location = false }: { open: boolean; location?: boolean }) {
  const actions = useActions();
  if (!open) return null;
  const close = () => { actions.stopSuggesting(); actions.closePanel(); };
  return <CenteredPopup label={location ? 'Address' : 'New tab'} onDismiss={close}><Body onClose={close} location={location} /></CenteredPopup>;
}

/**
 * `location`: ⌘L with Settings › Appearance › ⌘L opens the command bar set to
 * In the centre. The same pop-up starts with the page's address, selected,
 * and goes wherever is chosen in the current tab.
 */
function Body({ onClose, location }: { onClose(): void; location: boolean }) {
  const { colors } = useTheme();
  const actions = useActions();
  const snapshot = useSnapshot();
  const focusRequest = useBrowser(s => s.addressFocus);
  const current = snapshot.tabs.find(t => t.id === snapshot.activeTabId);
  const search = useSearch(location && current && !isStartUrl(current.url) ? current.url : '');
  const [picked, setPicked] = useState(0);
  const pages = snapshot.tabs.filter(t => t.id !== snapshot.activeTabId && !isStartUrl(t.url)).slice(0, 6);
  const typing = search.typing && (!location || search.edited);
  const count = typing ? search.suggestions.length : pages.length;

  const openPage = (tab: Tab) => { onClose(); void actions.activateTab(tab.id); };
  const submit = () => {
    if (location && !search.edited) { onClose(); return; }
    if (!typing) { if (pages[picked]) openPage(pages[picked]); return; }
    // Each request reads the current suggestions, so it goes before they are cleared.
    search.submit(!location);
    actions.closePanel();
  };
  const move = (step: 1 | -1) => {
    if (typing) search.move(step);
    else if (count) setPicked(p => (p + step + count) % count);
  };

  return <>
    <PopupField value={search.text} label="Search or enter an address" placeholder="Search or enter an address"
      focusRequest={focusRequest} onChangeText={search.change} onSubmit={submit} onEscape={onClose} selectAll={location}
      onKey={key => { if (key === 'down') move(1); else if (key === 'up') move(-1); }}
      trailing={<View style={{ paddingHorizontal: space.xs + space.hair, paddingVertical: space.hair, borderRadius: radius.sm,
        backgroundColor: colors.fillControl }}>
        <Text variant="caption" weight="semibold" tone="textSecondary">{location ? 'This tab' : 'New tab'}</Text>
      </View>} />
    {count > 0 && <View style={{ padding: space.sm, gap: space.hair }}>
      {typing
        ? search.suggestions.map((item, index) => <PopupRow key={`${index}:${item.url}`} title={item.title || item.url}
          detail={suggestionDetail(item, displayHost(item.url))}
          leading={<Icon name={suggestionIcons[item.kind]} tone={search.selected === index ? 'paletteSelectedText' : 'iconSecondary'} size="small" />}
          selected={search.selected === index} disabled={search.stale}
          onPress={() => { search.open(index, !location); actions.closePanel(); }} />)
        : pages.map((tab, index) => <PopupRow key={tab.id} title={tab.title || tab.url} detail="Switch to tab"
          leading={<Favicon tab={tab} />} selected={picked === index} onPress={() => openPage(tab)} />)}
    </View>}
    <PopupFooter />
  </>;
}
