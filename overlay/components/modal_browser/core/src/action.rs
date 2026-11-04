//! Typed browser actions.
//!
//! An [`Action`] is a request for the host to do something to the browser.
//! The core produces actions and never calls browser APIs itself; the C++
//! adapter maps each one to an existing Chromium function (see
//! `chrome/browser/ui/modal_browser/modal_browser_controller.cc`).

use crate::document::ExtractKind;
use crate::hints::{Hint, HintAction};
use crate::palette::{ItemSource, PaletteKind};
use crate::target::OpenTarget;
use crate::workspace::{SplitLayout, Workspace};

/// Where an opened page goes. Mirrors the subset of
/// `WindowOpenDisposition` we use.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Disposition {
    CurrentTab,
    NewForegroundTab,
    NewBackgroundTab,
    NewWindow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Scroll {
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

impl Scroll {
    pub const ALL: [(Scroll, &'static str); 10] = [
        (Scroll::Down, "down"),
        (Scroll::Up, "up"),
        (Scroll::Left, "left"),
        (Scroll::Right, "right"),
        (Scroll::Top, "top"),
        (Scroll::Bottom, "bottom"),
        (Scroll::HalfPageDown, "half-down"),
        (Scroll::HalfPageUp, "half-up"),
        (Scroll::PageDown, "page-down"),
        (Scroll::PageUp, "page-up"),
    ];

    pub fn from_name(name: &str) -> Option<Scroll> {
        Self::ALL.iter().find(|(_, n)| *n == name).map(|(s, _)| *s)
    }

    pub fn name(self) -> &'static str {
        Self::ALL
            .iter()
            .find(|(s, _)| *s == self)
            .map(|(_, n)| *n)
            .unwrap_or("down")
    }

    /// Line-sized scrolls; the rest are page-sized jumps.
    pub fn is_line(self) -> bool {
        matches!(
            self,
            Scroll::Down | Scroll::Up | Scroll::Left | Scroll::Right
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MessageLevel {
    Info,
    Error,
}

/// What `:yank` copies from the current tab.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum YankKind {
    Url,
    Title,
    /// `[title](url)`
    Markdown,
    /// The text selected in the page.
    Selection,
}

impl YankKind {
    pub const ALL: [(YankKind, &'static str); 4] = [
        (YankKind::Url, "url"),
        (YankKind::Title, "title"),
        (YankKind::Markdown, "markdown"),
        (YankKind::Selection, "selection"),
    ];

    pub fn from_name(name: &str) -> Option<YankKind> {
        Self::ALL.iter().find(|(_, n)| *n == name).map(|(k, _)| *k)
    }
}

/// A setting change requested by a command: turn on, off, or flip.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Switch {
    On,
    Off,
    Toggle,
}

/// Which tab `:tabfirst`/`:tablast` select.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TabEdge {
    First,
    Last,
}

/// Browser pages and panels opened by name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BrowserPage {
    History,
    Bookmarks,
    Downloads,
    Settings,
    Extensions,
    /// Chromium's Reading mode side panel.
    ReadingMode,
}

/// Structural units `:jump` moves between.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BlockJump {
    Heading,
    Code,
    Table,
    Paragraph,
    Link,
}

impl BlockJump {
    pub const ALL: [(BlockJump, &'static str); 5] = [
        (BlockJump::Heading, "heading"),
        (BlockJump::Code, "code"),
        (BlockJump::Table, "table"),
        (BlockJump::Paragraph, "paragraph"),
        (BlockJump::Link, "link"),
    ];

    pub fn from_name(name: &str) -> Option<BlockJump> {
        Self::ALL.iter().find(|(_, n)| *n == name).map(|(k, _)| *k)
    }

    pub fn name(self) -> &'static str {
        Self::ALL
            .iter()
            .find(|(k, _)| *k == self)
            .map(|(_, n)| *n)
            .unwrap_or("heading")
    }
}

/// How far a Visual-mode motion moves the selection's focus. Mirrors the
/// granularities of `Selection.modify`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SelectUnit {
    Character,
    Word,
    Line,
    Sentence,
    Paragraph,
    Document,
}

impl SelectUnit {
    pub const ALL: [(SelectUnit, &'static str); 6] = [
        (SelectUnit::Character, "character"),
        (SelectUnit::Word, "word"),
        (SelectUnit::Line, "line"),
        (SelectUnit::Sentence, "sentence"),
        (SelectUnit::Paragraph, "paragraph"),
        (SelectUnit::Document, "document"),
    ];

    pub fn from_name(name: &str) -> Option<SelectUnit> {
        Self::ALL.iter().find(|(_, n)| *n == name).map(|(k, _)| *k)
    }
}

/// Where `:extract` output goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ExtractDestination {
    Clipboard,
    /// A read-only temporary file opened in the external editor.
    Editor,
}

