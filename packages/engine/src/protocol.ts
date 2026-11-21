import {
  appearanceAccents, appearanceModes, groupColors, panels, protections, securities,
  type AppearanceAccent, type AppearanceMode, type BooleanOption, type CallMethod, type ClearDataType, type DownloadAction, type GroupColor,
  type MediaAction, type PaletteKey, type Panel, type PreferenceKey, type Protection, type RequestMethod, type Security, type ShellReport, type SplitSide, type StringOption,
} from './vocabulary';
// Method names and argument values come from merlin_shell_vocabulary.json, shared with native code.
export * from './vocabulary';

/** Browser-owned state. IDs are opaque and scoped to a native session. */
export type Tab = {
  id: string; title: string; url: string; loading: boolean; pinned: boolean;
  /**
   * The address as the field shows it while not editing, formatted by
   * Chromium as its own omnibox does: no user name or password, no scheme,
   * spoofable hosts left in punycode. Show this, never a reading of `url`.
   * Absent from older engines and on WebKit tabs.
   */
  displayUrl?: string;
  /** The leading part of `displayUrl` that names the site; empty when it has none. */
  displayHost?: string;
  /** The page's security from Chromium's security state, not the scheme. Absent from older engines and on WebKit tabs. */
  security?: Security;
  audible: boolean; canGoBack: boolean; canGoForward: boolean;
  /** Its sound is muted (tabs.mute). Absent from older engines. */
  muted?: boolean;
  /**
   * Media the page plays that can be paused and resumed from outside it,
   * from Chromium's media session: what the sidebar's player shows and
   * tabs.media controls. Absent when it has none, and from older engines.
   */
  media?: TabMedia;
  /** The page's zoom, in percent, and whether that is the default zoom. Absent from older engines. */
  zoom?: { percent: number; default: boolean };
  /** The page it shows (WebKit's, on a WebKit tab) is bookmarked. Absent from older engines. */
  bookmarked?: boolean;
  /** Memory Saver put it to sleep; it reloads when shown. Absent from older engines. */
  discarded?: boolean;
  /** Changes when the page's icon does; empty when it has none. Fetch with favicons.get. */
  favicon?: string;
  /** The page's renderer has gone; the shell shows a reload view instead. */
  crashed?: boolean;
  /**
   * The shell shows its start page: on a new tab, and after a search typed
   * there until the new page has drawn something. Absent from older engines.
   */
  start?: boolean;
  /** The site's colour as "#RRGGBB": its theme-color, else its icon's main colour. Absent when it has neither. */
  color?: string;
  /** The colour most of the page's top edge has, as drawn, as "#RRGGBB". Absent until sampled, or when it has none. */
  surface?: string;
  /** The ID of the tab group it is in (one of the snapshot's `groups`). Absent when ungrouped. */
  group?: string;
  /**
   * The ID of the split view it is in, shared with the tab beside it (which
   * is next to it in `tabs`). Absent when it isn't in one, and from older engines.
   */
  split?: string;
  /**
   * Never sent by Chromium: the shell sets it on tabs it shows in WebKit,
   * whose title, address and state then come from WebKit's page.
   */
  engine?: 'webkit';
  /**
   * Never sent by Chromium: the name the user gave the tab (Rename Tab),
   * which the shell shows in place of the page's title. The page's own
   * title is then in `title` still.
   */
  name?: string;
  /** Never sent by Chromium: the SF Symbol the user chose to show in place of the page's icon (Change Icon). */
  symbol?: string;
  /**
   * The WebKit page the tab showed when Merlin last quit, restored with the
   * session: the shell shows it in WebKit again (or, if its site now opens in
   * Chromium, loads it there). Absent once claimed, and from older engines.
   */
  restoreInWebKit?: { url: string; title: string };
  /**
   * On a tab shown in WebKit: Chromium's latest navigation behind it was
   * started by the browser for the person, not by its page, so it shows in
   * the engine its address opens in. Absent otherwise, and from older engines.
   */
  userInitiated?: boolean;
};
export type Download = {
  id: string; name: string; received: number; total: number;
  state: 'progress' | 'complete' | 'cancelled' | 'interrupted';
  /** Merlin's finer state: progress, paused, done, failed, cancelled, removed or dangerous. */
  status?: string; detail?: string; url?: string;
  /** The finished file on disk, for dragging it out of the shell. Absent until done, or once it is gone. */
  path?: string;
};
/** A tab group: its tabs are next to each other in the strip, and say so with `group`. */
export type TabGroup = { id: string; title: string; color: GroupColor; collapsed: boolean };
/** A link opened in a floating card over the page. Its page is shown with tab ID "peek". */
export type Peek = { url: string; title: string; loading: boolean; canGoBack: boolean };
export type Split = { tabs: string[]; layout: 'sideBySide' | 'stacked'; ratio: number };
export type Prompt = {
  id: string; origin: string; title: string; message: string; quiet?: boolean; canSuppress?: boolean; input?: { label: string; defaultValue: string };
  /** A sign-in's password field. What is typed goes only with the answer (`secret`), never as a draft. */
  secret?: { label: string };
  /** The site asked again straight after a sign-in was sent: it refused it. */
  failed?: boolean;
  kind: 'permission' | 'confirm' | 'alert' | 'beforeUnload' | 'signIn';
  /** Where it appears: beside the address ("site"), over the page ("page") or in the window centre. */
  anchor?: PromptAnchor;
  /** Site information only: the connection's security. */
  security?: Security;
  /** Site information only: what ad blocking does on this page. */
  protection?: Protection;
  actions: { id: string; label: string; emphasis: 'normal' | 'primary' | 'danger' }[];
};
export type PromptAnchor = 'site' | 'page' | 'window';
/** The window's open extension popup. Its page is shown with tab ID "extension-popup". */
export type ExtensionPopup = { extensionId: string; name: string; width: number; height: number; ready: boolean };
export type Suggestion = { kind: 'search' | 'url' | 'tab'; title: string; detail: string; url: string; completion: string; default: boolean };
export type Favicon = { key: string; url: string };
export type Appearance = { mode: AppearanceMode; accent: AppearanceAccent; reduceMotion: boolean };
export type CommandPalette = {
  visible: boolean; prompt: string; placeholder: string; text: string; selected: number;
  error: string; status: string;
  rows: { title: string; detail: string; keys: string; indent: number; active: boolean }[];
};
export type Hint = { label: string; x: number; y: number };
/** A key that can follow what has been typed so far, and what it does. */
export type WhichKey = { keys: string; description: string };
/** Ctrl-Tab's cards while Control is held: the tabs in switching order and the highlighted one. */
export type TabSwitcher = { tabs: string[]; selected: number; recent: boolean };
export type FindState = { visible: boolean; text: string; matches: number; ordinal: number; focus: number };
export type Snapshot = {
  session: string; windowId: string; revision: number; private: boolean;
  /** A pop-up a page opened shows only its page and address. */
  kind?: 'normal' | 'popup';
  welcome?: '' | 'intro' | 'appearance';
  extensionPopup?: ExtensionPopup | null;
  tabs: Tab[]; activeTabId: string | null;
  /** The window's tab groups in strip order. Absent from older engines. */
  groups?: TabGroup[];
  peek?: Peek | null;
  /** Running downloads and the most recent others; `downloads.list` has them all. */
  downloads: Download[];
  prompt: Prompt | null; appearance: Appearance; find?: FindState; split?: Split | null;
  switcher?: TabSwitcher | null;
  /** The page asked for fullscreen (a video, a PDF, a game): it fills the window with no browser chrome. */
  fullscreen?: boolean;
  modal: {
    /** Config `modal_browsing`; off, every key goes to the page. */
    modalBrowsing?: boolean;
    /** Config `browserctl`: local programs may drive non-private windows over its socket. */
    browserctl?: boolean;
    mode: string; pending: string; message: string; messageIsError?: boolean; sidebarHidden?: boolean;
    tabLayout?: 'sidebar' | 'top'; whichKey?: WhichKey[]; palette?: CommandPalette | null; hints?: Hint[]; hintPrefix?: string;
  };
};
export type TabMedia = {
  playing: boolean;
  /** From the page's media session metadata; empty when it gives none. */
  title: string; artist: string;
  canNext: boolean; canPrevious: boolean;
};
export type Calls = {
  'window.snapshot': { args: {}; result: Snapshot };
  'find.query': { args: { tabId: string; text: string; forward: boolean }; result: null };
  'find.close': { args: {}; result: null };
  'find.focus': { args: { tabId: string; focused: boolean }; result: null };
  /** Gives the keyboard back to the active page, after a sheet that took it closes. */
  'page.focus': { args: {}; result: null };
  'tabs.create': { args: { url?: string }; result: null };
  'tabs.activate': { args: { tabId: string }; result: null };
  'tabs.close': { args: { tabId: string }; result: null };
  'tabs.pin': { args: { tabId: string; pinned: boolean }; result: null };
  /** Saves the page into the Bookmarks Bar folder, or with `bookmarked` false removes its bookmarks; without it, toggles. */
  'tabs.bookmark': { args: { tabId: string; bookmarked?: boolean }; result: null };
  'tabs.mute': { args: { tabId: string; muted: boolean }; result: null };
  /** Plays, pauses or skips the tab's media (its `media`), as the page's own controls would. */
  'tabs.media': { args: { tabId: string; action: MediaAction }; result: null };
  /** Moves the tab before `beforeId` (null: the end). A tab in a split view moves with the tab beside it. */
  'tabs.move': { args: { tabId: string; beforeId: string | null }; result: null };
  /** Adds the tab to a group, or to a new one (titled `title`) when `groupId` is null. Pinned tabs aren't grouped. */
  'tabs.group': { args: { tabId: string; groupId: string | null; title?: string }; result: null };
  'tabs.ungroup': { args: { tabId: string }; result: null };
  /** Collapsing the group holding the active tab first moves to the nearest tab outside it. */
  'groups.update': { args: { groupId: string; title?: string; color?: GroupColor; collapsed?: boolean }; result: null };
  /** Takes every tab out of the group. */
  'groups.ungroup': { args: { groupId: string }; result: null };
  /** Closes every tab in the group. */
  'groups.close': { args: { groupId: string }; result: null };
  'peek.close': { args: {}; result: null };
  /** Moves the peeked page into a new tab beside the active one. */
  'peek.promote': { args: {}; result: null };
  /**
   * Shows `tabId` beside `beside` (the active tab when absent) in a split
   * view, on the given side, and focuses it; a split either tab was already
   * in is replaced.
   */
  'tabs.split': { args: { tabId: string; side: SplitSide; beside?: string }; result: null };
  /** Ends the split view the tab is in; both tabs stay open. */
  'tabs.unsplit': { args: { tabId: string }; result: null };
  /** Moves the tab into a new window of its own, under the pointer. */
  'tabs.detach': { args: { tabId: string }; result: null };
  'navigation.open': { args: { tabId: string; text: string }; result: null };
  'navigation.back': { args: { tabId: string }; result: null };
  'navigation.forward': { args: { tabId: string }; result: null };
  'navigation.reload': { args: { tabId: string }; result: null };
  'navigation.stop': { args: { tabId: string }; result: null };
  /** The tab's back and forward list, for Back and Forward's menus. */
  'navigation.history': { args: { tabId: string }; result: NavigationHistory };
  /** Goes to entry `index` of navigation.history's list. */
  'navigation.go': { args: { tabId: string; index: number }; result: null };
  'downloads.open': { args: { downloadId: string }; result: null };
  'downloads.cancel': { args: { downloadId: string }; result: null };
  'downloads.act': { args: { downloadId: string; action: DownloadAction }; result: null };
  'downloads.openFolder': { args: {}; result: null };
  'permissions.answer': { args: { promptId: string; actionId: string; text?: string; secret?: string; suppress?: boolean }; result: null };
  'prompts.update': { args: { promptId: string; text: string }; result: null };
  'appearance.set': { args: Appearance; result: null };
  'welcome.advance': { args: { next: 'appearance' | 'tutorial' | 'browse' | 'import' }; result: null };
  'modal.command': { args: { text: string }; result: null };
  'modal.palette.text': { args: { text: string }; result: null };
  'modal.palette.key': { args: { key: PaletteKey }; result: null };
  'modal.palette.select': { args: { index: number; revision: number }; result: null };
  'favicons.get': { args: { tabId: string }; result: Favicon | null };
  /** The tab's last thumbnail as a JPEG data URL, or null before it has one. */
  'tabs.thumbnail': { args: { tabId: string }; result: string | null };
  'switcher.choose': { args: { index: number }; result: null };
  'switcher.cancel': { args: {}; result: null };
  'omnibox.query': { args: { queryId: string; text: string; preventInline: boolean }; result: null };
  'omnibox.stop': { args: {}; result: null };
  /** Opens row `index` of query `queryId`'s results, only if that row is still `url`. */
  'omnibox.open': { args: { queryId: string; index: number; url: string; newTab: boolean }; result: null };
  'omnibox.enter': { args: { queryId?: string; text: string; newTab: boolean }; result: null };
  'extensions.closePopup': { args: {}; result: null };
  'site.info': { args: {}; result: null };
  /**
   * The shell shows the tab in WebKit at this address and title, or (null)
   * Chromium's page again. Native code then bookmarks, saves, lists and
   * restores that page, not the hidden one.
   */
  'tabs.setEngineOverlay': { args: { tabId: string; overlay: { engine: 'webkit'; url: string; title: string } | null }; result: null };
  /** The window's interface showed its first snapshot, or its error boundary caught a failure (logged by Chromium). */
  'shell.report': { args: { state: ShellReport; message?: string; stack?: string }; result: null };
  /** "Reload Interface": Chromium gives the window a new React root; its tabs carry on. */
  'shell.reloadWindow': { args: {}; result: null };
};
export type Method = keyof Calls;

