//! The palette: one floating surface for the `:` command line, the tab
//! switcher, the searchable command list (which doubles as help), and lists
//! the host supplies (history, bookmarks, workspaces, profiles) or the page
//! does (outline, links).
//!
//! The core owns the palette's state (text, rows, selection, error) and the
//! host only renders it and reports edits and navigation keys. Ranking,
//! completion and what Enter does are therefore decided here and tested
//! without a browser.

use std::collections::BTreeSet;

use crate::fuzzy;

/// Rows kept after filtering. The host shows a window around the selection.
pub const MAX_PALETTE_ROWS: usize = 500;
/// Tabs accepted from the host.
pub const MAX_TABS: usize = 500;
/// Characters kept from tab titles and URLs.
pub const MAX_TAB_TEXT: usize = 1024;
/// Items accepted from the host for one list.
pub const MAX_ITEMS: usize = 5000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PaletteKind {
    /// `:` with completions and history.
    CommandLine,
    /// Fuzzy tab switcher.
    Tabs,
    /// Every binding and command, searchable; runs the chosen one.
    Commands,
    /// Recently visited pages.
    History,
    Bookmarks,
    /// Saved workspaces.
    Workspaces,
    /// Browser profiles.
    Profiles,
    /// The page's headings, code blocks and tables.
    Outline,
    /// The page's links.
    Links,
    /// Merlin's menu: what Chromium's ⋮ menu offered, as commands.
    Menu,
    /// Recent downloads.
    Downloads,
}

/// Lists the host fetches for a palette.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ItemSource {
    History,
    Bookmarks,
    Workspaces,
    Profiles,
    Downloads,
}

impl ItemSource {
    pub fn palette(self) -> PaletteKind {
        match self {
            ItemSource::History => PaletteKind::History,
            ItemSource::Bookmarks => PaletteKind::Bookmarks,
            ItemSource::Workspaces => PaletteKind::Workspaces,
            ItemSource::Profiles => PaletteKind::Profiles,
            ItemSource::Downloads => PaletteKind::Downloads,
        }
    }
}

/// One entry of a host-supplied list.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ListItem {
    pub title: String,
    /// URL for history and bookmarks; folder or description otherwise.
    pub detail: String,
    /// What choosing it acts on: a URL, a workspace or profile name.
    pub value: String,
    /// Seconds since the Unix epoch (last visit, save time), or 0.
    pub time: i64,
    /// The current workspace or profile.
    pub current: bool,
}

impl ListItem {
    pub fn bounded(mut self) -> Self {
        truncate_chars(&mut self.title, MAX_TAB_TEXT);
        truncate_chars(&mut self.detail, MAX_TAB_TEXT);
        truncate_chars(&mut self.value, 8192);
        self
    }
}

impl PaletteKind {
    /// Kinds that `:palette <name>` opens.
    pub const NAMED: [(PaletteKind, &'static str); 10] = [
        (PaletteKind::Commands, "commands"),
        (PaletteKind::Tabs, "tabs"),
        (PaletteKind::History, "history"),
        (PaletteKind::Bookmarks, "bookmarks"),
        (PaletteKind::Workspaces, "workspaces"),
        (PaletteKind::Profiles, "profiles"),
        (PaletteKind::Outline, "outline"),
        (PaletteKind::Links, "links"),
        (PaletteKind::Menu, "menu"),
        (PaletteKind::Downloads, "downloads"),
    ];

    pub fn from_name(name: &str) -> Option<PaletteKind> {
        Self::NAMED
            .iter()
            .find(|(_, n)| *n == name)
            .map(|(k, _)| *k)
    }

    pub fn title(self) -> &'static str {
        match self {
            PaletteKind::CommandLine => "Command",
            PaletteKind::Tabs => "Tabs",
            PaletteKind::Commands => "Commands",
            PaletteKind::History => "History",
            PaletteKind::Bookmarks => "Bookmarks",
            PaletteKind::Workspaces => "Workspaces",
            PaletteKind::Profiles => "Profiles",
            PaletteKind::Outline => "Outline",
            PaletteKind::Links => "Links",
            PaletteKind::Menu => "Merlin",
            PaletteKind::Downloads => "Downloads",
        }
    }

