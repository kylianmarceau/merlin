//! C++ bridge for `modal_browser_core`.
//!
//! One `#[cxx::bridge]`, in its own namespace, as `//docs/rust/ffi.md`
//! recommends. The shape is deliberately one-directional: C++ calls into an
//! opaque Rust `Session` and gets plain data back (an `Outcome` with a list of
//! `Action`s, a `PaletteState` to render). Rust never calls into C++ and
//! never holds C++ pointers, so there is no shared mutable state and no
//! lifetime coupling across the boundary. Chromium objects (Browser,
//! WebContents) stay on the C++ side.
//!
//! Threading: a `Session` belongs to one browser window and must only be used
//! on the browser UI thread. The C++ owner enforces this with a sequence
//! checker.
//!
//! Strings: every `&str` parameter must be valid UTF-8. The C++ host passes
//! DOM key names from `ui::KeycodeConverter` and text converted with
//! `base::UTF16ToUTF8`, both of which always produce valid UTF-8.
//!
//! Enums arriving from C++ are range-checked: out-of-range values take the
//! safe interpretation (focus: browser UI; hint kind: not clickable; palette
//! key: cancel; mode: rejected).

#[cfg(feature = "chromium_gn")]
chromium::import! {
    "//components/modal_browser/core:modal_browser_core";
}

use modal_browser_core as core_api;

use core_api::document::utf16_to_char_offsets;
use core_api::ipc::{self, OpenPlace, Request as IpcCoreRequest, WorkspaceRequest};
use core_api::json::Value as JsonValue;
use core_api::{
    Action as CoreAction, BlockJump as CoreBlockJump, BlockKind as CoreBlockKind,
    BrowserPage as CoreBrowserPage, Disposition as CoreDisposition, Editable,
    FieldInfo as CoreFieldInfo, FieldKind as CoreFieldKind, FocusContext, FocusTarget,
    HintAction as CoreHintAction, HintKind as CoreHintKind, HintTargets as CoreHintTargets,
    ItemSource as CoreItemSource, Key, KeyDisposition as CoreKeyDisposition,
    ListItem as CoreListItem, MessageLevel as CoreMessageLevel, ModalSession, Mode as CoreMode,
    Modifiers as CoreModifiers, OpenTarget, Outcome as CoreOutcome, PageDocument,
    PaletteKey as CorePaletteKey, PaletteKind as CorePaletteKind, Scroll as CoreScroll,
    SelectUnit as CoreSelectUnit, SpanKind as CoreSpanKind, SplitLayout as CoreSplitLayout,
    Switch as CoreSwitch, TabEdge, TabInfo as CoreTabInfo, WindowTab as CoreWindowTab,
    YankKind as CoreYankKind,
};

#[cxx::bridge(namespace = "modal_browser::ffi")]
mod ffi {
    #[derive(Debug)]
    enum Mode {
        Normal,
        Insert,
        Visual,
        Command,
        Passthrough,
        Hint,
    }

    /// Where keyboard focus is when a key is pressed.
    #[derive(Debug)]
    enum FocusKind {
        /// Page has focus; the focused element is not editable.
        Page,
        /// `content::EditableLevel::kPlaintextEditable`.
        PlainTextField,
        /// `content::EditableLevel::kRichlyEditable`.
        RichTextField,
        /// Omnibox, command line, dialogs.
        BrowserUi,
    }

    #[derive(Debug)]
    struct FocusState {
        kind: FocusKind,
        ime_composing: bool,
    }

    #[derive(Debug)]
    struct Modifiers {
        shift: bool,
        ctrl: bool,
        alt: bool,
        /// Command on macOS.
        meta: bool,
    }

    #[derive(Debug)]
    enum KeyDisposition {
        Consumed,
        Forward,
    }

    #[derive(Debug)]
    enum ActionKind {
        OpenUrl,
        OpenSearch,
        NewTab,
        CloseTab,
        RestoreTab,
        NextTab,
        PreviousTab,
        FirstTab,
        LastTab,
        /// `id` is the tab handle.
        ActivateTab,
        Back,
        Forward,
        Reload,
        NavigateUp,
        NavigateRoot,
        Scroll,
        FocusAddressBar,
        FindInPage,
        FindNext,
        FindPrevious,
        Yank,
        /// Read the clipboard, then call `open_text` with `disposition`.
        OpenClipboard,
        /// Snapshot tabs into `set_tabs`, then render `palette_state`.
        OpenPalette,
        UpdatePalette,
        ClosePalette,
        BlurFocusedElement,
        /// Collect targets, then call `hints_collected(index, ...)`.
        CollectHints,
        ShowHints,
        FilterHints,
        HideHints,
        /// `index` is the target, `hint_action` what to do.
        ActivateHint,
        /// Read the config file, then call `load_config`.
        ReloadConfig,
        /// `setting`: tabs in a sidebar or on top.
        VerticalTabs,
        /// `setting`: expand or collapse the tab sidebar.
        TabSidebar,
        ShowMessage,
        /// `layout`; `target` says whether `text` is a URL, search or none.
        Split,
        SplitFocusOther,
        SplitSwap,
        Unsplit,
        /// `setting`
        PinTab,
        /// `flag`: private window.
        NewWindow,
        /// `name`, `flag` = quiet. Snapshot tabs, then `save_workspace`.
        SnapshotWorkspace,
        /// `name`, `text` = file contents, `detail` = success message.
        WriteWorkspace,
        /// `name`. Read the file, then `workspace_read`.
        ReadWorkspace,
        /// `name`
        DeleteWorkspace,
        /// `name`, `workspace_tabs`, `index` = active tab, `flag` = new window.
        RestoreWorkspace,
        /// `name`
        SwitchProfile,
        /// `source`. Fetch, then `set_items`.
        RequestItems,
        /// `page`
        ShowBrowserPage,
        /// `name` = a `:browser` action, `text` = its argument.
        BrowserCommand,
        ToggleDevTools,
        AddBookmark,
        /// `index` = generation. Extract, then `document_collected`.
        CollectDocument,
        /// `index` = element.
        RevealElement,
        /// `jump`, `flag` = forward, `count`.
        JumpToBlock,
        /// `text`, `detail` = what was copied.
        CopyText,
        /// `text`, `detail` = file extension, `argv`.
        OpenInEditor,
        /// `flag` = force. Describe the field, then `field_info`.
        InspectField,
        /// `argv`
        EditField,
        /// `flag` = forward, `unit`, `count`.
        ExtendSelection,
        ClearSelection,
        /// `name` = the letter. Read the scroll position, then
        /// `mark_recorded`.
        RecordMark,
        /// `name` = the letter, `text` = URL, `x`/`y`, `flag` = navigate if
        /// the page differs.
        GoToMark,
    }

    #[derive(Debug)]
    enum TargetKind {
        None,
        Url,
        Search,
    }

    #[derive(Debug)]
    enum SplitLayout {
        SideBySide,
        Stacked,
    }

    #[derive(Debug)]
    enum ItemSource {
        History,
        Bookmarks,
        Workspaces,
        Profiles,
        Downloads,
    }

    #[derive(Debug)]
    enum BrowserPage {
        History,
        Bookmarks,
        Downloads,
        Settings,
        Extensions,
        ReadingMode,
    }

    #[derive(Debug)]
    enum BlockJump {
        Heading,
        Code,
        Table,
        Paragraph,
        Link,
    }

    #[derive(Debug)]
    enum SelectUnit {
        Character,
        Word,
        Line,
        Sentence,
        Paragraph,
        Document,
    }