/** Data Chromium produces on demand; answered by a `reply` event. */
export type ExtensionInfo = { id: string; name: string; version: string; enabled: boolean; canToggle: boolean; hasAction?: boolean; actionTitle?: string };
export type Adblock = {
  available: boolean; enabled: boolean; automatic: boolean; private: boolean; status: string; updateStatus: string;
  /** Seconds since the Unix epoch; 0 before the first successful update. */
  lastUpdate: number; groups: string[]; exceptions: string[];
};
export type Preferences = {
  theme: number; tabs: 'side' | 'top'; ctrlTab: 'recent' | 'order';
  bindings: { keys: string; command: string; desc: string }[]; hintChars: string;
  engines: { id: string; name: string }[]; engine: string; engineManaged: boolean;
  startup: 'last' | 'start'; zoom: number; zoomChoices: number[];
  downloadDir: string; askWhere: boolean; memorySaver: boolean; energySaver: boolean; savePasswords: boolean;
  /** Video playing with sound floats when its tab is left. Absent from older engines. */
  autoPip?: boolean;
  extensions: ExtensionInfo[]; adblock: Adblock; about: { version: string; os: string };
};
/** `revision` names this version of the file; saving the whole file sends it back. */
export type ConfigFile = { found: boolean; text: string; error: string; path: string; revision: string };
/** A save's outcome: an empty `error` and the file's new revision, or what went wrong. */
export type ConfigSave = { error: string; revision: string };
export type Workspace = { name: string; modified: number };
export type HistoryItem = { url: string; title: string; domain: string; time: number };
export type HistoryPage = { items: HistoryItem[]; done: boolean };
export type NavigationHistory = { current: number; entries: { index: number; title: string; url: string }[] };
export type BookmarkItem = { id: string; title: string; folder: boolean; editable: boolean; count?: number; url?: string; domain?: string; where?: string };
export type BookmarkView = { path: { id: string; title: string }[]; items: BookmarkItem[]; folderId: string };
export type Requests = {
  'settings.get': { args: {}; result: Preferences };
  'settings.set': { args: { key: PreferenceKey; value: unknown }; result: Preferences };
  'settings.chooseDownloadDir': { args: {}; result: string };
  'settings.config': { args: {}; result: ConfigFile };
  /** Saves the whole file, only if it is still at `revision`; a change made since is never overwritten. */
  'settings.saveConfig': { args: { text: string; revision: string }; result: ConfigSave };
  /** Writes one [options] value into the config file; the reply is an error, empty when it saved. */
  'settings.setOption': { args: { name: BooleanOption; value: boolean } | { name: StringOption; value: string }; result: string };
  'settings.workspaces': { args: {}; result: Workspace[] };
  'settings.deleteWorkspace': { args: { name: string }; result: Workspace[] };
  'settings.openPage': { args: { key: string }; result: null };
  'history.search': { args: { text: string; before?: number }; result: HistoryPage };
  'history.remove': { args: { urls: string[] }; result: null };
  'bookmarks.folder': { args: { folderId?: string }; result: BookmarkView };
  'bookmarks.search': { args: { text: string }; result: BookmarkView };
  'bookmarks.edit': { args: { id: string; title: string; url?: string }; result: null };
  'bookmarks.remove': { args: { id: string }; result: null };
  /** Writes every bookmark to `path` as a bookmarks.html file. */
  'bookmarks.export': { args: { path: string }; result: null };
  'bookmarks.createFolder': { args: { parentId: string; title: string }; result: null };
  'bookmarks.move': { args: { id: string; parentId: string; index: number }; result: null };
  /** A page's icon from the history (bookmarks, history rows) as a PNG data URL, or null. */
  'favicons.page': { args: { url: string }; result: string | null };
  'extensions.list': { args: {}; result: ExtensionInfo[] };
  'extensions.setEnabled': { args: { id: string; enabled: boolean }; result: null };
  'extensions.run': { args: { id: string }; result: null };
  'extensions.manage': { args: { id?: string }; result: null };
  'downloads.list': { args: {}; result: Download[] };
  /**
   * Clears Chromium's data and WebKit pages' together, with one result: an
   * error says what failed. `since` is seconds since the Unix epoch (0: all
   * time). `site`, a host, limits it to that site's cookies, site data and
   * cache, for all time; history can't be cleared per site.
   */
  'privacy.clearData': { args: { since: number; types: ClearDataType[]; site?: string }; result: null };
};
export type Request = keyof Requests;
export type PanelName = Panel;