    /// Short prompt shown before the input.
    pub fn prompt(self) -> &'static str {
        match self {
            PaletteKind::CommandLine => ":",
            other => other.title(),
        }
    }

    pub fn placeholder(self) -> &'static str {
        match self {
            PaletteKind::CommandLine => "command   Tab completes · ↑↓ history · Esc closes",
            PaletteKind::Tabs => "Search tabs by title or URL",
            PaletteKind::Commands => "Search commands and keys",
            PaletteKind::History => "Search history by title or URL",
            PaletteKind::Bookmarks => "Search bookmarks",
            PaletteKind::Workspaces => "Open a workspace",
            PaletteKind::Profiles => "Open a window for a profile",
            PaletteKind::Outline => "Jump to a section, code block or table   ← → fold",
            PaletteKind::Links => "Search links on this page",
            PaletteKind::Menu => "New window, history, settings, zoom, print…",
            PaletteKind::Downloads => "Search downloads",
        }
    }

    /// Text shown while the list is still being fetched.
    pub fn loading_text(self) -> &'static str {
        match self {
            PaletteKind::Outline | PaletteKind::Links => "Reading the page…",
            _ => "Loading…",
        }
    }

    /// Text shown when there is nothing to list.
    pub fn empty_text(self) -> &'static str {
        match self {
            PaletteKind::History => "No history yet",
            PaletteKind::Bookmarks => "No bookmarks yet (gB bookmarks this page)",
            PaletteKind::Workspaces => "No saved workspaces (:workspace save <name>)",
            PaletteKind::Profiles => "No other profiles",
            PaletteKind::Outline => "No headings, code or tables on this page",
            PaletteKind::Links => "No links on this page",
            PaletteKind::Downloads => "No downloads yet",
            _ => "Nothing matches",
        }
    }
}

/// One tab as reported by the host.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TabInfo {
    /// Stable host handle (`tabs::TabHandle`), not the strip position.
    pub id: i32,
    pub title: String,
    pub url: String,
    pub active: bool,
}

impl TabInfo {
    pub fn bounded(mut self) -> Self {
        truncate_chars(&mut self.title, MAX_TAB_TEXT);
        truncate_chars(&mut self.url, MAX_TAB_TEXT);
        self
    }
}