    #[derive(Debug)]
    enum HintTargets {
        Clickable,
        Code,
        Text,
    }

    #[derive(Debug)]
    enum OpenDisposition {
        CurrentTab,
        NewForegroundTab,
        NewBackgroundTab,
        NewWindow,
    }

    #[derive(Debug)]
    enum ScrollKind {
        None,
        Down,
        Up,
        Left,
        Right,
        Top,
        Bottom,
        HalfPageDown,
        HalfPageUp,
        PageDown,
        PageUp,
    }

    #[derive(Debug)]
    enum MessageLevel {
        Info,
        Error,
    }

    #[derive(Debug)]
    enum HintAction {
        Follow,
        OpenInNewTab,
        YankLink,
        FocusInput,
        EditInput,
        YankCode,
        Select,
    }

    #[derive(Debug)]
    enum HintKind {
        Link,
        Editable,
        Other,
        Code,
        Block,
    }

    #[derive(Debug)]
    enum YankKind {
        Url,
        Title,
        Markdown,
        Selection,
    }

    #[derive(Debug)]
    enum Switch {
        On,
        Off,
        Toggle,
    }

    #[derive(Debug)]
    enum PaletteKind {
        CommandLine,
        Tabs,
        Commands,
        History,
        Bookmarks,
        Workspaces,
        Profiles,
        Outline,
        Links,
        Menu,
        Downloads,
    }

    #[derive(Debug)]
    enum PaletteKey {
        Next,
        Previous,
        Up,
        Down,
        Accept,
        Cancel,
        /// Left arrow in the outline with an empty query.
        Collapse,
        /// Right arrow in the outline with an empty query.
        Expand,
    }

    #[derive(Debug)]
    enum BlockKind {
        Heading,
        Paragraph,
        ListItem,
        Code,
        Quote,
        TableRow,
        Rule,
    }

    #[derive(Debug)]
    enum SpanKind {
        Link,
        Code,
        Strong,
        Emphasis,
    }

    /// Inline markup in a block, in UTF-16 offsets as JavaScript reports.
    #[derive(Debug)]
    struct PageSpan {
        start: u32,
        end: u32,
        kind: SpanKind,
        href: String,
    }

    /// One block of a page's structure (see `modal_browser_core::document`).
    #[derive(Debug)]
    struct PageBlock {
        kind: BlockKind,
        level: u32,
        ordered: bool,
        header: bool,
        lang: String,
        text: String,
        /// Index into the host's element list; 0xFFFFFFFF for none.
        element: u32,
        spans: Vec<PageSpan>,
    }

    #[derive(Debug)]
    enum FieldKind {
        None,
        Input,
        TextArea,
        ContentEditable,
    }

    /// What the host knows about the focused field (no value).
    #[derive(Debug)]
    struct FieldInfo {
        kind: FieldKind,
        input_type: String,
        autocomplete: String,
        label: String,
        length: u32,
        read_only: bool,
    }

    /// One entry of a list the host fetched for a palette.
    #[derive(Debug)]
    struct ListItem {
        title: String,
        detail: String,
        value: String,
        /// Seconds since the Unix epoch, or 0.
        time: i64,
        current: bool,
    }

    /// One tab of this window, for saving a workspace.
    #[derive(Debug)]
    struct WindowTab {
        url: String,
        title: String,
        pinned: bool,
        active: bool,
        /// Tabs with the same value share a split; -1 when not split.
        split: i32,
        layout: SplitLayout,
    }

    /// One tab of a workspace being restored.
    #[derive(Debug)]
    struct WorkspaceTab {
        url: String,
        title: String,
        pinned: bool,
        /// Index of the tab this one is split with; -1 when not split.
        split_with: i32,
        layout: SplitLayout,
    }

    #[derive(Debug)]
    enum IpcKind {
        Invalid,
        Ping,
        Open,
        Tabs,
        Focus,
        Current,
        Selection,
        WorkspaceSave,
        WorkspaceOpen,
        WorkspaceDelete,
        WorkspaceList,
        /// `text` = the directory to find a workspace for.
        WorkspaceHere,
        Command,
    }

    /// A parsed `browserctl` request. `kind` is Invalid when `error` says
    /// why it was rejected.
    #[derive(Debug)]
    struct IpcRequest {
        kind: IpcKind,
        /// Correlation id, or -1.
        id: i64,
        /// URL or search (open), name (workspace), line (command).
        text: String,
        /// Tab number (focus).
        number: u32,
        disposition: OpenDisposition,
        error: String,
    }

    /// One tab in `browserctl` replies.
    #[derive(Debug)]
    struct IpcTab {
        window: u32,
        index: u32,
        id: i32,
        title: String,
        url: String,
        active: bool,
        pinned: bool,
    }

    #[derive(Debug)]
    struct HintLabel {
        /// Index into the host's collected targets.
        target: u32,
        label: String,
    }

    /// A flattened `modal_browser_core::Action`. Only the fields relevant to
    /// `kind` are meaningful; the rest hold defaults.
    #[derive(Debug)]
    struct Action {
        kind: ActionKind,
        /// URL, search terms, palette text, typed hint characters or message.
        text: String,
        count: u32,
        disposition: OpenDisposition,
        scroll: ScrollKind,
        /// Scroll: pixels per line step.
        step: u32,
        /// Scroll: animate page-sized jumps.
        smooth: bool,
        bypass_cache: bool,
        level: MessageLevel,
        /// Tab handle for ActivateTab.
        id: i32,
        /// Hint generation for CollectHints, target for ActivateHint.
        index: u32,
        hint_action: HintAction,
        yank: YankKind,
        palette: PaletteKind,
        setting: Switch,
        hints: Vec<HintLabel>,
        /// CollectHints: what to collect.
        hint_targets: HintTargets,
        /// Split: what `text` is.
        target: TargetKind,
        layout: SplitLayout,
        /// Workspace or profile name.
        name: String,
        /// Second text: success message, what was copied, file extension.
        detail: String,
        /// Meaning depends on `kind` (see ActionKind).
        flag: bool,
        source: ItemSource,
        page: BrowserPage,
        jump: BlockJump,
        unit: SelectUnit,
        argv: Vec<String>,
        workspace_tabs: Vec<WorkspaceTab>,
        /// GoToMark: scroll position.
        x: i64,
        y: i64,
    }

    #[derive(Debug)]
    struct KeyHint {
        keys: String,
        desc: String,
    }

    #[derive(Debug)]
    struct Outcome {
        disposition: KeyDisposition,
        actions: Vec<Action>,
        mode: Mode,
        mode_changed: bool,
        /// Pending count and keys (or typed hint characters) for the status
        /// display.
        pending: String,
        /// What the pending keys can continue with.
        which_key: Vec<KeyHint>,
        /// Milliseconds until the host should call `on_timeout`; 0 = none.
        timeout_ms: u32,
        /// Non-empty when a submitted command failed.
        error: String,
    }

    #[derive(Debug)]
    struct Completion {
        text: String,
        summary: String,
    }

    #[derive(Debug)]
    struct TabInfo {
        /// `tabs::TabHandle` raw value.
        id: i32,
        title: String,
        url: String,
        active: bool,
    }

    #[derive(Debug)]
    struct PaletteRow {
        primary: String,
        secondary: String,
        keys: String,
        /// UTF-16 offsets of matched characters, for highlighting.
        primary_marks: Vec<u32>,
        secondary_marks: Vec<u32>,
        /// Tab handle, or -1.
        tab_id: i32,
        active: bool,
        /// Tree depth (outline), from 0.
        indent: u32,
        /// A folded outline entry.
        folded: bool,
    }