// Fails to compile when Calls or Requests and merlin_shell_vocabulary.json list different methods.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type CallsMatchVocabulary = Assert<Same<Method, CallMethod>>;
export type RequestsMatchVocabulary = Assert<Same<Request, RequestMethod>>;

export type EngineEvent = { type: 'snapshot'; snapshot: Snapshot } | { type: 'address.focus' | 'address.revert' | 'command.open'; windowId: string }
  | { type: 'engine.error'; windowId: string; message: string }
  | { type: 'panel.open'; windowId: string; panel: PanelName }
  | { type: 'reply'; windowId: string; requestId: string; ok: boolean; value?: unknown; error?: string }
  | { type: 'omnibox.results'; windowId: string; queryId: string; items: Suggestion[] }
  /**
   * A two-finger swipe back or forward over the page, which the shell draws
   * in place of Chromium's overlay: how far it has gone (0 to 1, more past
   * its end), whether letting go would navigate, and whether it has ended.
   */
  | HistorySwipe
  /** Tests only (native code sends it only to a test instance): fail while drawing, or from a timer outside React. */
  | { type: 'test.throw'; windowId: string; where: 'render' | 'timer' };

export type HistorySwipe = { type: 'history.swipe'; windowId: string; direction: 'back' | 'forward'; progress: number; ready: boolean; ended: boolean };

