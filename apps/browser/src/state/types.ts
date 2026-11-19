// Browser types for components, which never import the platform layer.
export type {
  Appearance, BookmarkItem, BookmarkView, ClearDataType, CommandPalette, ConfigFile, Download, DownloadAction, ExtensionInfo,
  ExtensionPopup, FindState, GroupColor, Peek, TabGroup, HistoryItem, HistoryPage, NavigationHistory, Preferences, PreferenceKey, Prompt, Request,
  Requests, Security, Snapshot, Split, Suggestion, Tab, TabSwitcher, Workspace,
} from '../platform/protocol';
export type { AnchorName, BrowserState, GroupDialog, HoverCard, Hud, Omnibox, Panel, PopoverName, Rect, SearchOwner, Toast } from './store';
export type { Overlays } from './surfaces';
export type { DropOutcome, DropTarget, SplitSide, TabDrag, ZoneStage } from './tabDrag';