    #[derive(Debug)]
    struct PaletteState {
        visible: bool,
        kind: PaletteKind,
        prompt: String,
        placeholder: String,
        /// The host sets its text field to this when it differs.
        text: String,
        rows: Vec<PaletteRow>,
        /// Index into `rows`, or -1.
        selected: i32,
        error: String,
        /// Shown instead of rows while the list is fetched, or when empty.
        status: String,
    }

    #[derive(Debug)]
    struct ConfigResult {
        /// "line N: message" for each problem.
        errors: Vec<String>,
        bindings: u32,
    }

    extern "Rust" {
        type Session;

        fn new_session() -> Box<Session>;

        /// `dom_key` is the DOM `KeyboardEvent.key` value.
        fn handle_key(
            self: &mut Session,
            dom_key: &str,
            modifiers: Modifiers,
            focus: FocusState,
        ) -> Outcome;
        fn on_focus_changed(self: &mut Session, focus: FocusState) -> Outcome;
        /// `host` of the active tab's page; empty when it has none.
        fn on_page_changed(self: &mut Session, host: &str) -> Outcome;
        fn on_tab_activated(self: &mut Session, id: i32);
        fn on_timeout(self: &mut Session) -> Outcome;

        fn set_tabs(self: &mut Session, tabs: Vec<TabInfo>);
        fn palette_input(self: &mut Session, text: &str) -> Outcome;
        fn palette_key(self: &mut Session, key: PaletteKey) -> Outcome;
        /// A row was clicked; for list palettes, follow with Accept.
        fn palette_select(self: &mut Session, index: u32) -> Outcome;
        /// The user clicked or scrolled the page with the pointer.
        fn on_pointer_activity(self: &mut Session) -> Outcome;
        fn palette_state(self: &Session) -> PaletteState;
        fn submit_command_line(self: &mut Session, text: &str) -> Outcome;
        fn cancel_command_line(self: &mut Session) -> Outcome;
        fn complete(self: &Session, text: &str) -> Vec<Completion>;

        /// Answer to CollectHints: one kind per collected target.
        fn hints_collected(self: &mut Session, generation: u32, kinds: &[HintKind]) -> Outcome;
        fn open_text(self: &mut Session, text: &str, disposition: OpenDisposition) -> Outcome;
        fn load_config(self: &mut Session, text: &str) -> ConfigResult;

        fn mode(self: &Session) -> Mode;
        fn mode_indicator(self: &Session) -> String;
        /// Whether tabs should start in a sidebar (config `vertical_tabs`).
        fn vertical_tabs_default(self: &Session) -> bool;
        /// Normal-mode bindings for Merlin Settings: `title` is the
        /// description, `detail` the command, `value` the keys.
        fn key_bindings(self: &Session) -> Vec<ListItem>;
        /// The hint characters in effect.
        fn hint_chars(self: &Session) -> String;
        /// Returns an empty string on success, otherwise the error message.
        fn bind(self: &mut Session, mode: Mode, keys: &str, command: &str) -> String;

        // -- Phases 3 and 4 ---------------------------------------------------

        /// `source` names the sender in errors ("browserctl").
        fn open_text_from(
            self: &mut Session,
            text: &str,
            disposition: OpenDisposition,
            source: &str,
        ) -> Outcome;
        fn set_window(self: &mut Session, private_window: bool);
        fn set_environment(self: &mut Session, visual: &str, editor: &str);
        fn set_workspace(self: &mut Session, name: &str);
        /// Empty when the window has no workspace.
        fn workspace(self: &Session) -> String;
        /// The workspace to keep saved as tabs change; empty for none.
        fn autosave_workspace(self: &Session) -> String;
        fn restore_session_default(self: &Session) -> bool;
        fn browserctl_enabled(self: &Session) -> bool;
        /// `now`: seconds since the Unix epoch.
        fn set_items(
            self: &mut Session,
            source: ItemSource,
            items: Vec<ListItem>,
            now: i64,
        ) -> Outcome;
        fn document_collected(
            self: &mut Session,
            generation: u32,
            title: &str,
            url: &str,
            blocks: Vec<PageBlock>,
        ) -> Outcome;
        fn field_info(self: &mut Session, info: FieldInfo, force: bool) -> Outcome;
        fn save_workspace(
            self: &mut Session,
            name: &str,
            quiet: bool,
            tabs: Vec<WindowTab>,
            now: i64,
        ) -> Outcome;
        fn workspace_read(self: &mut Session, name: &str, found: bool, text: &str) -> Outcome;
        /// Answer to RecordMark. `letter` is one character.
        fn mark_recorded(self: &mut Session, letter: &str, url: &str, x: i64, y: i64) -> Outcome;

        // -- browserctl protocol (no session needed) --------------------------

        fn ipc_parse(line: &str) -> IpcRequest;
        fn ipc_reply_ok(id: i64, message: &str) -> String;
        fn ipc_reply_error(id: i64, message: &str) -> String;
        fn ipc_reply_pong(id: i64) -> String;
        fn ipc_reply_tabs(id: i64, tabs: Vec<IpcTab>) -> String;
        fn ipc_reply_tab(id: i64, tab: IpcTab) -> String;
        fn ipc_reply_names(id: i64, names: Vec<String>) -> String;

        /// Whether a file stem is a valid workspace name.
        fn is_workspace_name(name: &str) -> bool;
        /// The editor argv with `{file}` replaced by `path`.
        fn editor_argv(argv: &[String], path: &str) -> Vec<String>;
        /// Of these workspace files (names and contents, same order), the
        /// one whose project folder contains `dir` most closely; empty if
        /// none.
        fn workspace_for_dir(names: &[String], texts: &[String], dir: &str) -> String;
    }
}

pub use ffi::{
    Action, ActionKind, BlockJump, BlockKind, BrowserPage, Completion, ConfigResult, FieldInfo,
    FieldKind, FocusKind, FocusState, HintAction, HintKind, HintLabel, HintTargets, IpcKind,
    IpcRequest, IpcTab, ItemSource, KeyDisposition, KeyHint, ListItem, MessageLevel, Mode,
    Modifiers, OpenDisposition, Outcome, PageBlock, PageSpan, PaletteKey, PaletteKind, PaletteRow,
    PaletteState, ScrollKind, SelectUnit, SpanKind, SplitLayout, Switch, TabInfo, TargetKind,
    WindowTab, WorkspaceTab, YankKind,
};

/// Opaque per-window session handed to C++ as `rust::Box<Session>`.
#[derive(Debug, Default)]
pub struct Session {
    inner: ModalSession,
}

pub fn new_session() -> Box<Session> {
    Box::new(Session::default())
}

impl Session {
    fn handle_key(&mut self, dom_key: &str, modifiers: Modifiers, focus: FocusState) -> Outcome {
        let mods = CoreModifiers::from_flags(
            modifiers.shift,
            modifiers.ctrl,
            modifiers.alt,
            modifiers.meta,
        );
        match Key::from_dom_key(dom_key, mods) {
            Some(key) => self.inner.handle_key(key, &focus_context(&focus)).into(),
            // Modifier-only, dead and IME keys: forward without touching state.
            None => self.passive(CoreKeyDisposition::Forward),
        }
    }

    fn on_focus_changed(&mut self, focus: FocusState) -> Outcome {
        self.inner.on_focus_changed(&focus_context(&focus)).into()
    }

    fn on_page_changed(&mut self, host: &str) -> Outcome {
        self.inner.on_page_changed(host).into()
    }