export function parseEngineEvent(json: string): EngineEvent {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('Invalid engine event');
  if (value.type === 'snapshot' && 'snapshot' in value) {
    const snapshot = value.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || !('windowId' in snapshot) || typeof snapshot.windowId !== 'string')
      throw new Error('Missing event window');
    return { type: 'snapshot', snapshot: validateSnapshot(snapshot, snapshot.windowId) };
  }
  if ((value.type === 'address.focus' || value.type === 'address.revert' || value.type === 'command.open') && 'windowId' in value && typeof value.windowId === 'string')
    return { type: value.type, windowId: value.windowId };
  const v = value as Record<string, unknown>;
  if (v.type === 'panel.open' && typeof v.windowId === 'string' && panels.includes(v.panel as PanelName))
    return { type: 'panel.open', windowId: v.windowId, panel: v.panel as PanelName };
  if (v.type === 'reply' && typeof v.windowId === 'string' && typeof v.requestId === 'string' && typeof v.ok === 'boolean' &&
      (v.error === undefined || typeof v.error === 'string'))
    return { type: 'reply', windowId: v.windowId, requestId: v.requestId, ok: v.ok, value: v.value, error: v.error as string | undefined };
  if (v.type === 'omnibox.results' && typeof v.windowId === 'string' && typeof v.queryId === 'string' && listOf(suggestion)(v.items))
    return { type: 'omnibox.results', windowId: v.windowId, queryId: v.queryId, items: v.items as Suggestion[] };
  if (v.type === 'history.swipe' && typeof v.windowId === 'string' && (v.direction === 'back' || v.direction === 'forward') &&
      isNumber(v.progress) && isBool(v.ready) && isBool(v.ended))
    return { type: 'history.swipe', windowId: v.windowId, direction: v.direction, progress: v.progress, ready: v.ready, ended: v.ended };
  if (v.type === 'test.throw' && typeof v.windowId === 'string' && (v.where === 'render' || v.where === 'timer'))
    return { type: 'test.throw', windowId: v.windowId, where: v.where };
  throw new Error('Unknown engine event');
}
export interface Transport {
  call(windowId: string, method: string, args: string): Promise<string>;
  subscribe(listener: (event: EngineEvent) => void): () => void;
}

