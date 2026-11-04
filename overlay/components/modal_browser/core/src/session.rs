//! The per-window modal state machine.
//!
//! A [`ModalSession`] owns the mode, the pending key buffer and count, the
//! keymap, the command registry, the palette and link-hint state for one
//! browser window. The host feeds it key presses, focus and page changes,
//! timeouts, palette edits and hint targets; each call returns an
//! [`Outcome`] saying whether the key was consumed, which actions to
//! perform, and the resulting mode.
//!
//! Dispatch policy, in order:
//!
//! 1. Keys while browser UI has focus or an IME composition is active are
//!    always forwarded, in every mode.
//! 2. If an editable page element has focus and the mode is Normal or
//!    Visual, the session switches to Insert and forwards the key. Typing in
//!    a text field is never interpreted as a command, even if a focus
//!    notification arrived late.
//! 3. Per mode:
//!    * Insert: `<Esc>` returns to Normal and blurs the field; everything
//!      else is forwarded.
//!    * Passthrough: only the exit key (default `<S-Esc>`) is handled.
//!    * Hint: `<Esc>` cancels, label characters filter, other keys are
//!      swallowed.
//!    * Command: the palette owns focus, so keys arriving here mean the
//!      user clicked back into the page; the palette closes and the key is
//!      handled in Normal mode.
//!    * Normal and Visual: counts, then key-sequence resolution. Unbound keys
//!      with no pending sequence are forwarded so site shortcuts and browser
//!      accelerators keep working. Command-key (`<D-...>`) chords are always
//!      forwarded unless explicitly bound.
//!
//! Timing is owned by the host. When a sequence is ambiguous (`g` is bound
//! and so is `gg`) the outcome carries `timeout_ms`; the host calls
//! [`ModalSession::on_timeout`] if no key arrives in time.

use crate::action::{Action, Disposition, DocumentPurpose, ExtractDestination, MessageLevel};
use std::collections::BTreeMap;

use crate::command::{
    self, AwaitChar, CommandError, CommandOptions, CommandRegistry, Completion, Context, Effects,
    KeymapEdit, MAX_COUNT, SessionEdit,
};
use crate::config::{ConfigError, ConfigFile, SitePattern};
use crate::document::PageDocument;
use crate::editor::{self, EditDecision, FieldInfo};
use crate::focus::{FocusContext, FocusTarget};
use crate::hints::{HintAction, HintAlphabet, HintKind, HintSet, HintStep};
use crate::key::{Key, KeyCode, KeySequence, Modifiers};
use crate::keymap::{Keymap, KeymapError, Lookup, MAX_SEQUENCE_LEN};
use crate::mode::Mode;
use crate::palette::{
    ItemSource, ListItem, MAX_ITEMS, MAX_TABS, Palette, PaletteKey, PaletteKind, PaletteRow,
    TabInfo,
};
use crate::target;
use crate::workspace::{self, WindowTab, Workspace};

/// Command-line history entries kept per session.
const MAX_HISTORY: usize = 100;
/// Tab ids remembered for most-recently-used ordering.
const MAX_MRU: usize = 100;
/// Which-key entries reported after a prefix.
const MAX_WHICH_KEY: usize = 16;
/// Completions shown under the command line.
const MAX_COMPLETIONS: usize = 50;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionConfig {
    /// Modes, bindings and hints are on. Off, every key goes to the page as
    /// in any other browser; the rest of Merlin (its pages, toolbar, palette
    /// from the menu, browserctl) keeps working.
    pub modal_browsing: bool,
    /// Enter Insert mode when an editable element gains focus.
    pub auto_insert: bool,
    /// How long an ambiguous sequence waits for more keys.
    pub sequence_timeout_ms: u32,
    /// The key that leaves Passthrough mode.
    pub passthrough_exit: Key,
    pub hint_alphabet: HintAlphabet,
    pub commands: CommandOptions,
    /// Sites where Passthrough starts automatically.
    pub passthrough_sites: Vec<SitePattern>,
    /// Whether tabs start in a sidebar. The host applies this as the
    /// *default*: a layout the user picked in the browser's own UI wins.
    pub vertical_tabs: bool,
    /// Whether windows start with their tabs hidden (Cmd-S toggles).
    pub hide_tabs: bool,
    /// Reopen the last session's windows at launch (a default; the user's
    /// choice in Settings wins).
    pub restore_session: bool,
    /// Keep a window's workspace file up to date as its tabs change.
    pub workspace_autosave: bool,
    /// Accept requests from `browserctl`.
    pub browserctl: bool,
    /// Editor command for `:edit`; empty means `$VISUAL`/`$EDITOR`.
    pub editor: Vec<String>,
    /// In Insert mode, opens the focused field in the editor.
    pub edit_key: Key,
    /// User-defined commands: name to command line.
    pub aliases: BTreeMap<String, String>,
}

/// Keys a macro may hold, and keys one playback may replay in total.
const MAX_MACRO_KEYS: usize = 1000;
const MAX_PLAYBACK_KEYS: usize = 10_000;

/// A saved position.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mark {
    pub url: String,
    pub x: i64,
    pub y: i64,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            modal_browsing: true,
            auto_insert: true,
            sequence_timeout_ms: 1000,
            passthrough_exit: Key::new(KeyCode::Escape, Modifiers::SHIFT),
            hint_alphabet: HintAlphabet::default(),
            commands: CommandOptions::default(),
            passthrough_sites: Vec::new(),
            vertical_tabs: true,
            hide_tabs: false,
            restore_session: true,
            workspace_autosave: true,
            browserctl: true,
            editor: Vec::new(),
            edit_key: Key::new(KeyCode::Char('e'), Modifiers::CTRL.union(Modifiers::SHIFT)),
            aliases: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyDisposition {
    /// The modal layer handled the key; the page must not see it.
    Consumed,
    /// Let the key continue to Chromium's normal handling and the page.
    Forward,
}

/// One which-key entry: the keys still to type and what they do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyHint {
    pub keys: String,
    pub desc: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outcome {
    pub disposition: KeyDisposition,
    pub actions: Vec<Action>,
    /// Mode after this event.
    pub mode: Mode,
    pub mode_changed: bool,
    /// Pending count and keys for the status display, e.g. `"3g"`; in Hint
    /// mode, the label characters typed so far.
    pub pending: String,
    /// What the pending keys can continue with.
    pub which_key: Vec<KeyHint>,
    /// Call `on_timeout` after this many milliseconds without another key.
    pub timeout_ms: Option<u32>,
    /// Set when a submitted command failed. The palette stays open.
    pub error: Option<String>,
}

/// Result of loading a configuration file.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConfigReport {
    pub errors: Vec<ConfigError>,
    /// Bindings added from `[keys.*]`.
    pub bindings: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Origin {
    /// Entered because of the page (a focused field, a configured site);
    /// ends when that stops being true.
    Auto,
    /// Entered by the user; ends only when the user leaves.
    Manual,
}

#[derive(Debug)]
enum HintState {
    /// Waiting for the host to report targets.
    Collecting {
        generation: u32,
        action: HintAction,
    },
    Showing(HintSet),
}

#[derive(Debug)]
pub struct ModalSession {
    registry: CommandRegistry,
    keymap: Keymap,
    config: SessionConfig,
    mode: Mode,
    insert_origin: Origin,
    passthrough_origin: Origin,
    pending: Vec<Key>,
    count: Option<u32>,
    hints: Option<HintState>,
    hint_generation: u32,
    history: Vec<String>,
    palette: Option<Palette>,
    tabs: Vec<TabInfo>,
    /// Most recently activated tab ids, newest first.
    mru: Vec<i32>,
    host: String,
    /// The last page structure the host extracted, and the request waiting
    /// for one.
    document: Option<PageDocument>,
    document_request: Option<(u32, DocumentPurpose)>,
    document_generation: u32,
    /// The workspace this window was opened from or last saved as.
    workspace: Option<String>,
    /// A private window: nothing is saved to disk from it.
    private: bool,
    /// `$VISUAL` and `$EDITOR` from the host's environment.
    env_visual: String,
    env_editor: String,
    /// The project folder of this window's workspace.
    project: Option<String>,
    /// A command waiting for its letter (`m`, `'`, `q`, `@`), the count
    /// typed before it, and the key that started it (for the status).
    awaiting: Option<(AwaitChar, Option<u32>, Key)>,
    marks: BTreeMap<char, Mark>,
    /// The register being recorded and the keys so far.
    recording: Option<(char, Vec<Key>)>,
    registers: BTreeMap<char, Vec<Key>>,
    last_macro: Option<char>,
    /// Keys replayed so far by the playback in progress.
    playback: Option<usize>,
    /// The count of the binding being run, for commands that wait for a
    /// letter (`3@a`).
    last_count: Option<u32>,
}