    fn on_tab_activated(&mut self, id: i32) {
        self.inner.on_tab_activated(id);
    }

    fn on_timeout(&mut self) -> Outcome {
        self.inner.on_timeout().into()
    }

    fn set_tabs(&mut self, tabs: Vec<TabInfo>) {
        self.inner.set_tabs(
            tabs.into_iter()
                .map(|t| CoreTabInfo {
                    id: t.id,
                    title: t.title,
                    url: t.url,
                    active: t.active,
                })
                .collect(),
        );
    }

    fn palette_input(&mut self, text: &str) -> Outcome {
        self.inner.palette_input(text).into()
    }

    fn palette_key(&mut self, key: PaletteKey) -> Outcome {
        let key = match key {
            PaletteKey::Next => CorePaletteKey::Next,
            PaletteKey::Previous => CorePaletteKey::Previous,
            PaletteKey::Up => CorePaletteKey::Up,
            PaletteKey::Down => CorePaletteKey::Down,
            PaletteKey::Accept => CorePaletteKey::Accept,
            PaletteKey::Collapse => CorePaletteKey::Collapse,
            PaletteKey::Expand => CorePaletteKey::Expand,
            // Cancel, and anything out of range: closing is always safe.
            _ => CorePaletteKey::Cancel,
        };
        self.inner.palette_key(key).into()
    }

    fn palette_select(&mut self, index: u32) -> Outcome {
        self.inner.palette_select(index as usize).into()
    }

    fn on_pointer_activity(&mut self) -> Outcome {
        self.inner.on_pointer_activity().into()
    }

    fn palette_state(&self) -> PaletteState {
        let Some(p) = self.inner.palette() else {
            return PaletteState {
                visible: false,
                kind: PaletteKind::CommandLine,
                prompt: String::new(),
                placeholder: String::new(),
                text: String::new(),
                rows: Vec::new(),
                selected: -1,
                error: String::new(),
                status: String::new(),
            };
        };
        PaletteState {
            visible: true,
            kind: p.kind.into(),
            prompt: p.kind.prompt().to_string(),
            placeholder: p.kind.placeholder().to_string(),
            text: p.text.clone(),
            rows: p
                .rows
                .iter()
                .map(|r| PaletteRow {
                    primary_marks: utf16_offsets(&r.primary, &r.primary_marks),
                    secondary_marks: utf16_offsets(&r.secondary, &r.secondary_marks),
                    primary: r.primary.clone(),
                    secondary: r.secondary.clone(),
                    keys: r.keys.clone(),
                    tab_id: r.tab_id.unwrap_or(-1),
                    active: r.active,
                    indent: u32::from(r.indent),
                    folded: r.folded,
                })
                .collect(),
            selected: p.selected.map_or(-1, |i| i as i32),
            error: p.error.clone().unwrap_or_default(),
            status: if p.loading {
                p.kind.loading_text().to_string()
            } else if p.rows.is_empty() && p.kind != CorePaletteKind::CommandLine {
                if p.text.trim().is_empty() {
                    p.kind.empty_text().to_string()
                } else {
                    "Nothing matches".to_string()
                }
            } else {
                String::new()
            },
        }
    }

    fn submit_command_line(&mut self, text: &str) -> Outcome {
        self.inner.submit_command_line(text).into()
    }

    fn cancel_command_line(&mut self) -> Outcome {
        self.inner.cancel_command_line().into()
    }

    fn complete(&self, text: &str) -> Vec<Completion> {
        self.inner
            .complete(text)
            .into_iter()
            .map(|c| Completion {
                text: c.text,
                summary: c.summary,
            })
            .collect()
    }

    fn hints_collected(&mut self, generation: u32, kinds: &[HintKind]) -> Outcome {
        let kinds: Vec<CoreHintKind> = kinds
            .iter()
            .map(|k| match *k {
                HintKind::Link => CoreHintKind::Link,
                HintKind::Editable => CoreHintKind::Editable,
                HintKind::Code => CoreHintKind::Code,
                HintKind::Block => CoreHintKind::Block,
                // Other, and anything out of range: clickable, nothing more.
                _ => CoreHintKind::Other,
            })
            .collect();
        self.inner.hints_collected(generation, &kinds).into()
    }

    fn open_text(&mut self, text: &str, disposition: OpenDisposition) -> Outcome {
        self.inner
            .open_text(text, core_disposition(disposition))
            .into()
    }

    fn load_config(&mut self, text: &str) -> ConfigResult {
        let report = self.inner.load_config(text);
        ConfigResult {
            errors: report.errors.iter().map(|e| e.to_string()).collect(),
            bindings: report.bindings as u32,
        }
    }

    fn mode(&self) -> Mode {
        self.inner.mode().into()
    }

    fn mode_indicator(&self) -> String {
        self.inner.mode().indicator().to_string()
    }

    fn vertical_tabs_default(&self) -> bool {
        self.inner.config().vertical_tabs
    }

    fn key_bindings(&self) -> Vec<ListItem> {
        self.inner
            .key_bindings()
            .into_iter()
            .map(|(keys, command, desc)| ListItem {
                title: desc,
                detail: command,
                value: keys,
                time: 0,
                current: false,
            })
            .collect()
    }

    fn hint_chars(&self) -> String {
        self.inner.config().hint_alphabet.to_string()
    }

    fn bind(&mut self, mode: Mode, keys: &str, command: &str) -> String {
        let Some(mode) = core_mode(mode) else {
            return "invalid mode value".to_string();
        };
        match self.inner.bind(mode, keys, command) {
            Ok(()) => String::new(),
            Err(e) => e.to_string(),
        }
    }

    fn open_text_from(
        &mut self,
        text: &str,
        disposition: OpenDisposition,
        source: &str,
    ) -> Outcome {
        self.inner
            .open_text_from(text, core_disposition(disposition), source)
            .into()
    }

    fn set_window(&mut self, private_window: bool) {
        self.inner.set_window(private_window);
    }

    fn set_environment(&mut self, visual: &str, editor: &str) {
        self.inner.set_environment(visual, editor);
    }

    fn set_workspace(&mut self, name: &str) {
        self.inner.set_workspace(name);
    }

    fn workspace(&self) -> String {
        self.inner.workspace().unwrap_or_default().to_string()
    }

    fn autosave_workspace(&self) -> String {
        self.inner
            .autosave_workspace()
            .unwrap_or_default()
            .to_string()
    }

    fn restore_session_default(&self) -> bool {
        self.inner.config().restore_session
    }

    fn browserctl_enabled(&self) -> bool {
        self.inner.config().browserctl
    }

    fn set_items(&mut self, source: ItemSource, items: Vec<ListItem>, now: i64) -> Outcome {
        let source = match source {
            ItemSource::History => CoreItemSource::History,
            ItemSource::Bookmarks => CoreItemSource::Bookmarks,
            ItemSource::Workspaces => CoreItemSource::Workspaces,
            ItemSource::Profiles => CoreItemSource::Profiles,
            ItemSource::Downloads => CoreItemSource::Downloads,
            // Out of range: nothing is waiting for it.
            _ => return self.passive(CoreKeyDisposition::Consumed),
        };
        let items = items
            .into_iter()
            .map(|i| CoreListItem {
                title: i.title,
                detail: i.detail,
                value: i.value,
                time: i.time,
                current: i.current,
            })
            .collect();
        self.inner.set_items(source, items, now).into()
    }