let requestCounter = 0;
export class EngineClient {
  constructor(readonly windowId: string, private readonly transport: Transport) {
    if (!windowId) throw new Error('The native host must supply a window ID');
  }
  async call<M extends Method>(method: M, args: Calls[M]['args']): Promise<Calls[M]['result']> {
    const raw = await this.transport.call(this.windowId, method, JSON.stringify(args));
    const reply: unknown = JSON.parse(raw);
    if (!reply || typeof reply !== 'object' || !('ok' in reply)) throw new Error('Invalid engine response');
    if (reply.ok !== true) {
      throw new Error('error' in reply && typeof reply.error === 'string' ? reply.error : 'Browser operation failed');
    }
    if (!('value' in reply)) throw new Error('Missing engine response value');
    if (method === 'window.snapshot') return validateSnapshot(reply.value, this.windowId) as Calls[M]['result'];
    if (method === 'favicons.get') {
      if (reply.value !== null && !fields(reply.value, { key: isString, url: v => isString(v) && v.startsWith('data:image/png;base64,') }))
        throw new Error('Invalid icon from the browser');
      return reply.value as Calls[M]['result'];
    }
    if (method === 'navigation.history') {
      const v = reply.value as NavigationHistory;
      if (!v || !Number.isSafeInteger(v.current) || !Array.isArray(v.entries) ||
          v.entries.some(e => !fields(e, { index: n => Number.isSafeInteger(n), title: isString, url: isString })))
        throw new Error('Invalid history from the browser');
      return v as Calls[M]['result'];
    }
    if (method === 'tabs.thumbnail') {
      if (reply.value !== null && !(isString(reply.value) && reply.value.startsWith('data:image/jpeg;base64,')))
        throw new Error('Invalid thumbnail from the browser');
      return reply.value as Calls[M]['result'];
    }
    if (reply.value !== null) throw new Error('Invalid command acknowledgement');
    return null as Calls[M]['result'];
  }
  /**
   * Asks Chromium for data it produces on demand. The acknowledgement and the
   * reply are separate, so the subscription is made before the call.
   */
  request<R extends Request>(method: R, args: Requests[R]['args'], timeoutMs = 30_000): Promise<Requests[R]['result']> {
    const requestId = `r${Date.now().toString(36)}-${(++requestCounter).toString(36)}`;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); unsubscribe(); fn(); };
      const unsubscribe = this.transport.subscribe(event => {
        if (event.type !== 'reply' || event.windowId !== this.windowId || event.requestId !== requestId) return;
        if (!event.ok) return finish(() => reject(new Error(event.error || 'Browser operation failed')));
        try { const value = validateResult(method, event.value); finish(() => resolve(value)); }
        catch (e) { finish(() => reject(e)); }
      });
      const timer = setTimeout(() => finish(() => reject(new Error('The browser did not answer in time'))), timeoutMs);
      this.transport.call(this.windowId, method, JSON.stringify({ ...args, requestId })).then(raw => {
        const reply: unknown = JSON.parse(raw);
        if (!reply || typeof reply !== 'object' || !('ok' in reply)) throw new Error('Invalid engine response');
        if (reply.ok !== true) throw new Error('error' in reply && typeof reply.error === 'string' ? reply.error : 'Browser operation failed');
      }).catch(e => finish(() => reject(e instanceof Error ? e : new Error(String(e)))));
    });
  }
  subscribe(listener: (event: EngineEvent) => void): () => void {
    return this.transport.subscribe(event => {
      const id = event.type === 'snapshot' ? event.snapshot.windowId : event.windowId;
      if (id === this.windowId && event.type !== 'reply') listener(event);
    });
  }
}