impl Default for ModalSession {
    fn default() -> Self {
        Self::new()
    }
}

impl ModalSession {
    /// A session with built-in commands and default bindings.
    pub fn new() -> Self {
        let registry = CommandRegistry::with_builtins();
        let keymap = Keymap::with_defaults(&registry);
        Self::with_parts(registry, keymap, SessionConfig::default())
    }

    pub fn with_parts(registry: CommandRegistry, keymap: Keymap, config: SessionConfig) -> Self {
        Self {
            registry,
            keymap,
            config,
            mode: Mode::Normal,
            insert_origin: Origin::Auto,
            passthrough_origin: Origin::Manual,
            pending: Vec::new(),
            count: None,
            hints: None,
            hint_generation: 0,
            history: Vec::new(),
            palette: None,
            tabs: Vec::new(),
            mru: Vec::new(),
            host: String::new(),
            document: None,
            document_request: None,
            document_generation: 0,
            workspace: None,
            private: false,
            env_visual: String::new(),
            env_editor: String::new(),
            project: None,
            awaiting: None,
            marks: BTreeMap::new(),
            recording: None,
            registers: BTreeMap::new(),
            last_macro: None,
            playback: None,
            last_count: None,
        }
    }

    pub fn project(&self) -> Option<&str> {
        self.project.as_deref()
    }

    /// The register being recorded, for the status display.
    pub fn recording(&self) -> Option<char> {
        self.recording.as_ref().map(|(r, _)| *r)
    }

    /// The host's answer to [`Action::RecordMark`].
    pub fn mark_recorded(&mut self, letter: char, url: &str, x: i64, y: i64) -> Outcome {
        let before = self.mode;
        let action = if letter.is_ascii_alphabetic() && !url.is_empty() {
            self.marks.insert(
                letter,
                Mark {
                    url: url.chars().take(8192).collect(),
                    x: x.clamp(0, 10_000_000),
                    y: y.clamp(0, 10_000_000),
                },
            );
            Action::ShowMessage {
                level: MessageLevel::Info,
                text: format!("Mark {letter} set"),
            }
        } else {
            Action::ShowMessage {
                level: MessageLevel::Error,
                text: "Could not read the page position".into(),
            }
        };
        self.finish(before, KeyDisposition::Consumed, vec![action])
    }

    /// Tells the session about its window. Private windows never write
    /// workspaces.
    pub fn set_window(&mut self, private: bool) {
        self.private = private;
    }

    /// The host's `$VISUAL` and `$EDITOR`, for `:edit` without an
    /// `editor` option.
    pub fn set_environment(&mut self, visual: &str, editor: &str) {
        self.env_visual = visual.chars().take(1024).collect();
        self.env_editor = editor.chars().take(1024).collect();
    }

    /// Associates the window with a workspace (it was opened from one).
    pub fn set_workspace(&mut self, name: &str, project: Option<&str>) {
        self.workspace = workspace::validate_name(name).ok().map(str::to_string);
        self.project = project
            .filter(|_| self.workspace.is_some())
            .and_then(|p| workspace::validate_project(p).ok());
    }

    /// The window's workspace, if it should be saved automatically as it
    /// changes.
    pub fn autosave_workspace(&self) -> Option<&str> {
        if self.config.workspace_autosave && !self.private {
            self.workspace.as_deref()
        } else {
            None
        }
    }

    pub fn workspace(&self) -> Option<&str> {
        self.workspace.as_deref()
    }

    pub fn document(&self) -> Option<&PageDocument> {
        self.document.as_ref()
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// The label for the mode indicator; empty while modal browsing is off,
    /// so the status shows no mode.
    pub fn mode_indicator(&self) -> &'static str {
        if self.config.modal_browsing {
            self.mode.indicator()
        } else {
            ""
        }
    }

    pub fn registry(&self) -> &CommandRegistry {
        &self.registry
    }

    pub fn keymap(&self) -> &Keymap {
        &self.keymap
    }

    /// Normal-mode bindings as (keys, command, description), most useful
    /// first, for Merlin Settings. Several keys for one command are joined
    /// with two spaces.
    pub fn key_bindings(&self) -> Vec<(String, String, String)> {
        command_rows(&self.registry, &self.keymap)
            .into_iter()
            .filter(|r| !r.keys.is_empty())
            .map(|r| (r.keys, r.accept, r.primary))
            .collect()
    }

    pub fn config(&self) -> &SessionConfig {
        &self.config
    }

    pub fn history(&self) -> &[String] {
        &self.history
    }

    /// The open palette, if any.
    pub fn palette(&self) -> Option<&Palette> {
        self.palette.as_ref()
    }

    /// Hints currently on screen, if any.
    pub fn hints(&self) -> Option<&HintSet> {
        match &self.hints {
            Some(HintState::Showing(set)) => Some(set),
            _ => None,
        }
    }

    /// Pending count and keys, for the status display.
    pub fn pending_display(&self) -> String {
        if let Some(HintState::Showing(set)) = &self.hints {
            return set.typed().to_string();
        }
        if let Some((_, count, key)) = &self.awaiting {
            let mut s = count.map(|c| c.to_string()).unwrap_or_default();
            s.push_str(&key.to_string());
            return s;
        }
        let mut s = self.count.map(|c| c.to_string()).unwrap_or_default();
        s.push_str(&KeySequence::new(self.pending.clone()).to_string());
        if let Some((r, _)) = &self.recording
            && s.is_empty()
        {
            return format!("recording @{r}");
        }
        s
    }

    pub fn bind(&mut self, mode: Mode, keys: &str, command: &str) -> Result<(), KeymapError> {
        self.keymap.bind(mode, keys, command, &self.registry)?;
        Ok(())
    }

    pub fn unbind(&mut self, mode: Mode, keys: &str) -> Result<bool, KeymapError> {
        self.keymap.unbind(mode, keys)
    }

    // -- Host events ---------------------------------------------------------