    fn document_collected(
        &mut self,
        generation: u32,
        title: &str,
        url: &str,
        blocks: Vec<PageBlock>,
    ) -> Outcome {
        let blocks = blocks
            .into_iter()
            .take(core_api::document::MAX_BLOCKS)
            .filter_map(core_block)
            .collect();
        self.inner
            .document_collected(generation, PageDocument::new(title, url, blocks))
            .into()
    }

    fn field_info(&mut self, info: FieldInfo, force: bool) -> Outcome {
        let kind = match info.kind {
            FieldKind::Input => CoreFieldKind::Input,
            FieldKind::TextArea => CoreFieldKind::TextArea,
            FieldKind::ContentEditable => CoreFieldKind::ContentEditable,
            // None, and anything out of range: nothing to edit.
            _ => CoreFieldKind::None,
        };
        let info = CoreFieldInfo {
            kind,
            input_type: info.input_type.to_ascii_lowercase(),
            autocomplete: info.autocomplete.to_ascii_lowercase(),
            label: info.label,
            length: info.length as usize,
            read_only: info.read_only,
        };
        self.inner.field_info(&info, force).into()
    }

    fn save_workspace(
        &mut self,
        name: &str,
        quiet: bool,
        tabs: Vec<WindowTab>,
        now: i64,
    ) -> Outcome {
        let tabs: Vec<CoreWindowTab> = tabs
            .into_iter()
            .take(core_api::workspace::MAX_WORKSPACE_TABS)
            .map(|t| CoreWindowTab {
                url: t.url,
                title: t.title,
                pinned: t.pinned,
                active: t.active,
                split: (t.split >= 0).then_some(t.split),
                layout: if t.layout == SplitLayout::Stacked {
                    CoreSplitLayout::Stacked
                } else {
                    CoreSplitLayout::SideBySide
                },
            })
            .collect();
        self.inner.save_workspace(name, quiet, &tabs, now).into()
    }

    fn workspace_read(&mut self, name: &str, found: bool, text: &str) -> Outcome {
        self.inner.workspace_read(name, found, text).into()
    }

    fn mark_recorded(&mut self, letter: &str, url: &str, x: i64, y: i64) -> Outcome {
        let mut chars = letter.chars();
        match (chars.next(), chars.next()) {
            (Some(c), None) => self.inner.mark_recorded(c, url, x, y).into(),
            _ => self.passive(CoreKeyDisposition::Consumed),
        }
    }

    fn passive(&self, disposition: CoreKeyDisposition) -> Outcome {
        Outcome {
            disposition: disposition.into(),
            actions: Vec::new(),
            mode: self.inner.mode().into(),
            mode_changed: false,
            pending: self.inner.pending_display(),
            which_key: Vec::new(),
            timeout_ms: 0,
            error: String::new(),
        }
    }
}

/// Converts character indices into UTF-16 offsets of those characters, which
/// is what Views text ranges use.
fn utf16_offsets(text: &str, char_indices: &[usize]) -> Vec<u32> {
    let mut out = Vec::with_capacity(char_indices.len());
    let mut wanted = char_indices.iter().copied().peekable();
    let mut offset = 0u32;
    for (i, c) in text.chars().enumerate() {
        while wanted.peek().is_some_and(|&w| w < i) {
            wanted.next();
        }
        if wanted.peek() == Some(&i) {
            out.push(offset);
            wanted.next();
        }
        offset += c.len_utf16() as u32;
    }
    out
}

fn core_disposition(disposition: OpenDisposition) -> CoreDisposition {
    match disposition {
        OpenDisposition::NewForegroundTab => CoreDisposition::NewForegroundTab,
        OpenDisposition::NewBackgroundTab => CoreDisposition::NewBackgroundTab,
        OpenDisposition::NewWindow => CoreDisposition::NewWindow,
        _ => CoreDisposition::CurrentTab,
    }
}

/// Converts one block from C++; out-of-range kinds drop the block.
fn core_block(b: PageBlock) -> Option<core_api::Block> {
    let kind = match b.kind {
        BlockKind::Heading => CoreBlockKind::Heading,
        BlockKind::Paragraph => CoreBlockKind::Paragraph,
        BlockKind::ListItem => CoreBlockKind::ListItem,
        BlockKind::Code => CoreBlockKind::Code,
        BlockKind::Quote => CoreBlockKind::Quote,
        BlockKind::TableRow => CoreBlockKind::TableRow,
        BlockKind::Rule => CoreBlockKind::Rule,
        _ => return None,
    };
    let offsets: Vec<usize> = b
        .spans
        .iter()
        .take(core_api::document::MAX_SPANS)
        .flat_map(|s| [s.start as usize, s.end as usize])
        .collect();
    let chars = utf16_to_char_offsets(&b.text, &offsets);
    let spans = b
        .spans
        .into_iter()
        .take(core_api::document::MAX_SPANS)
        .enumerate()
        .filter_map(|(i, s)| {
            let kind = match s.kind {
                SpanKind::Link => CoreSpanKind::Link,
                SpanKind::Code => CoreSpanKind::Code,
                SpanKind::Strong => CoreSpanKind::Strong,
                SpanKind::Emphasis => CoreSpanKind::Emphasis,
                _ => return None,
            };
            Some(core_api::Span {
                start: chars[2 * i],
                end: chars[2 * i + 1],
                kind,
                href: s.href,
            })
        })
        .collect();
    Some(core_api::Block {
        kind,
        level: b.level.min(255) as u8,
        ordered: b.ordered,
        header: b.header,
        lang: b.lang,
        text: b.text,
        spans,
        element: b.element,
    })
}

fn ipc_id(id: i64) -> Option<u64> {
    u64::try_from(id).ok()
}

pub fn ipc_parse(line: &str) -> IpcRequest {
    let mut out = IpcRequest {
        kind: IpcKind::Invalid,
        id: -1,
        text: String::new(),
        number: 0,
        disposition: OpenDisposition::NewForegroundTab,
        error: String::new(),
    };
    let envelope = match ipc::parse_request(line) {
        Ok(e) => e,
        Err(e) => {
            out.id = e.id.and_then(|i| i64::try_from(i).ok()).unwrap_or(-1);
            out.error = e.message;
            return out;
        }
    };
    out.id = envelope
        .id
        .and_then(|i| i64::try_from(i).ok())
        .unwrap_or(-1);
    match envelope.request {
        IpcCoreRequest::Ping => out.kind = IpcKind::Ping,
        IpcCoreRequest::Tabs => out.kind = IpcKind::Tabs,
        IpcCoreRequest::Current => out.kind = IpcKind::Current,
        IpcCoreRequest::Selection => out.kind = IpcKind::Selection,
        IpcCoreRequest::Open { target, place } => {
            out.kind = IpcKind::Open;
            out.text = target;
            out.disposition = match place {
                OpenPlace::Current => OpenDisposition::CurrentTab,
                OpenPlace::Tab => OpenDisposition::NewForegroundTab,
                OpenPlace::Background => OpenDisposition::NewBackgroundTab,
                OpenPlace::Window => OpenDisposition::NewWindow,
            };
        }
        IpcCoreRequest::Focus { tab } => {
            out.kind = IpcKind::Focus;
            out.number = tab;
        }
        IpcCoreRequest::Workspace(w) => {
            let (kind, name) = match w {
                WorkspaceRequest::Save(n) => (IpcKind::WorkspaceSave, n),
                WorkspaceRequest::Open(n) => (IpcKind::WorkspaceOpen, n),
                WorkspaceRequest::Delete(n) => (IpcKind::WorkspaceDelete, n),
                WorkspaceRequest::List => (IpcKind::WorkspaceList, String::new()),
                WorkspaceRequest::Here(dir) => (IpcKind::WorkspaceHere, dir),
            };
            out.kind = kind;
            out.text = name;
        }
        IpcCoreRequest::Command { line } => {
            out.kind = IpcKind::Command;
            out.text = line;
        }
    }
    out
}