export function validateSnapshot(value: unknown, windowId: string): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid browser snapshot');
  const s = value as Snapshot;
  if (typeof s.session !== 'string' || !s.session || s.windowId !== windowId ||
      !Number.isSafeInteger(s.revision) || s.revision < 0 || typeof s.private !== 'boolean' ||
      !Array.isArray(s.tabs) || !Array.isArray(s.downloads) ||
      !s.appearance || !appearanceModes.includes(s.appearance.mode) ||
      !appearanceAccents.includes(s.appearance.accent) || typeof s.appearance.reduceMotion !== 'boolean' ||
      !s.modal || ![s.modal.mode, s.modal.pending, s.modal.message].every(x => typeof x === 'string')) {
    throw new Error('Invalid browser snapshot');
  }
  if (s.welcome !== undefined && !['', 'intro', 'appearance'].includes(s.welcome)) throw new Error('Invalid welcome stage');
  if (s.find !== undefined && (!s.find || typeof s.find.visible !== 'boolean' || typeof s.find.text !== 'string' ||
      ![s.find.matches, s.find.ordinal, s.find.focus].every(x => Number.isSafeInteger(x) && x >= 0))) throw new Error('Invalid find state');
  const palette = s.modal.palette;
  if (palette !== undefined && palette !== null && (
      typeof palette.visible !== 'boolean' || ![palette.prompt, palette.placeholder, palette.text, palette.error, palette.status].every(x => typeof x === 'string') ||
      !Number.isInteger(palette.selected) || !Array.isArray(palette.rows) || palette.selected < -1 || palette.selected >= palette.rows.length ||
      palette.rows.some(r => !r || ![r.title, r.detail, r.keys].every(x => typeof x === 'string') ||
        !Number.isSafeInteger(r.indent) || r.indent < 0 || typeof r.active !== 'boolean'))) throw new Error('Invalid command menu');
  if (s.modal.hints !== undefined && (!Array.isArray(s.modal.hints) || s.modal.hints.some(h =>
      !h || typeof h.label !== 'string' || !Number.isFinite(h.x) || !Number.isFinite(h.y)))) throw new Error('Invalid link hints');
  if (s.modal.hintPrefix !== undefined && typeof s.modal.hintPrefix !== 'string') throw new Error('Invalid hint prefix');
  if (s.fullscreen !== undefined && typeof s.fullscreen !== 'boolean') throw new Error('Invalid fullscreen state');
  if (s.modal.sidebarHidden !== undefined && typeof s.modal.sidebarHidden !== 'boolean') throw new Error('Invalid sidebar state');
  if (s.modal.modalBrowsing !== undefined && typeof s.modal.modalBrowsing !== 'boolean') throw new Error('Invalid modal browsing state');
  if (s.modal.browserctl !== undefined && typeof s.modal.browserctl !== 'boolean') throw new Error('Invalid browserctl state');
  if (s.modal.messageIsError !== undefined && typeof s.modal.messageIsError !== 'boolean') throw new Error('Invalid message state');
  if (s.modal.tabLayout !== undefined && s.modal.tabLayout !== 'sidebar' && s.modal.tabLayout !== 'top') throw new Error('Invalid tab layout');
  if (s.modal.whichKey !== undefined && (!Array.isArray(s.modal.whichKey) || s.modal.whichKey.some(k =>
      !k || typeof k.keys !== 'string' || typeof k.description !== 'string'))) throw new Error('Invalid key hints');
  const ids = new Set<string>();
  for (const tab of s.tabs) {
    if (!tab || typeof tab.id !== 'string' || !tab.id || ids.has(tab.id) ||
        typeof tab.title !== 'string' || typeof tab.url !== 'string' ||
        ![tab.loading, tab.pinned, tab.audible, tab.canGoBack, tab.canGoForward].every(x => typeof x === 'boolean') ||
        (tab.favicon !== undefined && typeof tab.favicon !== 'string') ||
        (tab.displayUrl !== undefined && typeof tab.displayUrl !== 'string') ||
        (tab.displayHost !== undefined && typeof tab.displayHost !== 'string') ||
        (tab.security !== undefined && !securities.includes(tab.security)) ||
        (tab.crashed !== undefined && typeof tab.crashed !== 'boolean') ||
        (tab.start !== undefined && typeof tab.start !== 'boolean') ||
        (tab.color !== undefined && (typeof tab.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(tab.color))) ||
        (tab.surface !== undefined && (typeof tab.surface !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(tab.surface))) ||
        (tab.group !== undefined && typeof tab.group !== 'string') ||
        (tab.split !== undefined && (typeof tab.split !== 'string' || !tab.split)) ||
        (tab.restoreInWebKit !== undefined && !fields(tab.restoreInWebKit, { url: isString, title: isString })) ||
        (tab.userInitiated !== undefined && typeof tab.userInitiated !== 'boolean') ||
        (tab.media !== undefined && !fields(tab.media, {
          playing: isBool, title: isString, artist: isString, canNext: isBool, canPrevious: isBool })) ||
        (tab.zoom !== undefined && !fields(tab.zoom, {
          percent: v => typeof v === 'number' && Number.isFinite(v) && v > 0, default: isBool })) ||
        [tab.muted, tab.bookmarked, tab.discarded].some(x => x !== undefined && typeof x !== 'boolean')) {
      throw new Error('Invalid tab snapshot');
    }
    ids.add(tab.id);
  }
  if (s.activeTabId !== null && !ids.has(s.activeTabId)) throw new Error('Active tab is missing');
  // A split's tabs sit together, and there are at least two of them.
  const splitAt = new Map<string, number[]>();
  s.tabs.forEach((t, i) => { if (t.split !== undefined) splitAt.set(t.split, [...(splitAt.get(t.split) ?? []), i]); });
  for (const at of splitAt.values())
    if (at.length < 2 || at.some((i, n) => n > 0 && i !== at[n - 1] + 1)) throw new Error('Invalid split view');
  if (s.groups !== undefined) {
    if (!Array.isArray(s.groups) || s.groups.some(g => !fields(g, {
        id: v => isString(v) && !!v, title: isString, color: v => groupColors.includes(v as GroupColor), collapsed: isBool })) ||
        new Set(s.groups.map(g => g.id)).size !== s.groups.length) throw new Error('Invalid tab groups');
    const groupIds = new Set(s.groups.map(g => g.id));
    if (s.tabs.some(t => t.group !== undefined && !groupIds.has(t.group))) throw new Error('Tab is in a missing group');
  }
  if (s.peek !== undefined && s.peek !== null && !fields(s.peek, {
      url: isString, title: isString, loading: isBool, canGoBack: isBool })) throw new Error('Invalid peek');
  if (!s.downloads.every(isDownload)) throw new Error('Invalid download snapshot');
  if (s.split !== undefined && s.split !== null && (typeof s.split !== 'object' || !Array.isArray(s.split.tabs) ||
      s.split.tabs.length < 2 || s.split.tabs.some(id => !ids.has(id)) || !['sideBySide', 'stacked'].includes(s.split.layout) ||
      !Number.isFinite(s.split.ratio) || (s.activeTabId !== null && !s.split.tabs.includes(s.activeTabId)))) throw new Error('Invalid split view');
  if (s.kind !== undefined && s.kind !== 'normal' && s.kind !== 'popup') throw new Error('Invalid window kind');
  if (s.switcher !== undefined && s.switcher !== null && (!fields(s.switcher, { tabs: listOf(isString), recent: isBool }) ||
      !Number.isInteger(s.switcher.selected) || s.switcher.selected < 0 || s.switcher.selected >= s.switcher.tabs.length ||
      s.switcher.tabs.some(id => !ids.has(id)))) throw new Error('Invalid tab switcher');
  if (s.extensionPopup !== undefined && s.extensionPopup !== null && !fields(s.extensionPopup, {
      extensionId: isString, name: isString, ready: isBool,
      width: v => isNumber(v) && v > 0 && v <= 4096, height: v => isNumber(v) && v > 0 && v <= 4096 })) throw new Error('Invalid extension popup');
  if (s.prompt !== null && (!s.prompt || typeof s.prompt.id !== 'string' || !s.prompt.id ||
      ![s.prompt.origin, s.prompt.title, s.prompt.message].every(x => typeof x === 'string') ||
      (s.prompt.quiet !== undefined && typeof s.prompt.quiet !== 'boolean') ||
      (s.prompt.canSuppress !== undefined && typeof s.prompt.canSuppress !== 'boolean') ||
      (s.prompt.input !== undefined && (!s.prompt.input || typeof s.prompt.input.label !== 'string' || typeof s.prompt.input.defaultValue !== 'string')) ||
      (s.prompt.secret !== undefined && !fields(s.prompt.secret, { label: isString })) ||
      (s.prompt.failed !== undefined && typeof s.prompt.failed !== 'boolean') ||
      !['permission', 'confirm', 'alert', 'beforeUnload', 'signIn'].includes(s.prompt.kind) ||
      (s.prompt.anchor !== undefined && !['site', 'page', 'window'].includes(s.prompt.anchor)) ||
      (s.prompt.security !== undefined && !securities.includes(s.prompt.security)) ||
      (s.prompt.protection !== undefined && !protections.includes(s.prompt.protection)) ||
      !Array.isArray(s.prompt.actions) || s.prompt.actions.length === 0 ||
      s.prompt.actions.some(a => !a || typeof a.id !== 'string' || !a.id || typeof a.label !== 'string' ||
        !['normal', 'primary', 'danger'].includes(a.emphasis)) ||
      new Set(s.prompt.actions.map(a => a.id)).size !== s.prompt.actions.length)) throw new Error('Invalid prompt snapshot');
  return s;
}