    pub fn handle_key(&mut self, key: Key, focus: &FocusContext) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        if !self.config.modal_browsing {
            return self.finish(before, KeyDisposition::Forward, actions);
        }
        let recordable = matches!(self.mode, Mode::Normal | Mode::Visual | Mode::Hint)
            && !focus.is_off_limits()
            && !focus.is_editable()
            && self.recording.is_some();
        let disposition = self.dispatch(key, focus, &mut actions);
        // Keys the modal layer handled become part of a macro being
        // recorded (not the `q` that stopped it, nor keys the page got).
        if recordable
            && disposition == KeyDisposition::Consumed
            && self.playback.is_none()
            && let Some((_, keys)) = &mut self.recording
            && keys.len() < MAX_MACRO_KEYS
        {
            keys.push(key);
        }
        self.finish(before, disposition, actions)
    }

    /// Called when keyboard focus moves within the page or between tabs.
    pub fn on_focus_changed(&mut self, focus: &FocusContext) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        if !self.config.modal_browsing {
            return self.finish(before, KeyDisposition::Forward, actions);
        }
        match (self.mode, focus.is_editable()) {
            (Mode::Normal | Mode::Visual, true) if self.config.auto_insert => {
                self.enter_auto_insert();
            }
            (Mode::Hint, true) if self.config.auto_insert => {
                // A hint selected a text field: hide hints and start typing.
                actions.push(Action::HideHints);
                self.enter_auto_insert();
            }
            (Mode::Insert, false)
                if self.insert_origin == Origin::Auto && focus.target != FocusTarget::BrowserUi =>
            {
                self.set_mode(Mode::Normal);
            }
            _ => {}
        }
        self.finish(before, KeyDisposition::Forward, actions)
    }

    /// Called when the active tab's page changes (a navigation committed or
    /// another tab became active). `host` is the page's host name, empty for
    /// pages without one.
    ///
    /// Hints and Insert mode end, as qutebrowser does on load, and
    /// `passthrough_sites` decide whether Passthrough starts or ends.
    pub fn on_page_changed(&mut self, host: &str) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        self.host = host.chars().take(253).collect();
        // Structure from the old page must not be offered for the new one.
        self.document = None;
        self.document_request = None;
        match self.mode {
            Mode::Hint => {
                self.hints = None;
                actions.push(Action::HideHints);
                self.set_mode(Mode::Normal);
            }
            Mode::Insert | Mode::Visual => self.set_mode(Mode::Normal),
            _ => {}
        }
        if let Some(p) = &self.palette
            && matches!(p.kind, PaletteKind::Outline | PaletteKind::Links)
        {
            self.close_palette(&mut actions);
        }
        let site_wants_passthrough = self
            .config
            .passthrough_sites
            .iter()
            .any(|p| p.matches(&self.host))
            && self.config.modal_browsing;
        match self.mode {
            Mode::Normal if site_wants_passthrough => {
                self.set_mode(Mode::Passthrough);
                self.passthrough_origin = Origin::Auto;
                actions.push(Action::ShowMessage {
                    level: MessageLevel::Info,
                    text: format!(
                        "Passthrough on {} · {} returns to Normal",
                        self.host, self.config.passthrough_exit
                    ),
                });
            }
            Mode::Passthrough
                if self.passthrough_origin == Origin::Auto && !site_wants_passthrough =>
            {
                self.set_mode(Mode::Normal);
            }
            _ => {}
        }
        self.finish(before, KeyDisposition::Forward, actions)
    }

    /// Resolves an ambiguous or stale pending sequence after the timeout.
    pub fn on_timeout(&mut self) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        if !self.pending.is_empty() {
            let pending = std::mem::take(&mut self.pending);
            let count = self.count.take();
            let command = match self.keymap.lookup(self.mode, &pending) {
                Lookup::Exact(b) | Lookup::ExactAndPrefix(b) => Some(b.command.clone()),
                _ => None,
            };
            if let Some(command) = command {
                self.run_binding(&command, count, &mut actions);
            }
        } else {
            self.count = None;
        }
        self.finish(before, KeyDisposition::Consumed, actions)
    }

    /// The window's tabs in strip order. Hosts call this before rendering a
    /// palette and before running commands that refer to tabs.
    pub fn set_tabs(&mut self, tabs: Vec<TabInfo>) {
        self.tabs = tabs
            .into_iter()
            .take(MAX_TABS)
            .map(TabInfo::bounded)
            .collect();
        if let Some(id) = self.tabs.iter().find(|t| t.active).map(|t| t.id) {
            self.touch_mru(id);
        }
        // Keep an open tab palette in step with the strip, without moving
        // the selection off the tab the user picked.
        if let Some(palette) = &mut self.palette
            && palette.kind == PaletteKind::Tabs
        {
            let selected_id = palette.selected_row().and_then(|r| r.tab_id);
            palette.items = tab_rows(&self.tabs, &self.mru);
            palette.filter_items();
            if let Some(i) =
                selected_id.and_then(|id| palette.rows.iter().position(|r| r.tab_id == Some(id)))
            {
                palette.selected = Some(i);
            }
        }
    }

    /// Records that a tab became active, for most-recently-used ordering.
    pub fn on_tab_activated(&mut self, id: i32) {
        self.touch_mru(id);
    }

    fn touch_mru(&mut self, id: i32) {
        self.mru.retain(|&x| x != id);
        self.mru.insert(0, id);
        self.mru.truncate(MAX_MRU);
    }

    /// The host's answer to [`Action::CollectHints`]: one kind per target,
    /// in the host's order. Late answers (after Esc, or for an older
    /// request) are ignored.
    pub fn hints_collected(&mut self, generation: u32, kinds: &[HintKind]) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        let action = match &self.hints {
            Some(HintState::Collecting {
                generation: g,
                action,
            }) if *g == generation && self.mode == Mode::Hint => *action,
            _ => return self.finish(before, KeyDisposition::Consumed, actions),
        };
        let set = HintSet::new(action, kinds, &self.config.hint_alphabet);
        if set.is_empty() {
            self.hints = None;
            self.set_mode(Mode::Normal);
            actions.push(Action::ShowMessage {
                level: MessageLevel::Info,
                text: match action {
                    HintAction::FocusInput | HintAction::EditInput => {
                        "No text fields on this page".into()
                    }
                    HintAction::OpenInNewTab | HintAction::YankLink => {
                        "No links on this page".into()
                    }
                    HintAction::Follow => "Nothing to click on this page".into(),
                    HintAction::YankCode => "No code blocks in view".into(),
                    HintAction::Select => "No text in view".into(),
                },
            });
        } else if action.acts_on_single_target() && set.hints.len() == 1 {
            // One candidate: act straight away, like Vimium's `gi`.
            let target = set.hints[0].target;
            self.hints = None;
            self.set_mode(Mode::Normal);
            self.push_hint_activation(target, action, &mut actions);
        } else {
            actions.push(Action::ShowHints {
                hints: set.hints.clone(),
                action,
            });
            self.hints = Some(HintState::Showing(set));
        }
        self.finish(before, KeyDisposition::Consumed, actions)
    }

    /// Opens text from outside the command line (the clipboard): a URL if
    /// it looks like one, otherwise a search. Script URLs are refused.
    pub fn open_text(&mut self, text: &str, disposition: Disposition) -> Outcome {
        self.open_text_from(text, disposition, "Clipboard")
    }

    /// Like [`Self::open_text`]; `source` names where the text came from in
    /// error messages ("Clipboard", "browserctl"). On error, the outcome's
    /// `error` is set too.
    pub fn open_text_from(
        &mut self,
        text: &str,
        disposition: Disposition,
        source: &str,
    ) -> Outcome {
        let before = self.mode;
        let (action, error) = match target::classify(text) {
            Ok(target) => (
                Action::Open {
                    target,
                    disposition,
                },
                None,
            ),
            Err(error) => (
                Action::ShowMessage {
                    level: MessageLevel::Error,
                    text: format!("{source}: {error}"),
                },
                Some(error.to_string()),
            ),
        };
        let mut outcome = self.finish(before, KeyDisposition::Consumed, vec![action]);
        outcome.error = error;
        outcome
    }

    // -- Palette --------------------------------------------------------------

    /// The user clicked or scrolled the page with the pointer. Hints are
    /// placed for the old scroll position, so they go away.
    pub fn on_pointer_activity(&mut self) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        if self.mode == Mode::Hint {
            self.cancel_hints(&mut actions);
        }
        self.finish(before, KeyDisposition::Forward, actions)
    }

    /// A row was clicked. In the command line this puts the completion in
    /// the field; elsewhere it selects the row, and the host follows with
    /// [`PaletteKey::Accept`].
    pub fn palette_select(&mut self, index: usize) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        if let Some(p) = &mut self.palette
            && index < p.rows.len()
        {
            p.selected = Some(index);
            if p.kind == PaletteKind::CommandLine {
                if p.cycle_base.is_none() {
                    p.cycle_base = Some(p.text.clone());
                }
                p.text = p.rows[index].accept.clone();
                p.error = None;
            }
            actions.push(Action::UpdatePalette);
        }
        self.finish(before, KeyDisposition::Consumed, actions)
    }

    /// The palette's text field changed (typing, paste, cut).
    pub fn palette_input(&mut self, text: &str) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        if let Some(palette) = &mut self.palette
            && palette.text != text
        {
            palette.text = text.chars().take(command::MAX_COMMAND_LINE_LEN).collect();
            palette.error = None;
            palette.cycle_base = None;
            palette.history_index = None;
            self.refresh_palette_rows();
            actions.push(Action::UpdatePalette);
        }
        self.finish(before, KeyDisposition::Consumed, actions)
    }

    pub fn palette_key(&mut self, key: PaletteKey) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        let Some(kind) = self.palette.as_ref().map(|p| p.kind) else {
            return self.finish(before, KeyDisposition::Consumed, actions);
        };
        match key {
            PaletteKey::Cancel => self.close_palette(&mut actions),
            PaletteKey::Accept => {
                let error = self.accept_palette(&mut actions);
                let mut outcome = self.finish(before, KeyDisposition::Consumed, actions);
                outcome.error = error;
                return outcome;
            }
            PaletteKey::Next | PaletteKey::Previous if kind == PaletteKind::CommandLine => {
                self.cycle_completion(if key == PaletteKey::Next { 1 } else { -1 });
                actions.push(Action::UpdatePalette);
            }
            PaletteKey::Up | PaletteKey::Down if kind == PaletteKind::CommandLine => {
                self.browse_history(key == PaletteKey::Up);
                actions.push(Action::UpdatePalette);
            }
            PaletteKey::Next | PaletteKey::Down => {
                if let Some(p) = &mut self.palette {
                    p.move_selection(1);
                }
                actions.push(Action::UpdatePalette);
            }
            PaletteKey::Previous | PaletteKey::Up => {
                if let Some(p) = &mut self.palette {
                    p.move_selection(-1);
                }
                actions.push(Action::UpdatePalette);
            }
            PaletteKey::Collapse | PaletteKey::Expand => {
                if let Some(p) = &mut self.palette
                    && p.fold_selected(key == PaletteKey::Collapse)
                {
                    actions.push(Action::UpdatePalette);
                }
            }
        }
        self.finish(before, KeyDisposition::Consumed, actions)
    }

    /// Runs `text` as if typed into the `:` line and Enter pressed.
    ///
    /// On success the palette closes and the command's effects apply. On
    /// failure the session stays in Command mode and `error` explains why.
    pub fn submit_command_line(&mut self, text: &str) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        if self.palette.as_ref().map(|p| p.kind) != Some(PaletteKind::CommandLine) {
            // No command line on screen (a CLI, a test): run the line
            // without opening a palette the user cannot see.
            self.remember(text);
            let error = match self.execute(text, None) {
                Ok(effects) => {
                    self.apply(effects, &mut actions);
                    None
                }
                Err(e) => Some(e.to_string()),
            };
            let mut outcome = self.finish(before, KeyDisposition::Consumed, actions);
            outcome.error = error;
            return outcome;
        }
        if let Some(p) = &mut self.palette {
            p.text = text.to_string();
        }
        let error = self.accept_palette(&mut actions);
        let mut outcome = self.finish(before, KeyDisposition::Consumed, actions);
        outcome.error = error;
        outcome
    }

    pub fn cancel_command_line(&mut self) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        self.close_palette(&mut actions);
        self.finish(before, KeyDisposition::Consumed, actions)
    }

    fn close_palette(&mut self, actions: &mut Vec<Action>) {
        if self.palette.take().is_some() {
            actions.push(Action::ClosePalette);
        }
        if self.mode == Mode::Command {
            self.set_mode(Mode::Normal);
        }
    }

    /// Enter in the palette. Returns the error to show, if any.
    fn accept_palette(&mut self, actions: &mut Vec<Action>) -> Option<String> {
        let palette = self.palette.as_ref()?;
        let kind = palette.kind;
        let line = match kind {
            PaletteKind::CommandLine => palette.text.clone(),
            _ => match palette.selected_row() {
                Some(row) => row.accept.clone(),
                None if palette.text.trim().is_empty() => {
                    self.close_palette(actions);
                    return None;
                }
                None => return self.palette_error(actions, "Nothing matches".into()),
            },
        };

        if kind == PaletteKind::CommandLine {
            self.remember(&line);
        }

        // From the command list, a command that needs an argument opens the
        // command line pre-filled instead of failing.
        if kind == PaletteKind::Commands
            && let Ok(inv) = self.registry.parse(&line, None)
            && inv.args.is_empty()
            && self
                .registry
                .get(inv.name)
                .is_some_and(command::needs_argument)
        {
            self.palette = Some(Palette::new(
                PaletteKind::CommandLine,
                format!("{} ", inv.name),
                Vec::new(),
            ));
            self.refresh_palette_rows();
            actions.push(Action::OpenPalette {
                kind: PaletteKind::CommandLine,
                text: format!("{} ", inv.name),
            });
            return None;
        }

        match self.execute(&line, None) {
            Ok(effects) => {
                self.close_palette(actions);
                self.apply(effects, actions);
                None
            }
            Err(error) => self.palette_error(actions, error.to_string()),
        }
    }

    fn palette_error(&mut self, actions: &mut Vec<Action>, error: String) -> Option<String> {
        if let Some(p) = &mut self.palette {
            p.error = Some(error.clone());
        }
        actions.push(Action::UpdatePalette);
        Some(error)
    }

    fn remember(&mut self, line: &str) {
        let trimmed = line.trim();
        if !trimmed.is_empty() && self.history.last().map(String::as_str) != Some(trimmed) {
            if self.history.len() == MAX_HISTORY {
                self.history.remove(0);
            }
            self.history.push(trimmed.to_string());
        }
    }

    fn cycle_completion(&mut self, delta: isize) {
        let Some(p) = &mut self.palette else { return };
        if p.rows.is_empty() {
            return;
        }
        if p.cycle_base.is_none() {
            p.cycle_base = Some(p.text.clone());
        }
        p.move_selection(delta);
        if let Some(row) = p.selected_row() {
            p.text = row.accept.clone();
        }
        p.error = None;
    }

    fn browse_history(&mut self, older: bool) {
        let history_len = self.history.len();
        let Some(p) = &mut self.palette else { return };
        if history_len == 0 {
            return;
        }
        let next = match (p.history_index, older) {
            (None, true) => {
                p.history_draft = p.text.clone();
                Some(history_len - 1)
            }
            (None, false) => return,
            (Some(0), true) => Some(0),
            (Some(i), true) => Some(i - 1),
            (Some(i), false) if i + 1 < history_len => Some(i + 1),
            (Some(_), false) => None,
        };
        p.history_index = next;
        p.text = match next {
            Some(i) => self.history[i].clone(),
            None => std::mem::take(&mut p.history_draft),
        };
        p.cycle_base = None;
        p.error = None;
        self.refresh_palette_rows();
    }

    /// Rebuilds the rows for the current text.
    fn refresh_palette_rows(&mut self) {
        let Some(kind) = self.palette.as_ref().map(|p| p.kind) else {
            return;
        };
        if kind != PaletteKind::CommandLine {
            if let Some(p) = &mut self.palette {
                p.filter_items();
            }
            return;
        }
        let text = self
            .palette
            .as_ref()
            .map(|p| p.text.clone())
            .unwrap_or_default();
        let rows: Vec<PaletteRow> = self
            .completions(&text)
            .into_iter()
            .take(MAX_COMPLETIONS)
            .map(|c| completion_row(&text, c))
            .collect();
        if let Some(p) = &mut self.palette {
            p.rows = rows;
            p.selected = None;
        }
    }

    fn open_palette(&mut self, kind: PaletteKind, text: String, actions: &mut Vec<Action>) {
        let (items, follow_up) = match kind {
            PaletteKind::CommandLine => (Vec::new(), None),
            PaletteKind::Tabs => (tab_rows(&self.tabs, &self.mru), None),
            PaletteKind::Commands => {
                let mut rows = command_rows(&self.registry, &self.keymap);
                rows.extend(self.config.aliases.iter().map(|(name, line)| PaletteRow {
                    primary: name.clone(),
                    secondary: format!("your command: :{line}"),
                    accept: name.clone(),
                    ..PaletteRow::default()
                }));
                (rows, None)
            }
            PaletteKind::History => (Vec::new(), Some(Action::RequestItems(ItemSource::History))),
            PaletteKind::Bookmarks => (
                Vec::new(),
                Some(Action::RequestItems(ItemSource::Bookmarks)),
            ),
            PaletteKind::Workspaces => (
                Vec::new(),
                Some(Action::RequestItems(ItemSource::Workspaces)),
            ),
            PaletteKind::Menu => (menu_rows(&self.keymap), None),
            PaletteKind::Downloads => (
                Vec::new(),
                Some(Action::RequestItems(ItemSource::Downloads)),
            ),
            // The page may have changed since the last extraction (scripts
            // add content), so read it again every time.
            PaletteKind::Outline => (
                Vec::new(),
                Some(self.document_request_action(DocumentPurpose::Outline)),
            ),
            PaletteKind::Links => (
                Vec::new(),
                Some(self.document_request_action(DocumentPurpose::Links)),
            ),
        };
        let mut palette = Palette::new(kind, text.clone(), items);
        palette.loading = follow_up.is_some();
        self.palette = Some(palette);
        self.refresh_palette_rows();
        actions.push(Action::OpenPalette { kind, text });
        actions.extend(follow_up);
    }

    fn document_request_action(&mut self, purpose: DocumentPurpose) -> Action {
        self.document_generation = self.document_generation.wrapping_add(1);
        let generation = self.document_generation;
        self.document_request = Some((generation, purpose));
        Action::CollectDocument {
            generation,
            purpose,
        }
    }

    // -- Host-supplied lists ---------------------------------------------------

    /// The host's answer to [`Action::RequestItems`]. Ignored unless that
    /// palette is still open. `now` is the current time in seconds since
    /// the Unix epoch, for "2 h ago".
    pub fn set_items(&mut self, source: ItemSource, items: Vec<ListItem>, now: i64) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        let current_workspace = self.workspace.clone();
        if let Some(p) = &mut self.palette
            && p.kind == source.palette()
        {
            p.items = items
                .into_iter()
                .take(MAX_ITEMS)
                .map(ListItem::bounded)
                .map(|mut item| {
                    if source == ItemSource::Workspaces {
                        item.current = current_workspace.as_deref() == Some(item.value.as_str());
                    }
                    item_row(source, item, now)
                })
                .collect();
            p.loading = false;
            p.filter_items();
            actions.push(Action::UpdatePalette);
        }
        self.finish(before, KeyDisposition::Consumed, actions)
    }

    // -- Page structure ----------------------------------------------------------

    /// The host's answer to [`Action::CollectDocument`]. Late answers (the
    /// page changed, a newer request) are ignored.
    pub fn document_collected(&mut self, generation: u32, document: PageDocument) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        let Some((expected, purpose)) = self.document_request else {
            return self.finish(before, KeyDisposition::Consumed, actions);
        };
        if expected != generation {
            return self.finish(before, KeyDisposition::Consumed, actions);
        }
        self.document_request = None;
        match purpose {
            DocumentPurpose::Outline | DocumentPurpose::Links => {
                let kind = if purpose == DocumentPurpose::Outline {
                    PaletteKind::Outline
                } else {
                    PaletteKind::Links
                };
                if let Some(p) = &mut self.palette
                    && p.kind == kind
                {
                    p.items = if kind == PaletteKind::Outline {
                        outline_rows(&document)
                    } else {
                        link_rows(&document)
                    };
                    p.loading = false;
                    p.filter_items();
                    actions.push(Action::UpdatePalette);
                }
            }
            DocumentPurpose::Extract(kind, destination) => {
                let text = document.render(kind);
                let what = match kind {
                    crate::document::ExtractKind::Markdown => "page as Markdown",
                    crate::document::ExtractKind::Text => "page text",
                    crate::document::ExtractKind::Links => "links",
                    crate::document::ExtractKind::Code => "code blocks",
                    crate::document::ExtractKind::Headings => "outline",
                };
                if text.trim().is_empty() {
                    actions.push(Action::ShowMessage {
                        level: MessageLevel::Info,
                        text: format!("No {what} to copy on this page"),
                    });
                } else {
                    match destination {
                        ExtractDestination::Clipboard => actions.push(Action::CopyText {
                            text,
                            what: what.to_string(),
                        }),
                        ExtractDestination::Editor => match self.editor_command() {
                            Ok(argv) => actions.push(Action::OpenInEditor {
                                text,
                                extension: kind.extension().to_string(),
                                argv,
                            }),
                            Err(e) => actions.push(Action::ShowMessage {
                                level: MessageLevel::Error,
                                text: e,
                            }),
                        },
                    }
                }
            }
        }
        self.document = Some(document);
        self.finish(before, KeyDisposition::Consumed, actions)
    }

    // -- External editor -----------------------------------------------------------

    fn editor_command(&self) -> Result<Vec<String>, String> {
        editor::command(&self.config.editor, &self.env_visual, &self.env_editor)
    }

    /// The host's answer to [`Action::InspectField`].
    pub fn field_info(&mut self, info: &FieldInfo, force: bool) -> Outcome {
        let before = self.mode;
        let action = match editor::decide(info, force) {
            EditDecision::Refused(why) => Action::ShowMessage {
                level: MessageLevel::Error,
                text: why,
            },
            EditDecision::Allowed => match self.editor_command() {
                Ok(argv) => Action::EditField { argv },
                Err(e) => Action::ShowMessage {
                    level: MessageLevel::Error,
                    text: e,
                },
            },
        };
        self.finish(before, KeyDisposition::Consumed, vec![action])
    }

    // -- Workspaces ----------------------------------------------------------------

    /// The host's answer to [`Action::SnapshotWorkspace`]: this window's
    /// tabs. Produces the file to write. `now` is seconds since the epoch.
    pub fn save_workspace(
        &mut self,
        name: &str,
        quiet: bool,
        tabs: &[WindowTab],
        now: i64,
    ) -> Outcome {
        let before = self.mode;
        let action = if self.private {
            Action::ShowMessage {
                level: MessageLevel::Error,
                text: "Private windows are not saved to disk".into(),
            }
        } else {
            match Workspace::from_window(name, now, tabs, self.project.as_deref()) {
                Ok(ws) => {
                    self.workspace = Some(ws.name.clone());
                    let count = ws.tabs.len();
                    Action::WriteWorkspace {
                        name: ws.name.clone(),
                        contents: ws.encode(),
                        message: if quiet {
                            String::new()
                        } else {
                            format!(
                                "Saved workspace {} ({count} tab{})",
                                ws.name,
                                if count == 1 { "" } else { "s" }
                            )
                        },
                    }
                }
                Err(e) => Action::ShowMessage {
                    level: MessageLevel::Error,
                    text: format!("Workspace: {e}"),
                },
            }
        };
        self.finish(before, KeyDisposition::Consumed, vec![action])
    }

    /// The host's answer to [`Action::ReadWorkspace`].
    pub fn workspace_read(&mut self, name: &str, found: bool, text: &str) -> Outcome {
        let before = self.mode;
        let mut actions = Vec::new();
        if !found {
            actions.push(Action::ShowMessage {
                level: MessageLevel::Error,
                text: format!("No workspace named {name} (:workspace lists them)"),
            });
            return self.finish(before, KeyDisposition::Consumed, actions);
        }
        match Workspace::decode(name, text) {
            Ok((workspace, skipped)) => {
                // Reuse this window only if it holds nothing but a new tab.
                let new_window = !(self.tabs.len() == 1 && is_new_tab_page(&self.tabs[0].url));
                if !new_window {
                    self.workspace = Some(workspace.name.clone());
                    self.project = workspace.project.clone();
                }
                let count = workspace.tabs.len();
                let mut text = format!(
                    "Opened workspace {} ({count} tab{})",
                    workspace.name,
                    if count == 1 { "" } else { "s" }
                );
                if skipped > 0 {
                    text.push_str(&format!("; skipped {skipped} that cannot be reopened"));
                }
                actions.push(Action::RestoreWorkspace {
                    workspace,
                    new_window,
                });
                actions.push(Action::ShowMessage {
                    level: MessageLevel::Info,
                    text,
                });
            }
            Err(e) => actions.push(Action::ShowMessage {
                level: MessageLevel::Error,
                text: format!("Workspace {name}: {e}"),
            }),
        }
        self.finish(before, KeyDisposition::Consumed, actions)
    }

    /// Runs a command outside the palette (bindings from a CLI, tests).
    pub fn run_command(&mut self, line: &str) -> Result<Outcome, CommandError> {
        let before = self.mode;
        let effects = self.execute(line, None)?;
        let mut actions = Vec::new();
        self.apply(effects, &mut actions);
        Ok(self.finish(before, KeyDisposition::Consumed, actions))
    }

    pub fn complete(&self, text: &str) -> Vec<Completion> {
        self.completions(text)
    }

    /// Registry completions plus user-defined commands.
    fn completions(&self, text: &str) -> Vec<Completion> {
        let mut out = self.registry.complete_in(text, &self.tabs);
        let typed = text.trim_start().trim_start_matches(':');
        if !typed.contains(char::is_whitespace) {
            let aliases = self
                .config
                .aliases
                .iter()
                .filter(|(name, _)| name.starts_with(typed))
                .map(|(name, line)| Completion {
                    text: name.clone(),
                    summary: format!("your command: :{line}"),
                });
            out.splice(0..0, aliases);
        }
        out
    }

    // -- Configuration --------------------------------------------------------

    /// Replaces options and bindings with the defaults plus `text`, the
    /// contents of the configuration file (empty when there is none).
    ///
    /// Every error is reported with its line; everything valid applies.
    pub fn load_config(&mut self, text: &str) -> ConfigReport {
        let (file, mut errors) = ConfigFile::parse(text);
        let mut config = SessionConfig::default();
        if let Some(v) = file.modal_browsing {
            config.modal_browsing = v;
        }
        if let Some(v) = file.sequence_timeout_ms {
            config.sequence_timeout_ms = v;
        }
        if let Some(v) = file.hint_chars {
            config.hint_alphabet = v;
        }
        if let Some(v) = file.auto_insert {
            config.auto_insert = v;
        }
        if let Some(v) = file.passthrough_exit {
            config.passthrough_exit = v;
        }
        if let Some(v) = file.scroll_step {
            config.commands.scroll_step = v;
        }
        if let Some(v) = file.smooth_scroll {
            config.commands.smooth_scroll = v;
        }
        if let Some(v) = file.passthrough_sites {
            config.passthrough_sites = v;
        }
        if let Some(v) = file.vertical_tabs {
            config.vertical_tabs = v;
        }
        if let Some(v) = file.hide_tabs {
            config.hide_tabs = v;
        }
        if let Some(v) = file.restore_session {
            config.restore_session = v;
        }
        if let Some(v) = file.workspace_autosave {
            config.workspace_autosave = v;
        }
        if let Some(v) = file.browserctl {
            config.browserctl = v;
        }
        if let Some(v) = file.editor {
            config.editor = v;
        }
        if let Some(v) = file.edit_key {
            config.edit_key = v;
        }
        for a in &file.aliases {
            if self.registry.get(&a.name).is_some() {
                errors.push(ConfigError {
                    line: a.line,
                    message: format!("'{}' is a built-in command; pick another name", a.name),
                });
                continue;
            }
            // The expansion must be a valid command (aliases of aliases are
            // not expanded, so an alias cannot loop).
            match self.registry.parse(&a.command, None) {
                Ok(_) => {
                    config.aliases.insert(a.name.clone(), a.command.clone());
                }
                Err(e) => errors.push(ConfigError {
                    line: a.line,
                    message: format!("alias '{}': {e}", a.name),
                }),
            }
        }
        let mut keymap = Keymap::with_defaults(&self.registry);
        for u in &file.unmaps {
            match keymap.unbind(u.mode, &u.keys) {
                Ok(true) => {}
                Ok(false) => errors.push(ConfigError {
                    line: u.line,
                    message: format!("'{}' is not bound in {} mode", u.keys, u.mode),
                }),
                Err(e) => errors.push(ConfigError {
                    line: u.line,
                    message: e.to_string(),
                }),
            }
        }
        let mut bindings = 0;
        for m in &file.maps {
            let command = command::expand_alias(&config.aliases, &m.command)
                .unwrap_or_else(|| m.command.clone());
            match keymap.bind(m.mode, &m.keys, &command, &self.registry) {
                Ok(_) => bindings += 1,
                Err(e) => errors.push(ConfigError {
                    line: m.line,
                    message: e.to_string(),
                }),
            }
        }
        errors.sort_by_key(|e| e.line);
        self.config = config;
        self.keymap = keymap;
        self.clear_pending();
        if !self.config.modal_browsing {
            // Leave whatever mode the window was in; the host hides hints
            // and the palette.
            self.set_mode(Mode::Normal);
            self.hints = None;
            self.palette = None;
            self.recording = None;
            self.playback = None;
        }
        ConfigReport { errors, bindings }
    }

    // -- Internals -----------------------------------------------------------

    fn execute(&self, line: &str, count: Option<u32>) -> Result<Effects, CommandError> {
        let ctx = Context {
            registry: &self.registry,
            tabs: &self.tabs,
            options: &self.config.commands,
            workspace: self.workspace.as_deref(),
            private: self.private,
            aliases: &self.config.aliases,
        };
        match ctx.expand_alias(line) {
            Some(expanded) => self.registry.execute_in(&expanded, count, &ctx),
            None => self.registry.execute_in(line, count, &ctx),
        }
    }

    fn dispatch(
        &mut self,
        key: Key,
        focus: &FocusContext,
        actions: &mut Vec<Action>,
    ) -> KeyDisposition {
        if focus.is_off_limits() {
            return KeyDisposition::Forward;
        }

        if focus.is_editable()
            && matches!(self.mode, Mode::Normal | Mode::Visual | Mode::Insert)
            && key == self.config.edit_key
        {
            // The one key taken from a text field: open it in the editor.
            if self.mode != Mode::Insert {
                self.enter_auto_insert();
            }
            actions.push(Action::InspectField { force: false });
            return KeyDisposition::Consumed;
        }

        if focus.is_editable() && matches!(self.mode, Mode::Normal | Mode::Visual) {
            // Never hijack typing, even if we missed the focus notification.
            self.awaiting = None;
            self.enter_auto_insert();
            return KeyDisposition::Forward;
        }

        if matches!(self.mode, Mode::Normal | Mode::Visual)
            && let Some((what, count, _)) = self.awaiting.take()
        {
            if key.is_escape() {
                return KeyDisposition::Consumed;
            }
            match key.typed_char() {
                Some(c)
                    if c.is_ascii_alphabetic() || (c == '@' && what == AwaitChar::PlayMacro) =>
                {
                    self.run_binding(&what.command(c), count, actions);
                }
                _ => actions.push(Action::ShowMessage {
                    level: MessageLevel::Error,
                    text: "Expected a letter".into(),
                }),
            }
            return KeyDisposition::Consumed;
        }

        match self.mode {
            Mode::Insert => {
                if key.is_escape() {
                    if focus.is_editable() {
                        actions.push(Action::BlurFocusedElement);
                    }
                    self.set_mode(Mode::Normal);
                    KeyDisposition::Consumed
                } else {
                    KeyDisposition::Forward
                }
            }
            Mode::Passthrough => {
                if key == self.config.passthrough_exit {
                    self.set_mode(Mode::Normal);
                    KeyDisposition::Consumed
                } else {
                    KeyDisposition::Forward
                }
            }
            Mode::Hint => {
                if key.mods().contains(Modifiers::META) {
                    // Browser shortcuts still work; hints go away first.
                    self.cancel_hints(actions);
                    return KeyDisposition::Forward;
                }
                self.hint_key(key, actions);
                KeyDisposition::Consumed
            }
            Mode::Command => {
                self.close_palette(actions);
                // Re-dispatch so the editable-focus rule applies to this key.
                self.dispatch(key, focus, actions)
            }
            Mode::Normal | Mode::Visual => self.sequence_key(key, actions),
        }
    }

    /// Activates a chosen hint target, plus what follows from the action.
    fn push_hint_activation(&mut self, target: u32, action: HintAction, actions: &mut Vec<Action>) {
        actions.push(Action::ActivateHint { target, action });
        match action {
            // The field gets focus first; scripts in one frame run in
            // order, so the inspection sees it focused.
            HintAction::EditInput => actions.push(Action::InspectField { force: false }),
            HintAction::Select => self.set_mode(Mode::Visual),
            _ => {}
        }
    }

    fn cancel_hints(&mut self, actions: &mut Vec<Action>) {
        self.hints = None;
        actions.push(Action::HideHints);
        self.set_mode(Mode::Normal);
    }

    fn hint_key(&mut self, key: Key, actions: &mut Vec<Action>) {
        if key.is_escape() {
            self.cancel_hints(actions);
            return;
        }
        let Some(HintState::Showing(set)) = &mut self.hints else {
            // Still collecting: swallow keys until hints appear.
            return;
        };
        if key.code() == KeyCode::Backspace && key.mods().is_empty() {
            if set.pop() {
                actions.push(Action::FilterHints {
                    typed: set.typed().to_string(),
                });
            }
            return;
        }
        let Some(c) = key.typed_char().filter(|c| !c.is_whitespace()) else {
            // Anything else is swallowed so it cannot reach the page while
            // hints cover it.
            return;
        };
        match set.push(c) {
            HintStep::Narrowed => actions.push(Action::FilterHints {
                typed: set.typed().to_string(),
            }),
            HintStep::Chosen(hint) => {
                let action = set.action;
                self.hints = None;
                actions.push(Action::HideHints);
                self.set_mode(Mode::Normal);
                self.push_hint_activation(hint.target, action, actions);
            }
            HintStep::Rejected => {}
        }
    }

    fn sequence_key(&mut self, key: Key, actions: &mut Vec<Action>) -> KeyDisposition {
        if key.is_escape() {
            if self.pending.is_empty() && self.count.is_none() {
                if self.mode == Mode::Visual {
                    actions.push(Action::ClearSelection);
                    self.set_mode(Mode::Normal);
                    return KeyDisposition::Consumed;
                }
                // Nothing to cancel: the page may need Escape (closing its
                // own dialogs, stopping media).
                return KeyDisposition::Forward;
            }
            self.clear_pending();
            return KeyDisposition::Consumed;
        }

        if self.pending.is_empty()
            && self.count.is_none()
            && self.playback.is_none()
            && key == Key::char('q')
            && let Some((register, keys)) = self.recording.take()
        {
            let n = keys.len();
            self.registers.insert(register, keys);
            actions.push(Action::ShowMessage {
                level: MessageLevel::Info,
                text: format!(
                    "Recorded @{register} ({n} key{})",
                    if n == 1 { "" } else { "s" }
                ),
            });
            return KeyDisposition::Consumed;
        }

        if self.pending.is_empty()
            && let Some(d) = key.digit()
            && (d != 0 || self.count.is_some())
        {
            let next = self.count.unwrap_or(0).saturating_mul(10).saturating_add(d);
            self.count = Some(next.min(MAX_COUNT));
            return KeyDisposition::Consumed;
        }

        let mut sequence = self.pending.clone();
        sequence.push(key);
        let lookup = self.keymap.lookup(self.mode, &sequence);
        match lookup {
            Lookup::Exact(binding) => {
                let command = binding.command.clone();
                let count = self.count.take();
                self.pending.clear();
                self.run_binding(&command, count, actions);
                KeyDisposition::Consumed
            }
            Lookup::Prefix | Lookup::ExactAndPrefix(_) if sequence.len() < MAX_SEQUENCE_LEN => {
                self.pending = sequence;
                KeyDisposition::Consumed
            }
            Lookup::Prefix | Lookup::ExactAndPrefix(_) | Lookup::NoMatch => {
                if self.pending.is_empty() {
                    let had_count = self.count.take().is_some();
                    // Unbound key with nothing pending: it belongs to the page
                    // or to a browser accelerator. A dangling count is
                    // dropped, Vim style, and the key is still swallowed.
                    if had_count && !key.mods().contains(Modifiers::META) {
                        return KeyDisposition::Consumed;
                    }
                    return KeyDisposition::Forward;
                }
                // The pending sequence cannot be extended by this key. If the
                // pending keys form a binding on their own (`g` while `gg`
                // exists), run it, then treat this key as a fresh press.
                let pending = std::mem::take(&mut self.pending);
                let count = self.count.take();
                let shorter = match self.keymap.lookup(self.mode, &pending) {
                    Lookup::Exact(b) | Lookup::ExactAndPrefix(b) => Some(b.command.clone()),
                    _ => None,
                };
                if let Some(command) = shorter {
                    self.run_binding(&command, count, actions);
                    if self.mode.accepts_bindings() {
                        return self.sequence_key(key, actions);
                    }
                    return KeyDisposition::Consumed;
                }
                if key.mods().contains(Modifiers::META) {
                    // Browser shortcuts such as Cmd+T must keep working even
                    // in the middle of a broken sequence.
                    return KeyDisposition::Forward;
                }
                KeyDisposition::Consumed
            }
        }
    }

    fn run_binding(&mut self, command: &str, count: Option<u32>, actions: &mut Vec<Action>) {
        self.last_count = count;
        match self.execute(command, count) {
            Ok(effects) => self.apply(effects, actions),
            Err(error) => actions.push(Action::ShowMessage {
                level: MessageLevel::Error,
                text: error.to_string(),
            }),
        }
        self.last_count = None;
    }

    fn apply(&mut self, effects: Effects, actions: &mut Vec<Action>) {
        for action in effects.actions {
            match action {
                Action::CollectHints { action, .. } => {
                    self.hint_generation = self.hint_generation.wrapping_add(1);
                    let generation = self.hint_generation;
                    self.hints = Some(HintState::Collecting { generation, action });
                    actions.push(Action::CollectHints { generation, action });
                }
                Action::OpenPalette { kind, text } => self.open_palette(kind, text, actions),
                Action::CollectDocument { purpose, .. } => {
                    let action = self.document_request_action(purpose);
                    actions.push(action);
                }
                other => actions.push(other),
            }
        }
        for edit in effects.keymap_edits {
            let result = match &edit {
                KeymapEdit::Map {
                    mode,
                    keys,
                    command,
                } => self
                    .keymap
                    .bind(*mode, keys, command, &self.registry)
                    .map(|_| format!("Mapped {keys} to :{command}")),
                KeymapEdit::Unmap { mode, keys } => {
                    self.keymap.unbind(*mode, keys).map(|existed| {
                        if existed {
                            format!("Unmapped {keys}")
                        } else {
                            format!("{keys} was not mapped")
                        }
                    })
                }
            };
            actions.push(match result {
                Ok(text) => Action::ShowMessage {
                    level: MessageLevel::Info,
                    text,
                },
                Err(e) => Action::ShowMessage {
                    level: MessageLevel::Error,
                    text: e.to_string(),
                },
            });
        }
        if let Some(what) = effects.await_char {
            let key = match what {
                AwaitChar::SetMark => Key::char('m'),
                AwaitChar::GoToMark => Key::char('\''),
                AwaitChar::RecordMacro => Key::char('q'),
                AwaitChar::PlayMacro => Key::char('@'),
            };
            self.awaiting = Some((what, self.last_count, key));
        }
        for edit in effects.session_edits {
            self.apply_session_edit(edit, actions);
        }
        if let Some(mode) = effects.enter_mode {
            if mode == Mode::Insert {
                self.insert_origin = Origin::Manual;
            }
            if mode == Mode::Passthrough {
                self.passthrough_origin = Origin::Manual;
            }
            if mode != Mode::Hint && self.mode == Mode::Hint {
                self.hints = None;
            }
            self.set_mode(mode);
        }
    }

    fn apply_session_edit(&mut self, edit: SessionEdit, actions: &mut Vec<Action>) {
        let info = |text: String| Action::ShowMessage {
            level: MessageLevel::Info,
            text,
        };
        let error = |text: String| Action::ShowMessage {
            level: MessageLevel::Error,
            text,
        };
        match edit {
            SessionEdit::SetProject(project) => {
                actions.push(info(match &project {
                    Some(p) => format!("Workspace project: {p}"),
                    None => "Workspace project cleared".into(),
                }));
                self.project = project;
                // Keep the file in step when the window has a workspace.
                if let Some(name) = self.autosave_workspace() {
                    actions.push(Action::SnapshotWorkspace {
                        name: name.to_string(),
                        quiet: true,
                    });
                }
            }
            SessionEdit::GoToMark(letter) => match self.marks.get(&letter) {
                Some(mark) => actions.push(Action::GoToMark {
                    letter,
                    url: mark.url.clone(),
                    x: mark.x,
                    y: mark.y,
                    navigate: letter.is_ascii_uppercase(),
                }),
                None => actions.push(error(format!("Mark {letter} is not set"))),
            },
            SessionEdit::ListMarks => {
                if self.marks.is_empty() {
                    actions.push(info("No marks (m then a letter sets one)".into()));
                } else {
                    let mut text = String::from("Marks:");
                    for (letter, mark) in &self.marks {
                        text.push_str(&format!("\n  {letter}  {}  (y {})", mark.url, mark.y));
                    }
                    actions.push(info(text));
                }
            }
            SessionEdit::StartRecording(register) => {
                self.recording = Some((register, Vec::new()));
                actions.push(info(format!("Recording @{register} (q stops)")));
            }
            SessionEdit::StopRecording => match self.recording.take() {
                Some((register, keys)) => {
                    let n = keys.len();
                    self.registers.insert(register, keys);
                    actions.push(info(format!("Recorded @{register} ({n} keys)")));
                }
                None => actions.push(error("Not recording".into())),
            },
            SessionEdit::PlayMacro { register, count } => {
                if self.playback.is_some() {
                    return; // a macro may not play macros
                }
                let Some(register) = register.or(self.last_macro) else {
                    actions.push(error("No macro played yet".into()));
                    return;
                };
                let Some(keys) = self.registers.get(&register).cloned() else {
                    actions.push(error(format!("Register {register} is empty")));
                    return;
                };
                self.last_macro = Some(register);
                self.playback = Some(0);
                'outer: for _ in 0..count.clamp(1, MAX_COUNT) {
                    for key in &keys {
                        let replayed = self.playback.unwrap_or(0);
                        if replayed >= MAX_PLAYBACK_KEYS {
                            actions.push(error("Stopped the macro after 10000 keys".into()));
                            break 'outer;
                        }
                        self.playback = Some(replayed + 1);
                        // Replayed as on the page; keys the page would have
                        // received are dropped.
                        let _ = self.dispatch(*key, &FocusContext::PAGE, actions);
                    }
                }
                self.playback = None;
            }
        }
    }

    fn enter_auto_insert(&mut self) {
        self.insert_origin = Origin::Auto;
        self.set_mode(Mode::Insert);
    }

    fn set_mode(&mut self, mode: Mode) {
        if mode != self.mode {
            self.clear_pending();
            if self.mode == Mode::Hint {
                self.hints = None;
            }
        }
        self.mode = mode;
    }

    fn clear_pending(&mut self) {
        self.pending.clear();
        self.count = None;
        self.awaiting = None;
    }

    fn which_key(&self) -> Vec<KeyHint> {
        if self.pending.is_empty() || !self.mode.accepts_bindings() {
            return Vec::new();
        }
        let mut hints: Vec<KeyHint> = self
            .keymap
            .continuations(self.mode, &self.pending)
            .into_iter()
            .map(|(keys, b)| KeyHint {
                keys: keys.to_string(),
                desc: b.description().to_string(),
            })
            .collect();
        // Case-insensitive, so `t`/`T` and `u`/`U` sit together.
        hints.sort_by_key(|h| (h.keys.to_lowercase(), h.keys.clone()));
        hints.truncate(MAX_WHICH_KEY);
        hints
    }

    fn finish(&self, before: Mode, disposition: KeyDisposition, actions: Vec<Action>) -> Outcome {
        let ambiguous = !self.pending.is_empty();
        Outcome {
            disposition,
            actions,
            mode: self.mode,
            mode_changed: self.mode != before,
            pending: self.pending_display(),
            which_key: self.which_key(),
            timeout_ms: (ambiguous || self.count.is_some())
                .then_some(self.config.sequence_timeout_ms),
            error: None,
        }
    }
}