pub fn ipc_reply_ok(id: i64, message: &str) -> String {
    ipc::reply_ok(ipc_id(id), JsonValue::string(message))
}

pub fn ipc_reply_error(id: i64, message: &str) -> String {
    ipc::reply_error(ipc_id(id), message)
}

pub fn ipc_reply_pong(id: i64) -> String {
    ipc::reply_ok(
        ipc_id(id),
        JsonValue::object([
            ("protocol", JsonValue::Number(ipc::PROTOCOL_VERSION as f64)),
            ("product", JsonValue::string("modal_browser")),
        ]),
    )
}

fn summary(t: IpcTab) -> ipc::TabSummary {
    ipc::TabSummary {
        index: t.index,
        id: t.id,
        window: t.window,
        title: t.title,
        url: t.url,
        active: t.active,
        pinned: t.pinned,
    }
}

pub fn ipc_reply_tabs(id: i64, tabs: Vec<IpcTab>) -> String {
    ipc::reply_ok(
        ipc_id(id),
        JsonValue::Array(tabs.into_iter().map(|t| summary(t).to_value()).collect()),
    )
}

pub fn ipc_reply_tab(id: i64, tab: IpcTab) -> String {
    ipc::reply_ok(ipc_id(id), summary(tab).to_value())
}

pub fn ipc_reply_names(id: i64, names: Vec<String>) -> String {
    ipc::reply_ok(
        ipc_id(id),
        JsonValue::Array(names.into_iter().map(JsonValue::String).collect()),
    )
}

pub fn workspace_for_dir(names: &[String], texts: &[String], dir: &str) -> String {
    let entries: Vec<(String, String)> = names
        .iter()
        .zip(texts)
        .filter_map(|(name, text)| {
            core_api::workspace::validate_name(name).ok()?;
            Some((name.clone(), core_api::workspace::project_of(text)?))
        })
        .collect();
    core_api::workspace::best_for_dir(&entries, dir)
        .unwrap_or_default()
        .to_string()
}

pub fn is_workspace_name(name: &str) -> bool {
    core_api::workspace::validate_name(name).is_ok()
}

pub fn editor_argv(argv: &[String], path: &str) -> Vec<String> {
    core_api::editor::substitute(argv, path)
}

fn focus_context(focus: &FocusState) -> FocusContext {
    let target = match focus.kind {
        FocusKind::PlainTextField => FocusTarget::PageEditable(Editable::PlainText),
        FocusKind::RichTextField => FocusTarget::PageEditable(Editable::RichText),
        FocusKind::Page => FocusTarget::Page,
        // BrowserUi, and any out-of-range value C++ might pass: the safe
        // interpretation is "do not touch this key".
        _ => FocusTarget::BrowserUi,
    };
    FocusContext {
        target,
        ime_composing: focus.ime_composing,
    }
}

fn core_mode(mode: Mode) -> Option<CoreMode> {
    Some(match mode {
        Mode::Normal => CoreMode::Normal,
        Mode::Insert => CoreMode::Insert,
        Mode::Visual => CoreMode::Visual,
        Mode::Command => CoreMode::Command,
        Mode::Passthrough => CoreMode::Passthrough,
        Mode::Hint => CoreMode::Hint,
        _ => return None,
    })
}

impl From<CoreMode> for Mode {
    fn from(mode: CoreMode) -> Self {
        match mode {
            CoreMode::Normal => Mode::Normal,
            CoreMode::Insert => Mode::Insert,
            CoreMode::Visual => Mode::Visual,
            CoreMode::Command => Mode::Command,
            CoreMode::Passthrough => Mode::Passthrough,
            CoreMode::Hint => Mode::Hint,
        }
    }
}

impl From<CoreKeyDisposition> for KeyDisposition {
    fn from(d: CoreKeyDisposition) -> Self {
        match d {
            CoreKeyDisposition::Consumed => KeyDisposition::Consumed,
            CoreKeyDisposition::Forward => KeyDisposition::Forward,
        }
    }
}

impl From<CoreDisposition> for OpenDisposition {
    fn from(d: CoreDisposition) -> Self {
        match d {
            CoreDisposition::CurrentTab => OpenDisposition::CurrentTab,
            CoreDisposition::NewForegroundTab => OpenDisposition::NewForegroundTab,
            CoreDisposition::NewBackgroundTab => OpenDisposition::NewBackgroundTab,
            CoreDisposition::NewWindow => OpenDisposition::NewWindow,
        }
    }
}

impl From<CoreScroll> for ScrollKind {
    fn from(s: CoreScroll) -> Self {
        match s {
            CoreScroll::Down => ScrollKind::Down,
            CoreScroll::Up => ScrollKind::Up,
            CoreScroll::Left => ScrollKind::Left,
            CoreScroll::Right => ScrollKind::Right,
            CoreScroll::Top => ScrollKind::Top,
            CoreScroll::Bottom => ScrollKind::Bottom,
            CoreScroll::HalfPageDown => ScrollKind::HalfPageDown,
            CoreScroll::HalfPageUp => ScrollKind::HalfPageUp,
            CoreScroll::PageDown => ScrollKind::PageDown,
            CoreScroll::PageUp => ScrollKind::PageUp,
        }
    }
}

impl From<CoreMessageLevel> for MessageLevel {
    fn from(l: CoreMessageLevel) -> Self {
        match l {
            CoreMessageLevel::Info => MessageLevel::Info,
            CoreMessageLevel::Error => MessageLevel::Error,
        }
    }
}

impl From<CoreHintAction> for HintAction {
    fn from(a: CoreHintAction) -> Self {
        match a {
            CoreHintAction::Follow => HintAction::Follow,
            CoreHintAction::OpenInNewTab => HintAction::OpenInNewTab,
            CoreHintAction::YankLink => HintAction::YankLink,
            CoreHintAction::FocusInput => HintAction::FocusInput,
            CoreHintAction::EditInput => HintAction::EditInput,
            CoreHintAction::YankCode => HintAction::YankCode,
            CoreHintAction::Select => HintAction::Select,
        }
    }
}

impl From<CoreYankKind> for YankKind {
    fn from(k: CoreYankKind) -> Self {
        match k {
            CoreYankKind::Url => YankKind::Url,
            CoreYankKind::Title => YankKind::Title,
            CoreYankKind::Markdown => YankKind::Markdown,
            CoreYankKind::Selection => YankKind::Selection,
        }
    }
}

impl From<CoreSwitch> for Switch {
    fn from(s: CoreSwitch) -> Self {
        match s {
            CoreSwitch::On => Switch::On,
            CoreSwitch::Off => Switch::Off,
            CoreSwitch::Toggle => Switch::Toggle,
        }
    }
}

impl From<CorePaletteKind> for PaletteKind {
    fn from(k: CorePaletteKind) -> Self {
        match k {
            CorePaletteKind::CommandLine => PaletteKind::CommandLine,
            CorePaletteKind::Tabs => PaletteKind::Tabs,
            CorePaletteKind::Commands => PaletteKind::Commands,
            CorePaletteKind::History => PaletteKind::History,
            CorePaletteKind::Bookmarks => PaletteKind::Bookmarks,
            CorePaletteKind::Workspaces => PaletteKind::Workspaces,
            CorePaletteKind::Profiles => PaletteKind::Profiles,
            CorePaletteKind::Outline => PaletteKind::Outline,
            CorePaletteKind::Links => PaletteKind::Links,
            CorePaletteKind::Menu => PaletteKind::Menu,
            CorePaletteKind::Downloads => PaletteKind::Downloads,
        }
    }
}

