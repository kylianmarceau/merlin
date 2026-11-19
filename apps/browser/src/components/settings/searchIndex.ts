// What Settings' search finds: every setting by its row title, the section
// it lives in, and other words people use for it. searchIndex.test.ts checks
// that each title is still a row in the panes, so the index can't drift.

export type SettingsHit = { section: string; title: string; words?: string };

export const settingsIndex: readonly SettingsHit[] = [
  { section: 'appearance', title: 'Appearance Theme', words: 'dark light mode colour scheme' },
  { section: 'appearance', title: 'Workspace colour', words: 'sage ocean ember tint accent' },
  { section: 'appearance', title: 'Reduce motion', words: 'animation accessibility' },
  { section: 'appearance', title: 'Interface Style', words: 'glass classic liquid' },
  { section: 'appearance', title: 'Transparency', words: 'glass clear frosted' },
  { section: 'appearance', title: 'Tint glass with the workspace colour' },
  { section: 'appearance', title: 'Address Bar', words: 'url omnibox toolbar sidebar' },
  { section: 'appearance', title: '⌘L opens the command bar', words: 'command l centre location' },
  { section: 'appearance', title: 'Compact toolbar' },
  { section: 'appearance', title: 'Tab position', words: 'sidebar top vertical horizontal layout' },
  { section: 'appearance', title: 'Site colour', words: 'theme color toolbar tint' },
  { section: 'appearance', title: 'Tint the window with the site colour' },
  { section: 'appearance', title: 'Open new tabs as a pop-up', words: 'new tab popup' },
  { section: 'appearance', title: 'New tabs open', words: 'position top end' },
  { section: 'appearance', title: 'Default page zoom', words: 'zoom size scale' },
  { section: 'appearance', title: 'Show bookmarks', words: 'favourites star' },
  { section: 'appearance', title: 'Bookmarks bar' },
  { section: 'appearance', title: 'Bookmarks in the sidebar' },
  { section: 'appearance', title: 'Borderless mode', words: 'frame edge' },
  { section: 'appearance', title: 'Frame around the page', words: 'border padding inset' },
  { section: 'appearance', title: 'Zero in full screen' },
  { section: 'appearance', title: 'Glow around the selected tab', words: 'shadow' },
  { section: 'appearance', title: 'Scroll bars', words: 'scrollbars thin overlay' },
  { section: 'appearance', title: 'App Icon', words: 'dock' },
  { section: 'general', title: 'Open Merlin at login', words: 'startup' },
  { section: 'general', title: 'Warn before quitting', words: 'command q' },
  { section: 'general', title: 'Warn before closing a window with multiple tabs' },
  { section: 'general', title: 'Control-Tab switches', words: 'ctrl tab recent order' },
  { section: 'general', title: 'Float videos when you switch tabs', words: 'picture in picture pip' },
  { section: 'general', title: 'Windows and tabs', words: 'restore session reopen quit' },
  { section: 'general', title: 'When input looks like a website', words: 'command bar search' },
  { section: 'general', title: 'Search engine', words: 'google duckduckgo kagi default' },
  { section: 'general', title: 'Downloads folder', words: 'save location' },
  { section: 'general', title: 'Ask where to save each file', words: 'download' },
  { section: 'general', title: 'Check for updates automatically', words: 'update' },
  { section: 'general', title: 'Update channel', words: 'beta stable' },
  { section: 'general', title: 'Import from another browser', words: 'chrome safari firefox' },
  { section: 'general', title: 'Export bookmarks', words: 'html' },
  { section: 'general', title: 'Open protected video sites in WebKit', words: 'netflix drm safari' },
  { section: 'general', title: 'Allow browserctl', words: 'command line cli socket' },
  { section: 'privacy', title: 'Offer to save passwords', words: 'passwords keychain' },
  { section: 'privacy', title: 'Clear browsing data', words: 'history cookies cache delete' },
  { section: 'blocking', title: 'Block ads and trackers', words: 'ad blocker adblock' },
  { section: 'blocking', title: 'Update filter lists automatically', words: 'easylist' },
  { section: 'performance', title: 'Memory Saver', words: 'sleep tabs discard' },
  { section: 'performance', title: 'Energy Saver', words: 'battery' },
  { section: 'keys', title: 'Modal browsing', words: 'vim keyboard keys bindings' },
];

/** The settings that match every word typed, best first: title matches before ones found only in the other words. */
export function searchSettings(query: string, index: readonly SettingsHit[] = settingsIndex): SettingsHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = index.map(hit => {
    const title = hit.title.toLowerCase();
    const all = `${title} ${hit.words ?? ''} ${hit.section}`;
    if (!words.every(w => all.includes(w))) return null;
    const inTitle = words.filter(w => title.includes(w)).length;
    return { hit, score: inTitle * 2 + (title.startsWith(words[0]) ? 1 : 0) };
  }).filter((x): x is { hit: SettingsHit; score: number } => !!x);
  return scored.sort((a, b) => b.score - a.score).map(x => x.hit);
}