/// Rows for the tab switcher: most recently used first, the current tab
/// last (so Enter on an empty query goes back to the previous tab).
fn tab_rows(tabs: &[TabInfo], mru: &[i32]) -> Vec<PaletteRow> {
    let rank = |id: i32| mru.iter().position(|&x| x == id).unwrap_or(usize::MAX);
    let mut order: Vec<(usize, &TabInfo)> = tabs.iter().enumerate().collect();
    order.sort_by_key(|(i, t)| (t.active, rank(t.id), *i));
    order
        .into_iter()
        .map(|(i, t)| PaletteRow {
            primary: if t.title.trim().is_empty() {
                t.url.clone()
            } else {
                t.title.clone()
            },
            secondary: t.url.clone(),
            keys: (i + 1).to_string(),
            tab_id: Some(t.id),
            active: t.active,
            accept: format!("buffer {}", i + 1),
            ..PaletteRow::default()
        })
        .collect()
}

/// Rows for the command list: every binding (grouped by command, with its
/// keys), then commands without a binding.
fn command_rows(registry: &CommandRegistry, keymap: &Keymap) -> Vec<PaletteRow> {
    let mut rows: Vec<PaletteRow> = Vec::new();
    for (keys, binding) in keymap.bindings(Mode::Normal) {
        if let Some(row) = rows.iter_mut().find(|r| r.accept == binding.command) {
            row.keys.push_str("  ");
            row.keys.push_str(&keys.to_string());
            continue;
        }
        rows.push(PaletteRow {
            primary: binding.description().to_string(),
            secondary: format!(":{}", binding.command),
            keys: keys.to_string(),
            accept: binding.command.clone(),
            ..PaletteRow::default()
        });
    }
    // The default table is ordered most useful first; the user's own
    // bindings follow it. Within a row, the shortest keys come first.
    let rank = |command: &str| {
        crate::keymap::DEFAULT_NORMAL
            .iter()
            .position(|(_, c, _)| *c == command)
            .unwrap_or(usize::MAX)
    };
    for row in &mut rows {
        let mut keys: Vec<&str> = row.keys.split("  ").collect();
        keys.sort_by_key(|k| (k.chars().count(), k.to_lowercase(), k.to_string()));
        row.keys = keys.join("  ");
    }
    rows.sort_by_key(|r| rank(&r.accept));
    for spec in registry
        .specs()
        .filter(|s| s.status == command::CommandStatus::Available)
        .filter(|s| !matches!(s.name, "nop" | "cmdline"))
    {
        if rows
            .iter()
            .any(|r| r.accept == spec.name || r.accept.starts_with(&format!("{} ", spec.name)))
        {
            continue;
        }
        rows.push(PaletteRow {
            primary: capitalize(spec.summary),
            secondary: spec.usage.to_string(),
            accept: spec.name.to_string(),
            ..PaletteRow::default()
        });
    }
    rows
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

fn completion_row(typed: &str, c: Completion) -> PaletteRow {
    let typed = typed.trim_start().trim_start_matches(':');
    let marks = if c.text.starts_with(typed) {
        (0..typed.chars().count()).collect()
    } else {
        Vec::new()
    };
    PaletteRow {
        primary: c.text.clone(),
        secondary: c.summary,
        primary_marks: marks,
        accept: c.text,
        ..PaletteRow::default()
    }
}

fn is_new_tab_page(url: &str) -> bool {
    let url = url.trim_end_matches('/');
    matches!(
        url,
        "chrome://newtab"
            | "chrome://new-tab-page"
            | "chrome://merlin-start"
            | "merlin://start"
            | "about:blank"
            | ""
    )
}

/// Quotes a command argument so the tokenizer reads it back unchanged.
pub(crate) fn quote_arg(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        if c == '"' || c == '\\' {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('"');
    out
}

/// "now", "5 min", "3 h", "2 d", "6 wk", "1 y".
fn ago(now: i64, then: i64) -> String {
    if then <= 0 {
        return String::new();
    }
    let s = (now - then).max(0);
    match s {
        0..60 => "now".into(),
        60..3600 => format!("{} min", s / 60),
        3600..86_400 => format!("{} h", s / 3600),
        86_400..1_209_600 => format!("{} d", s / 86_400),
        1_209_600..31_536_000 => format!("{} wk", s / 604_800),
        _ => format!("{} y", s / 31_536_000),
    }
}

/// Merlin's menu, in place of Chromium's ⋮ menu: label, what it runs, and
/// a hint. Keys come from the keymap, so the user's own bindings show.
const MENU: [(&str, &str, &str); 23] = [
    ("New tab", "tabnew", ""),
    ("New window", "window", ""),
    (
        "New private window",
        "private",
        "nothing is kept after it closes",
    ),
    ("Reopen closed tab", "tabrestore", ""),
    ("History", "history", "search what you visited"),
    ("Bookmarks", "bookmarks", ""),
    ("Bookmark this page", "bookmark", ""),
    ("Downloads", "palette downloads", ""),
    ("Workspaces", "palette workspaces", "saved windows"),
    ("Find in page", "find", ""),
    ("Zoom in", "browser zoom-in", ""),
    ("Zoom out", "browser zoom-out", ""),
    ("Actual size", "browser zoom-reset", ""),
    ("Full screen", "browser fullscreen", ""),
    ("Print…", "browser print", ""),
    ("Save page as…", "browser save-page", ""),
    ("Passwords", "browser passwords", ""),
    ("Extensions", "extensions", ""),
    (
        "Settings",
        "settings",
        "appearance, keys, browsing, privacy",
    ),
    ("Developer tools", "devtools", ""),
    ("Task manager", "browser task-manager", ""),
    (
        "Keys and commands",
        "palette commands",
        "every binding, searchable",
    ),
    ("Quit Merlin", "browser quit", ""),
];

fn menu_rows(keymap: &crate::keymap::Keymap) -> Vec<PaletteRow> {
    let bindings = keymap.bindings(Mode::Normal);
    MENU.iter()
        .map(|(label, command, hint)| {
            let mut keys: Vec<String> = bindings
                .iter()
                .filter(|(_, b)| b.command == *command)
                .map(|(k, _)| k.to_string())
                .collect();
            keys.sort_by_key(|k| (k.chars().count(), k.clone()));
            PaletteRow {
                primary: (*label).to_string(),
                secondary: (*hint).to_string(),
                keys: keys.into_iter().next().unwrap_or_default(),
                accept: (*command).to_string(),
                ..PaletteRow::default()
            }
        })
        .collect()
}

fn item_row(source: ItemSource, item: ListItem, now: i64) -> PaletteRow {
    let when = ago(now, item.time);
    match source {
        ItemSource::History | ItemSource::Bookmarks => PaletteRow {
            primary: if item.title.trim().is_empty() {
                item.value.clone()
            } else {
                item.title
            },
            secondary: item.detail,
            keys: if source == ItemSource::History {
                when
            } else {
                String::new()
            },
            accept: format!("open {}", quote_arg(&item.value)),
            ..PaletteRow::default()
        },
        ItemSource::Workspaces => PaletteRow {
            primary: item.title,
            secondary: if when.is_empty() {
                item.detail
            } else if item.detail.is_empty() {
                format!("saved {when} ago")
            } else {
                format!("{} · saved {when} ago", item.detail)
            },
            keys: if item.current {
                "current".into()
            } else {
                String::new()
            },
            active: item.current,
            accept: format!("workspace open {}", item.value),
            ..PaletteRow::default()
        },
        // `current`: still in progress, so Enter shows it rather than
        // opening a partial file.
        ItemSource::Downloads => PaletteRow {
            primary: item.title,
            secondary: item.detail,
            keys: if item.current { String::new() } else { when },
            active: item.current,
            accept: if item.current {
                format!("browser download-show {}", item.value)
            } else {
                format!("browser download-open {}", item.value)
            },
            ..PaletteRow::default()
        },
    }
}

fn outline_rows(doc: &PageDocument) -> Vec<PaletteRow> {
    doc.outline()
        .into_iter()
        .filter(|e| e.element != crate::document::NO_ELEMENT)
        .map(|e| PaletteRow {
            primary: e.label,
            keys: e.detail,
            indent: e.depth.saturating_sub(1),
            accept: format!("outline {}", e.element),
            ..PaletteRow::default()
        })
        .collect()
}

fn link_rows(doc: &PageDocument) -> Vec<PaletteRow> {
    doc.links()
        .into_iter()
        .map(|(text, url)| PaletteRow {
            primary: text,
            accept: format!("open {}", quote_arg(&url)),
            secondary: url,
            ..PaletteRow::default()
        })
        .collect()
}