impl From<CoreSplitLayout> for SplitLayout {
    fn from(l: CoreSplitLayout) -> Self {
        match l {
            CoreSplitLayout::SideBySide => SplitLayout::SideBySide,
            CoreSplitLayout::Stacked => SplitLayout::Stacked,
        }
    }
}

impl From<CoreHintTargets> for HintTargets {
    fn from(t: CoreHintTargets) -> Self {
        match t {
            CoreHintTargets::Clickable => HintTargets::Clickable,
            CoreHintTargets::Code => HintTargets::Code,
            CoreHintTargets::Text => HintTargets::Text,
        }
    }
}

impl From<CoreItemSource> for ItemSource {
    fn from(s: CoreItemSource) -> Self {
        match s {
            CoreItemSource::History => ItemSource::History,
            CoreItemSource::Bookmarks => ItemSource::Bookmarks,
            CoreItemSource::Workspaces => ItemSource::Workspaces,
            CoreItemSource::Profiles => ItemSource::Profiles,
            CoreItemSource::Downloads => ItemSource::Downloads,
        }
    }
}

impl From<CoreBrowserPage> for BrowserPage {
    fn from(p: CoreBrowserPage) -> Self {
        match p {
            CoreBrowserPage::History => BrowserPage::History,
            CoreBrowserPage::Bookmarks => BrowserPage::Bookmarks,
            CoreBrowserPage::Downloads => BrowserPage::Downloads,
            CoreBrowserPage::Settings => BrowserPage::Settings,
            CoreBrowserPage::Extensions => BrowserPage::Extensions,
            CoreBrowserPage::ReadingMode => BrowserPage::ReadingMode,
        }
    }
}

impl From<CoreBlockJump> for BlockJump {
    fn from(j: CoreBlockJump) -> Self {
        match j {
            CoreBlockJump::Heading => BlockJump::Heading,
            CoreBlockJump::Code => BlockJump::Code,
            CoreBlockJump::Table => BlockJump::Table,
            CoreBlockJump::Paragraph => BlockJump::Paragraph,
            CoreBlockJump::Link => BlockJump::Link,
        }
    }
}

impl From<CoreSelectUnit> for SelectUnit {
    fn from(u: CoreSelectUnit) -> Self {
        match u {
            CoreSelectUnit::Character => SelectUnit::Character,
            CoreSelectUnit::Word => SelectUnit::Word,
            CoreSelectUnit::Line => SelectUnit::Line,
            CoreSelectUnit::Sentence => SelectUnit::Sentence,
            CoreSelectUnit::Paragraph => SelectUnit::Paragraph,
            CoreSelectUnit::Document => SelectUnit::Document,
        }
    }
}

impl Action {
    fn simple(kind: ActionKind) -> Self {
        Action {
            kind,
            text: String::new(),
            count: 0,
            disposition: OpenDisposition::CurrentTab,
            scroll: ScrollKind::None,
            step: 0,
            smooth: false,
            bypass_cache: false,
            level: MessageLevel::Info,
            id: -1,
            index: 0,
            hint_action: HintAction::Follow,
            yank: YankKind::Url,
            palette: PaletteKind::CommandLine,
            setting: Switch::Toggle,
            hints: Vec::new(),
            hint_targets: HintTargets::Clickable,
            target: TargetKind::None,
            layout: SplitLayout::SideBySide,
            name: String::new(),
            detail: String::new(),
            flag: false,
            source: ItemSource::History,
            page: BrowserPage::Settings,
            jump: BlockJump::Heading,
            unit: SelectUnit::Character,
            argv: Vec::new(),
            workspace_tabs: Vec::new(),
            x: 0,
            y: 0,
        }
    }

    fn named(kind: ActionKind, name: String) -> Self {
        Action {
            name,
            ..Action::simple(kind)
        }
    }

    fn with_count(kind: ActionKind, count: u32) -> Self {
        Action {
            count,
            ..Action::simple(kind)
        }
    }

    fn with_text(kind: ActionKind, text: String) -> Self {
        Action {
            text,
            ..Action::simple(kind)
        }
    }
}