/// Why the page's structure is being extracted.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum DocumentPurpose {
    Outline,
    Links,
    Extract(ExtractKind, ExtractDestination),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    /// Navigate to a URL or search.
    Open {
        target: OpenTarget,
        disposition: Disposition,
    },
    /// Open the browser's normal new-tab page (`chrome::NewTab`).
    NewTab,
    CloseTab,
    /// Reopen the most recently closed tab.
    RestoreTab,
    NextTab {
        count: u32,
    },
    PreviousTab {
        count: u32,
    },
    SelectTabEdge(TabEdge),
    /// Activate the tab with this host handle (`tabs::TabHandle`). The host
    /// ignores ids that no longer exist.
    ActivateTab {
        id: i32,
    },
    Back {
        count: u32,
    },
    Forward {
        count: u32,
    },
    Reload {
        bypass_cache: bool,
    },
    /// Go up `count` levels in the URL path.
    NavigateUp {
        count: u32,
    },
    /// Go to the root of the current site.
    NavigateRoot,
    Scroll {
        scroll: Scroll,
        count: u32,
        /// Pixels per line scroll, from configuration.
        step: u32,
        /// Animate page-sized jumps.
        smooth: bool,
    },
    /// Focus the ordinary address bar.
    FocusAddressBar,
    /// Open the browser's find bar.
    FindInPage,
    FindNext,
    FindPrevious,
    /// Copy something about the current tab to the clipboard.
    Yank(YankKind),
    /// Read the clipboard and pass its text to `ModalSession::open_text`.
    OpenClipboard {
        disposition: Disposition,
    },
    /// Show the palette. The host gives the session a tab snapshot
    /// (`set_tabs`) and then renders `ModalSession::palette`.
    OpenPalette {
        kind: PaletteKind,
        /// Initial input text, e.g. `"open "` for `o`.
        text: String,
    },
    /// The palette's contents changed; render `ModalSession::palette` again.
    UpdatePalette,
    ClosePalette,
    /// Remove focus from the focused page element so typing stops going
    /// into it (`content::WebContents::ClearFocusedElement`).
    BlurFocusedElement,
    /// Collect hint targets from the page and report them with
    /// `ModalSession::hints_collected`, quoting `generation`.
    CollectHints {
        generation: u32,
        action: HintAction,
    },
    /// Draw these labels over their targets.
    ShowHints {
        hints: Vec<Hint>,
        action: HintAction,
    },
    /// Dim or hide labels that do not start with `typed`.
    FilterHints {
        typed: String,
    },
    HideHints,
    /// Perform the hint action on the host's target `target`.
    ActivateHint {
        target: u32,
        action: HintAction,
    },
    /// Show tabs in a sidebar (Chromium's vertical tab strip) or on top.
    VerticalTabs(Switch),
    /// Collapse or expand the vertical tab sidebar.
    TabSidebar(Switch),
    /// Hide the tabs entirely (the row on top or the sidebar), or show them.
    HideTabs(Switch),
    /// Read the configuration file and pass it to
    /// `ModalSession::load_config`.
    ReloadConfig,
    /// Split the window with a new tab next to the current one, at
    /// `target` or the new-tab page.
    Split {
        layout: SplitLayout,
        target: Option<OpenTarget>,
    },
    /// Move focus to the other half of the split.
    SplitFocusOther,
    /// Swap the two halves of the split.
    SplitSwap,
    /// Turn the current split back into ordinary tabs.
    Unsplit,
    PinTab(Switch),
    NewWindow {
        private: bool,
    },
    /// Snapshot this window's tabs and pass them to
    /// `ModalSession::save_workspace` with `name` and `quiet`.
    SnapshotWorkspace {
        name: String,
        quiet: bool,
    },
    /// Write a workspace file atomically, then show `message` (unless it is
    /// empty) or the error.
    WriteWorkspace {
        name: String,
        contents: String,
        message: String,
    },
    /// Read a workspace file and pass it to `ModalSession::workspace_read`.
    ReadWorkspace {
        name: String,
    },
    DeleteWorkspace {
        name: String,
    },
    /// Open these tabs, in a new window unless this one is empty.
    RestoreWorkspace {
        workspace: Workspace,
        new_window: bool,
    },
    /// Fetch a list for the open palette and pass it to
    /// `ModalSession::set_items`.
    RequestItems(ItemSource),
    ShowBrowserPage(BrowserPage),
    /// One of [`crate::command::BROWSER_COMMANDS`], with its argument (a
    /// download id for the `download-*` ones, else empty), or a native service
    /// command such as `adblock` with its validated operation.
    BrowserCommand {
        name: String,
        arg: String,
    },
    ToggleDevTools,
    /// Bookmark the current page.
    AddBookmark,
    /// Extract the page's structure and pass it to
    /// `ModalSession::document_collected`, quoting `generation`.
    CollectDocument {
        generation: u32,
        purpose: DocumentPurpose,
    },
    /// Scroll a block from the last extraction into view and flash it.
    RevealElement {
        element: u32,
    },
    /// Scroll to the next or previous heading, code block, table, ...
    JumpToBlock {
        kind: BlockJump,
        forward: bool,
        count: u32,
    },
    /// Copy text to the clipboard and say what was copied.
    CopyText {
        text: String,
        what: String,
    },
    /// Open text in the external editor, read-only (nothing is written back).
    OpenInEditor {
        text: String,
        extension: String,
        argv: Vec<String>,
    },
    /// Describe the focused field to `ModalSession::field_info`.
    InspectField {
        force: bool,
    },
    /// Open the focused field in the external editor and write saved text
    /// back into it while it is still the same field on the same page.
    EditField {
        argv: Vec<String>,
    },
    /// Move the selection's focus (Visual mode).
    ExtendSelection {
        forward: bool,
        unit: SelectUnit,
        count: u32,
    },
    ClearSelection,
    /// Read the active page's scroll position and URL, then call
    /// `ModalSession::mark_recorded` with `letter`.
    RecordMark {
        letter: char,
    },
    /// Scroll to a saved position if the active page is `url` (fragment
    /// ignored); otherwise open `url` when `navigate` (marks A-Z), or say
    /// the mark is on another page.
    GoToMark {
        letter: char,
        url: String,
        x: i64,
        y: i64,
        navigate: bool,
    },
    /// Show a short message in the status area.
    ShowMessage {
        level: MessageLevel,
        text: String,
    },
}