function isDownload(value: unknown): value is Download {
  const d = value as Download;
  return !!d && typeof d.id === 'string' && typeof d.name === 'string' &&
    Number.isFinite(d.received) && d.received >= 0 && Number.isFinite(d.total) && d.total >= 0 &&
    ['progress', 'complete', 'cancelled', 'interrupted'].includes(d.state) &&
    [d.status, d.detail, d.url, d.path].every(x => x === undefined || typeof x === 'string');
}
const isString = (x: unknown): x is string => typeof x === 'string';
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
function check(ok: boolean, what: string) { if (!ok) throw new Error(`Invalid ${what} from the browser`); }
const fields = (x: unknown, spec: Record<string, (v: unknown) => boolean>) =>
  isObject(x) && Object.entries(spec).every(([k, test]) => test(x[k]));
const optional = (test: (v: unknown) => boolean) => (v: unknown) => v === undefined || test(v);
const listOf = (test: (v: unknown) => boolean) => (v: unknown) => Array.isArray(v) && v.every(test);
const extension = (x: unknown) => fields(x, { id: isString, name: isString, version: isString, enabled: isBool, canToggle: isBool,
  hasAction: optional(isBool), actionTitle: optional(isString) });
const bookmarkView = (x: unknown) => fields(x, {
  path: listOf(c => fields(c, { id: isString, title: isString })), folderId: isString,
  items: listOf(i => fields(i, { id: isString, title: isString, folder: isBool, editable: isBool, count: optional(isNumber),
    url: optional(isString), domain: optional(isString), where: optional(isString) })) });
