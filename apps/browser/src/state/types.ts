// Browser types for components, which never import the platform layer.
export type {
  Appearance, BookmarkItem, BookmarkView, CommandPalette, ConfigFile, Download, DownloadAction, ExtensionInfo,
  ExtensionPopup, FindState, HistoryItem, HistoryPage, Preferences, PreferenceKey, ProfileInfo, Prompt, Request,
  Requests, Snapshot, Split, Suggestion, Tab, Workspace,
} from '../platform/protocol';
export type { AnchorName, BrowserState, Panel, PopoverName, Rect, Toast } from './store';
export type { Overlays } from './surfaces';