impl From<CoreAction> for Action {
    fn from(action: CoreAction) -> Self {
        use ActionKind as K;
        match action {
            CoreAction::Open {
                target,
                disposition,
            } => {
                let (kind, text) = match target {
                    OpenTarget::Url(url) => (K::OpenUrl, url),
                    OpenTarget::Search(terms) => (K::OpenSearch, terms),
                };
                Action {
                    disposition: disposition.into(),
                    ..Action::with_text(kind, text)
                }
            }
            CoreAction::NewTab => Action::simple(K::NewTab),
            CoreAction::CloseTab => Action::simple(K::CloseTab),
            CoreAction::RestoreTab => Action::simple(K::RestoreTab),
            CoreAction::NextTab { count } => Action::with_count(K::NextTab, count),
            CoreAction::PreviousTab { count } => Action::with_count(K::PreviousTab, count),
            CoreAction::SelectTabEdge(TabEdge::First) => Action::simple(K::FirstTab),
            CoreAction::SelectTabEdge(TabEdge::Last) => Action::simple(K::LastTab),
            CoreAction::ActivateTab { id } => Action {
                id,
                ..Action::simple(K::ActivateTab)
            },
            CoreAction::Back { count } => Action::with_count(K::Back, count),
            CoreAction::Forward { count } => Action::with_count(K::Forward, count),
            CoreAction::Reload { bypass_cache } => Action {
                bypass_cache,
                ..Action::simple(K::Reload)
            },
            CoreAction::NavigateUp { count } => Action::with_count(K::NavigateUp, count),
            CoreAction::NavigateRoot => Action::simple(K::NavigateRoot),
            CoreAction::Scroll {
                scroll,
                count,
                step,
                smooth,
            } => Action {
                scroll: scroll.into(),
                step,
                smooth,
                ..Action::with_count(K::Scroll, count)
            },
            CoreAction::FocusAddressBar => Action::simple(K::FocusAddressBar),
            CoreAction::FindInPage => Action::simple(K::FindInPage),
            CoreAction::FindNext => Action::simple(K::FindNext),
            CoreAction::FindPrevious => Action::simple(K::FindPrevious),
            CoreAction::Yank(kind) => Action {
                yank: kind.into(),
                ..Action::simple(K::Yank)
            },
            CoreAction::OpenClipboard { disposition } => Action {
                disposition: disposition.into(),
                ..Action::simple(K::OpenClipboard)
            },
            CoreAction::OpenPalette { kind, text } => Action {
                palette: kind.into(),
                ..Action::with_text(K::OpenPalette, text)
            },
            CoreAction::UpdatePalette => Action::simple(K::UpdatePalette),
            CoreAction::ClosePalette => Action::simple(K::ClosePalette),
            CoreAction::BlurFocusedElement => Action::simple(K::BlurFocusedElement),
            CoreAction::CollectHints { generation, action } => Action {
                index: generation,
                hint_action: action.into(),
                hint_targets: action.targets().into(),
                ..Action::simple(K::CollectHints)
            },
            CoreAction::ShowHints { hints, action } => Action {
                hint_action: action.into(),
                hints: hints
                    .into_iter()
                    .map(|h| HintLabel {
                        target: h.target,
                        label: h.label,
                    })
                    .collect(),
                ..Action::simple(K::ShowHints)
            },
            CoreAction::FilterHints { typed } => Action::with_text(K::FilterHints, typed),
            CoreAction::HideHints => Action::simple(K::HideHints),
            CoreAction::ActivateHint { target, action } => Action {
                index: target,
                hint_action: action.into(),
                ..Action::simple(K::ActivateHint)
            },
            CoreAction::ReloadConfig => Action::simple(K::ReloadConfig),
            CoreAction::VerticalTabs(s) => Action {
                setting: s.into(),
                ..Action::simple(K::VerticalTabs)
            },
            CoreAction::TabSidebar(s) => Action {
                setting: s.into(),
                ..Action::simple(K::TabSidebar)
            },
            CoreAction::ShowMessage { level, text } => Action {
                level: level.into(),
                ..Action::with_text(K::ShowMessage, text)
            },
            CoreAction::Split { layout, target } => {
                let (target, text) = match target {
                    None => (TargetKind::None, String::new()),
                    Some(OpenTarget::Url(u)) => (TargetKind::Url, u),
                    Some(OpenTarget::Search(s)) => (TargetKind::Search, s),
                };
                Action {
                    layout: layout.into(),
                    target,
                    ..Action::with_text(K::Split, text)
                }
            }
            CoreAction::SplitFocusOther => Action::simple(K::SplitFocusOther),
            CoreAction::SplitSwap => Action::simple(K::SplitSwap),
            CoreAction::Unsplit => Action::simple(K::Unsplit),
            CoreAction::PinTab(s) => Action {
                setting: s.into(),
                ..Action::simple(K::PinTab)
            },
            CoreAction::NewWindow { private } => Action {
                flag: private,
                ..Action::simple(K::NewWindow)
            },
            CoreAction::SnapshotWorkspace { name, quiet } => Action {
                flag: quiet,
                ..Action::named(K::SnapshotWorkspace, name)
            },
            CoreAction::WriteWorkspace {
                name,
                contents,
                message,
            } => Action {
                text: contents,
                detail: message,
                ..Action::named(K::WriteWorkspace, name)
            },
            CoreAction::ReadWorkspace { name } => Action::named(K::ReadWorkspace, name),
            CoreAction::DeleteWorkspace { name } => Action::named(K::DeleteWorkspace, name),
            CoreAction::RestoreWorkspace {
                workspace,
                new_window,
            } => {
                let tabs = workspace
                    .tabs
                    .iter()
                    .enumerate()
                    .map(|(i, t)| {
                        let split = workspace.split_of(i);
                        WorkspaceTab {
                            url: t.url.clone(),
                            title: t.title.clone(),
                            pinned: t.pinned,
                            split_with: split
                                .map(|s| if s.tabs[0] == i { s.tabs[1] } else { s.tabs[0] })
                                .map_or(-1, |j| j as i32),
                            layout: split.map(|s| s.layout).unwrap_or_default().into(),
                        }
                    })
                    .collect();
                Action {
                    index: workspace.active as u32,
                    flag: new_window,
                    workspace_tabs: tabs,
                    ..Action::named(K::RestoreWorkspace, workspace.name)
                }
            }
            CoreAction::SwitchProfile { name } => Action::named(K::SwitchProfile, name),
            CoreAction::RequestItems(source) => Action {
                source: source.into(),
                ..Action::simple(K::RequestItems)
            },
            CoreAction::ShowBrowserPage(page) => Action {
                page: page.into(),
                ..Action::simple(K::ShowBrowserPage)
            },
            CoreAction::BrowserCommand { name, arg } => Action {
                text: arg,
                ..Action::named(K::BrowserCommand, name)
            },
            CoreAction::ToggleDevTools => Action::simple(K::ToggleDevTools),
            CoreAction::AddBookmark => Action::simple(K::AddBookmark),
            CoreAction::CollectDocument { generation, .. } => Action {
                index: generation,
                ..Action::simple(K::CollectDocument)
            },
            CoreAction::RevealElement { element } => Action {
                index: element,
                ..Action::simple(K::RevealElement)
            },
            CoreAction::JumpToBlock {
                kind,
                forward,
                count,
            } => Action {
                jump: kind.into(),
                flag: forward,
                ..Action::with_count(K::JumpToBlock, count)
            },
            CoreAction::CopyText { text, what } => Action {
                detail: what,
                ..Action::with_text(K::CopyText, text)
            },
            CoreAction::OpenInEditor {
                text,
                extension,
                argv,
            } => Action {
                detail: extension,
                argv,
                ..Action::with_text(K::OpenInEditor, text)
            },
            CoreAction::InspectField { force } => Action {
                flag: force,
                ..Action::simple(K::InspectField)
            },
            CoreAction::EditField { argv } => Action {
                argv,
                ..Action::simple(K::EditField)
            },
            CoreAction::ExtendSelection {
                forward,
                unit,
                count,
            } => Action {
                flag: forward,
                unit: unit.into(),
                ..Action::with_count(K::ExtendSelection, count)
            },
            CoreAction::ClearSelection => Action::simple(K::ClearSelection),
            CoreAction::RecordMark { letter } => Action::named(K::RecordMark, letter.to_string()),
            CoreAction::GoToMark {
                letter,
                url,
                x,
                y,
                navigate,
            } => Action {
                text: url,
                x,
                y,
                flag: navigate,
                ..Action::named(K::GoToMark, letter.to_string())
            },
        }
    }
}

impl From<CoreOutcome> for Outcome {
    fn from(o: CoreOutcome) -> Self {
        Outcome {
            disposition: o.disposition.into(),
            actions: o.actions.into_iter().map(Action::from).collect(),
            mode: o.mode.into(),
            mode_changed: o.mode_changed,
            pending: o.pending,
            which_key: o
                .which_key
                .into_iter()
                .map(|h| KeyHint {
                    keys: h.keys,
                    desc: h.desc,
                })
                .collect(),
            timeout_ms: o.timeout_ms.unwrap_or(0),
            error: o.error.unwrap_or_default(),
        }
    }
}

/// Rust-side access for tests of the bridge mapping itself.
pub mod testing {
    use super::*;

    pub fn handle_key(
        s: &mut Session,
        dom_key: &str,
        modifiers: Modifiers,
        focus: FocusState,
    ) -> Outcome {
        s.handle_key(dom_key, modifiers, focus)
    }

    pub fn submit_command_line(s: &mut Session, text: &str) -> Outcome {
        s.submit_command_line(text)
    }

    pub fn on_focus_changed(s: &mut Session, focus: FocusState) -> Outcome {
        s.on_focus_changed(focus)
    }

    pub fn bind(s: &mut Session, mode: Mode, keys: &str, command: &str) -> String {
        s.bind(mode, keys, command)
    }

    pub fn hints_collected(s: &mut Session, generation: u32, kinds: &[HintKind]) -> Outcome {
        s.hints_collected(generation, kinds)
    }

    pub fn set_tabs(s: &mut Session, tabs: Vec<TabInfo>) {
        s.set_tabs(tabs)
    }

    pub fn palette_input(s: &mut Session, text: &str) -> Outcome {
        s.palette_input(text)
    }

    pub fn palette_key(s: &mut Session, key: PaletteKey) -> Outcome {
        s.palette_key(key)
    }

    pub fn palette_state(s: &Session) -> PaletteState {
        s.palette_state()
    }

    pub fn load_config(s: &mut Session, text: &str) -> ConfigResult {
        s.load_config(text)
    }

    pub fn utf16_offsets(text: &str, char_indices: &[usize]) -> Vec<u32> {
        super::utf16_offsets(text, char_indices)
    }
}