const suggestion = (x: unknown) => fields(x, { kind: v => v === 'search' || v === 'url' || v === 'tab', title: isString,
  detail: isString, url: isString, completion: isString, default: isBool });
const workspaces = listOf(w => fields(w, { name: isString, modified: isNumber }));

/** Rejects malformed replies before any component renders them. */
export function validateResult<R extends Request>(method: R, value: unknown): Requests[R]['result'] {
  switch (method) {
    case 'settings.get': case 'settings.set':
      check(fields(value, {
        theme: isNumber, tabs: v => v === 'side' || v === 'top', ctrlTab: v => v === 'recent' || v === 'order',
        bindings: listOf(b => fields(b, { keys: isString, command: isString, desc: isString })), hintChars: isString,
        engines: listOf(e => fields(e, { id: isString, name: isString })), engine: isString, engineManaged: isBool,
        startup: v => v === 'last' || v === 'start', zoom: isNumber, zoomChoices: listOf(isNumber),
        downloadDir: isString, askWhere: isBool, memorySaver: isBool, energySaver: isBool, savePasswords: isBool,
        autoPip: optional(isBool), extensions: listOf(extension), about: a => fields(a, { version: isString, os: isString }),
        adblock: a => fields(a, { available: isBool, enabled: isBool, automatic: isBool, private: isBool, status: isString,
          updateStatus: isString, lastUpdate: isNumber, groups: listOf(isString), exceptions: listOf(isString) }),
      }), 'settings'); break;
    case 'settings.chooseDownloadDir': case 'settings.setOption': check(isString(value), 'reply'); break;
    case 'settings.saveConfig': check(fields(value, { error: isString, revision: isString }), 'save'); break;
    case 'settings.config': check(fields(value, { found: isBool, text: isString, error: isString, path: isString, revision: isString }), 'configuration'); break;
    case 'settings.workspaces': case 'settings.deleteWorkspace': check(workspaces(value), 'workspaces'); break;
    case 'history.search': check(fields(value, { done: isBool,
      items: listOf(i => fields(i, { url: isString, title: isString, domain: isString, time: isNumber })) }), 'history'); break;
    case 'bookmarks.folder': case 'bookmarks.search': check(bookmarkView(value), 'bookmarks'); break;
    case 'extensions.list': check(listOf(extension)(value), 'extensions'); break;
    case 'downloads.list': check(listOf(isDownload)(value), 'downloads'); break;
    case 'favicons.page': check(value === null || (isString(value) && value.startsWith('data:image/png;base64,')), 'icon'); break;
    default: check(value === null || value === undefined, 'acknowledgement'); return null as Requests[R]['result'];
  }
  return value as Requests[R]['result'];
}
