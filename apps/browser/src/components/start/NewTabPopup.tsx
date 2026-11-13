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
export function NewTabPopup({ open }: { open: boolean }) {
  const actions = useActions();
  if (!open) return null;
  const close = () => { actions.stopSuggesting(); actions.closePanel(); };
  return <CenteredPopup label="New tab" onDismiss={close}><Body onClose={close} /></CenteredPopup>;
}

function Body({ onClose }: { onClose(): void }) {
  const { colors } = useTheme();
  const actions = useActions();
  const snapshot = useSnapshot();
  const focusRequest = useBrowser(s => s.addressFocus);
  const search = useSearch();
  const [picked, setPicked] = useState(0);
  const pages = snapshot.tabs.filter(t => t.id !== snapshot.activeTabId && !isStartUrl(t.url)).slice(0, 6);
  const count = search.typing ? search.suggestions.length : pages.length;

  const openPage = (tab: Tab) => { onClose(); void actions.activateTab(tab.id); };
  const submit = () => {
    if (!search.typing) { if (pages[picked]) openPage(pages[picked]); return; }
    // Each request reads the current suggestions, so it goes before they are cleared.
    search.submit(true);
    actions.closePanel();
  };
  const move = (step: 1 | -1) => {
    if (search.typing) search.move(step);
    else if (count) setPicked(p => (p + step + count) % count);
  };

  return <>
    <PopupField value={search.text} label="Search or enter an address" placeholder="Search or enter an address"
      focusRequest={focusRequest} onChangeText={search.change} onSubmit={submit} onEscape={onClose}
      onKey={key => { if (key === 'down') move(1); else if (key === 'up') move(-1); }}
      trailing={<View style={{ paddingHorizontal: space.xs + space.hair, paddingVertical: space.hair, borderRadius: radius.sm,
        backgroundColor: colors.fillControl }}>
        <Text variant="caption" weight="semibold" tone="textSecondary">New tab</Text>
      </View>} />
    {count > 0 && <View style={{ padding: space.sm, gap: space.hair }}>
      {search.typing
        ? search.suggestions.map((item, index) => <PopupRow key={`${index}:${item.url}`} title={item.title || item.url}
          detail={suggestionDetail(item, displayHost(item.url))}
          leading={<Icon name={suggestionIcons[item.kind]} tone={search.selected === index ? 'paletteSelectedText' : 'iconSecondary'} size="small" />}
          selected={search.selected === index}
          onPress={() => { search.open(index, true); actions.closePanel(); }} />)
        : pages.map((tab, index) => <PopupRow key={tab.id} title={tab.title || tab.url} detail="Switch to tab"
          leading={<Favicon tab={tab} />} selected={picked === index} onPress={() => openPage(tab)} />)}
    </View>}
    <PopupFooter />
  </>;
}