fn truncate_chars(s: &mut String, max: usize) {
    if let Some((i, _)) = s.char_indices().nth(max) {
        s.truncate(i);
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PaletteRow {
    pub primary: String,
    pub secondary: String,
    /// Key hint shown on the right (a binding, or a tab number).
    pub keys: String,
    /// Character indices in `primary`/`secondary` that matched the query.
    pub primary_marks: Vec<usize>,
    pub secondary_marks: Vec<usize>,
    /// For tab rows.
    pub tab_id: Option<i32>,
    /// The current tab, or otherwise "you are here".
    pub active: bool,
    /// Nesting depth for tree-like lists (the outline), from 0.
    pub indent: u8,
    /// A folded outline entry whose children are hidden.
    pub folded: bool,
    /// Command line run when the row is chosen; for the command line kind,
    /// the completed text.
    pub accept: String,
    /// Index into the palette's unfiltered items.
    pub(crate) item: Option<usize>,
}

/// Navigation keys the host forwards from the palette's text field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaletteKey {
    /// Tab or Ctrl+N.
    Next,
    /// Shift+Tab or Ctrl+P.
    Previous,
    Up,
    Down,
    Accept,
    Cancel,
    /// Left arrow in a tree list with an empty query: fold the selection.
    Collapse,
    /// Right arrow in a tree list with an empty query: unfold it.
    Expand,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Palette {
    pub kind: PaletteKind,
    pub text: String,
    pub rows: Vec<PaletteRow>,
    pub selected: Option<usize>,
    pub error: Option<String>,
    /// Unfiltered rows for the list kinds.
    pub(crate) items: Vec<PaletteRow>,
    /// Command line: the text before Tab-cycling started.
    pub(crate) cycle_base: Option<String>,
    /// Command line: position in history while browsing it with Up/Down,
    /// and the draft to return to.
    pub(crate) history_index: Option<usize>,
    pub(crate) history_draft: String,
    /// The host has not delivered the list yet.
    pub loading: bool,
    /// Indices into `items` of folded entries.
    pub(crate) folded: BTreeSet<usize>,
}

impl Palette {
    pub(crate) fn new(kind: PaletteKind, text: String, items: Vec<PaletteRow>) -> Self {
        Self {
            kind,
            text,
            rows: Vec::new(),
            selected: None,
            error: None,
            items,
            cycle_base: None,
            history_index: None,
            history_draft: String::new(),
            loading: false,
            folded: BTreeSet::new(),
        }
    }

    /// Indices into `items` hidden by folds: entries deeper than a folded
    /// entry, up to the next entry at its depth or shallower.
    fn hidden_by_folds(&self) -> BTreeSet<usize> {
        let mut hidden = BTreeSet::new();
        for &f in &self.folded {
            let Some(depth) = self.items.get(f).map(|r| r.indent) else {
                continue;
            };
            for (i, item) in self.items.iter().enumerate().skip(f + 1) {
                if item.indent <= depth {
                    break;
                }
                hidden.insert(i);
            }
        }
        hidden
    }

    fn has_children(&self, index: usize) -> bool {
        let depth = self.items[index].indent;
        self.items
            .get(index + 1)
            .is_some_and(|next| next.indent > depth)
    }

    /// Folds or unfolds the selected entry (outline). Only with an empty
    /// query, where the rows are the tree itself. Returns whether anything
    /// changed.
    pub(crate) fn fold_selected(&mut self, fold: bool) -> bool {
        if !self.text.trim().is_empty() {
            return false;
        }
        let Some(item) = self.selected_row().and_then(|r| r.item) else {
            return false;
        };
        if fold && !self.has_children(item) {
            // Folding a leaf folds its parent, as in tree views.
            let depth = self.items[item].indent;
            let Some(parent) = (0..item).rev().find(|&i| self.items[i].indent < depth) else {
                return false;
            };
            self.folded.insert(parent);
            self.filter_items();
            self.selected = self.rows.iter().position(|r| r.item == Some(parent));
            return true;
        }
        let changed = if fold {
            self.folded.insert(item)
        } else {
            self.folded.remove(&item)
        };
        if changed {
            self.filter_items();
            self.selected = self.rows.iter().position(|r| r.item == Some(item));
        }
        changed
    }

    /// Re-filters the list kinds by the current text.
    pub(crate) fn filter_items(&mut self) {
        let query = self.text.trim();
        let hidden = if query.is_empty() {
            self.hidden_by_folds()
        } else {
            BTreeSet::new()
        };
        let folded = &self.folded;
        let mut scored: Vec<(i32, usize, PaletteRow)> = self
            .items
            .iter()
            .enumerate()
            .filter(|(i, _)| !hidden.contains(i))
            .filter_map(|(i, item)| {
                if query.is_empty() {
                    let mut row = item.clone();
                    row.item = Some(i);
                    row.folded = folded.contains(&i);
                    return Some((0, i, row));
                }
                let m = fuzzy::match_fields(query, &[&item.primary, &item.secondary])?;
                let mut row = item.clone();
                row.item = Some(i);
                row.primary_marks = m.positions[0].clone();
                row.secondary_marks = m.positions[1].clone();
                Some((m.score, i, row))
            })
            .collect();
        // Best score first; ties keep the source order (MRU for tabs). The
        // outline keeps page order even when searching, so matches read
        // top to bottom.
        if self.kind == PaletteKind::Outline {
            scored.sort_by_key(|(_, i, _)| *i);
        } else {
            scored.sort_by_key(|(score, i, _)| (std::cmp::Reverse(*score), *i));
        }
        self.rows = scored
            .into_iter()
            .take(MAX_PALETTE_ROWS)
            .map(|(_, _, row)| row)
            .collect();
        self.selected = (!self.rows.is_empty()).then_some(0);
    }

    /// Moves the selection by `delta`, wrapping. No-op without rows.
    pub(crate) fn move_selection(&mut self, delta: isize) {
        let n = self.rows.len();
        if n == 0 {
            self.selected = None;
            return;
        }
        let current = match self.selected {
            Some(i) => i as isize,
            // Nothing selected yet: Next goes to the first row, Previous to
            // the last.
            None if delta > 0 => -1,
            None => n as isize,
        };
        self.selected = Some((current + delta).rem_euclid(n as isize) as usize);
    }

    pub fn selected_row(&self) -> Option<&PaletteRow> {
        self.selected.and_then(|i| self.rows.get(i))
    }
}
