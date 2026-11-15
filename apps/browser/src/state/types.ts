// Browser types for components, which never import the platform layer.
export type {
  Appearance, BookmarkItem, BookmarkView, CommandPalette, ConfigFile, Download, DownloadAction, ExtensionInfo,
  ExtensionPopup, FindState, GroupColor, Peek, TabGroup, HistoryItem, HistoryPage, Preferences, PreferenceKey, ProfileInfo, Prompt, Request,
  Requests, Snapshot, Split, Suggestion, Tab, TabSwitcher, Workspace,
} from '../platform/protocol';
export type { AnchorName, BrowserState, GroupDialog, Omnibox, Panel, PopoverName, Rect, SearchOwner, Toast } from './store';
export type { Overlays } from './surfaces';
export type { TabDrag, TabDropZone } from './tabDrag';
