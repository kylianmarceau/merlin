//! Key bindings: key sequences mapped to command lines, per mode.
//!
//! A binding stores a command line (`"scroll down"`, `"cmdline open"`), not a
//! closure, so mappings go through the same registry as the `:` command line.
//! Bindings are validated when added by parsing their command and dry-running
//! it, so a bad user mapping fails at load time with a clear error rather than
//! silently doing nothing when pressed.

use std::collections::BTreeMap;
use std::fmt;
use std::ops::Bound;

use crate::command::{CommandError, CommandRegistry};
use crate::key::{Key, KeyCode, KeyParseError, KeySequence};
use crate::mode::Mode;

/// Longest key sequence a binding may have.
pub const MAX_SEQUENCE_LEN: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Binding {
    pub command: String,
    /// Human description for the palette and which-key hints. Defaults to
    /// the command line itself.
    pub desc: Option<String>,
}

impl Binding {
    pub fn description(&self) -> &str {
        self.desc.as_deref().unwrap_or(&self.command)
    }
}

/// Result of looking up a (possibly partial) key sequence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lookup<'a> {
    /// No binding equals or starts with the sequence.
    NoMatch,
    /// Longer bindings start with the sequence; none equals it.
    Prefix,
    /// A binding equals the sequence and none is longer.
    Exact(&'a Binding),
    /// A binding equals the sequence and longer ones also start with it.
    /// The host waits for the timeout before running the shorter one.
    ExactAndPrefix(&'a Binding),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KeymapError {
    InvalidKeys {
        keys: String,
        error: KeyParseError,
    },
    ModeNotBindable(Mode),
    TooLong {
        keys: String,
    },
    /// Sequences may not start with 1-9; those keys type a count.
    StartsWithCount {
        keys: String,
    },
    /// `<Esc>` alone always cancels and cannot be rebound.
    ReservedKey {
        keys: String,
    },
    InvalidCommand {
        keys: String,
        error: CommandError,
    },
}

impl fmt::Display for KeymapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidKeys { keys, error } => write!(f, "invalid keys '{keys}': {error}"),
            Self::ModeNotBindable(m) => write!(f, "{m} mode does not accept key bindings"),
            Self::TooLong { keys } => {
                write!(f, "'{keys}' is longer than {MAX_SEQUENCE_LEN} keys")
            }
            Self::StartsWithCount { keys } => {
                write!(
                    f,
                    "'{keys}' starts with a digit, which is reserved for counts"
                )
            }
            Self::ReservedKey { keys } => write!(f, "'{keys}' is reserved and cannot be bound"),
            Self::InvalidCommand { keys, error } => write!(f, "binding for '{keys}': {error}"),
        }
    }
}

impl std::error::Error for KeymapError {}

#[derive(Debug, Default)]
pub struct Keymap {
    normal: BTreeMap<KeySequence, Binding>,
    visual: BTreeMap<KeySequence, Binding>,
}

impl Keymap {
    /// An empty keymap.
    pub fn new() -> Self {
        Self::default()
    }

    /// The default bindings.
    pub fn with_defaults(registry: &CommandRegistry) -> Self {
        let mut keymap = Self::new();
        for (mode, table) in [
            (Mode::Normal, DEFAULT_NORMAL),
            (Mode::Visual, DEFAULT_VISUAL),
        ] {
            for (keys, command, desc) in table {
                keymap
                    .bind_described(mode, keys, command, Some(desc), registry)
                    .expect("default bindings are valid");
            }
        }
        keymap
    }

    fn map(&self, mode: Mode) -> Option<&BTreeMap<KeySequence, Binding>> {
        match mode {
            Mode::Normal => Some(&self.normal),
            Mode::Visual => Some(&self.visual),
            _ => None,
        }
    }

    fn map_mut(&mut self, mode: Mode) -> Option<&mut BTreeMap<KeySequence, Binding>> {
        match mode {
            Mode::Normal => Some(&mut self.normal),
            Mode::Visual => Some(&mut self.visual),
            _ => None,
        }
    }

    /// Adds or replaces a binding. Returns the binding it replaced.
    pub fn bind(
        &mut self,
        mode: Mode,
        keys: &str,
        command: &str,
        registry: &CommandRegistry,
    ) -> Result<Option<Binding>, KeymapError> {
        self.bind_described(mode, keys, command, None, registry)
    }

    /// Like [`Self::bind`], with a description shown in help.
    pub fn bind_described(
        &mut self,
        mode: Mode,
        keys: &str,
        command: &str,
        desc: Option<&str>,
        registry: &CommandRegistry,
    ) -> Result<Option<Binding>, KeymapError> {
        let sequence = validate_keys(mode, keys)?;
        // Dry-run the command: handlers are pure, so this checks the name,
        // the arguments and the bang without side effects.
        registry
            .execute(command, None)
            .map_err(|error| KeymapError::InvalidCommand {
                keys: keys.to_string(),
                error,
            })?;
        let map = self
            .map_mut(mode)
            .ok_or(KeymapError::ModeNotBindable(mode))?;
        Ok(map.insert(
            sequence,
            Binding {
                command: command.trim().to_string(),
                desc: desc.map(str::to_string),
            },
        ))
    }

    /// Removes a binding. Returns whether one existed.
    pub fn unbind(&mut self, mode: Mode, keys: &str) -> Result<bool, KeymapError> {
        let sequence = validate_keys(mode, keys)?;
        let map = self
            .map_mut(mode)
            .ok_or(KeymapError::ModeNotBindable(mode))?;
        Ok(map.remove(&sequence).is_some())
    }

    pub fn lookup(&self, mode: Mode, keys: &[Key]) -> Lookup<'_> {
        let Some(map) = self.map(mode) else {
            return Lookup::NoMatch;
        };
        let sequence = KeySequence::new(keys.to_vec());
        let exact = map.get(&sequence);
        // Sequences sort lexicographically, so the first entry strictly after
        // `sequence` is an extension of it if any extension exists.
        let has_longer = map
            .range((Bound::Excluded(&sequence), Bound::Unbounded))
            .next()
            .is_some_and(|(k, _)| k.keys().starts_with(keys));
        match (exact, has_longer) {
            (None, false) => Lookup::NoMatch,
            (None, true) => Lookup::Prefix,
            (Some(b), false) => Lookup::Exact(b),
            (Some(b), true) => Lookup::ExactAndPrefix(b),
        }
    }

    /// Bindings that extend `pending` by one or more keys: the suffix still
    /// to type and the binding. For which-key style hints after `g`.
    pub fn continuations(&self, mode: Mode, pending: &[Key]) -> Vec<(KeySequence, &Binding)> {
        let Some(map) = self.map(mode) else {
            return Vec::new();
        };
        let start = KeySequence::new(pending.to_vec());
        map.range((Bound::Excluded(&start), Bound::Unbounded))
            .take_while(|(k, _)| k.keys().starts_with(pending))
            .map(|(k, b)| (KeySequence::new(k.keys()[pending.len()..].to_vec()), b))
            .collect()
    }

    /// Key sequences bound to exactly this command line, shortest first.
    pub fn keys_for(&self, mode: Mode, command: &str) -> Vec<&KeySequence> {
        let mut keys: Vec<&KeySequence> = self
            .bindings(mode)
            .into_iter()
            .filter(|(_, b)| b.command == command)
            .map(|(k, _)| k)
            .collect();
        keys.sort_by_key(|k| k.len());
        keys
    }

    /// All bindings for a mode, in key order.
    pub fn bindings(&self, mode: Mode) -> Vec<(&KeySequence, &Binding)> {
        self.map(mode)
            .map(|m| m.iter().collect())
            .unwrap_or_default()
    }
}

fn validate_keys(mode: Mode, keys: &str) -> Result<KeySequence, KeymapError> {
    if !mode.accepts_bindings() {
        return Err(KeymapError::ModeNotBindable(mode));
    }
    let sequence = KeySequence::parse(keys).map_err(|error| KeymapError::InvalidKeys {
        keys: keys.to_string(),
        error,
    })?;
    if sequence.len() > MAX_SEQUENCE_LEN {
        return Err(KeymapError::TooLong {
            keys: keys.to_string(),
        });
    }
    let first = sequence.keys()[0];
    if first.digit().is_some_and(|d| d != 0) {
        return Err(KeymapError::StartsWithCount {
            keys: keys.to_string(),
        });
    }
    if sequence.len() == 1 && first == Key::plain(KeyCode::Escape) {
        return Err(KeymapError::ReservedKey {
            keys: keys.to_string(),
        });
    }
    Ok(sequence)
}

/// Default Normal-mode bindings: keys, command line, description.
/// Deliberately close to qutebrowser and Vimium so existing muscle memory
/// works. Conflicts with site shortcuts (GitHub uses `j`/`k`, `?`, `t`) are
/// handled by Passthrough, `passthrough_sites` and `[unmap]` in the config.
pub const DEFAULT_NORMAL: &[(&str, &str, &str)] = &[
    // Ordered for the command list (`?`): most useful first.
    ("o", "cmdline open", "Open URL or search"),
    ("O", "cmdline tabnew", "Open URL or search in new tab"),
    ("t", "tabnew", "New tab"),
    ("b", "buffer", "Switch tab"),
    ("T", "buffer", "Switch tab"),
    ("f", "hint", "Follow a link"),
    ("F", "hint tab", "Open a link in a new tab"),
    ("gi", "hint input", "Focus a text field"),
    ("gf", "hint peek", "Peek at a link in a floating preview"),
    ("/", "find", "Find in page"),
    ("n", "find next", "Next match"),
    ("N", "find previous", "Previous match"),
    ("H", "back", "Back"),
    ("L", "forward", "Forward"),
    ("r", "reload", "Reload"),
    ("R", "reload!", "Reload, bypassing the cache"),
    ("J", "tabnext", "Next tab"),
    ("K", "tabprevious", "Previous tab"),
    ("gt", "tabnext", "Next tab"),
    ("gT", "tabprevious", "Previous tab"),
    ("g0", "tabfirst", "First tab"),
    ("g$", "tablast", "Last tab"),
    ("d", "tabclose", "Close tab"),
    ("u", "tabrestore", "Reopen closed tab"),
    ("yy", "yank url", "Copy page URL"),
    ("ym", "yank markdown", "Copy Markdown link to page"),
    ("yt", "yank title", "Copy page title"),
    ("yf", "hint yank", "Copy a link"),
    ("yc", "hint code", "Copy a code block"),
    ("yM", "extract markdown", "Copy the page as Markdown"),
    ("p", "paste", "Open clipboard URL"),
    ("P", "paste tab", "Open clipboard URL in new tab"),
    ("gu", "up", "Up one level in the URL"),
    ("gU", "root", "Site root"),
    ("gs", "sidebar", "Toggle tab sidebar"),
    ("gp", "pin", "Pin or unpin tab"),
    ("<C-w>v", "vsplit", "Split side by side"),
    ("<C-w>s", "split", "Split top and bottom"),
    ("<C-w>w", "split-focus", "Other side of the split"),
    ("<C-w>h", "split-focus", "Other side of the split"),
    ("<C-w>l", "split-focus", "Other side of the split"),
    ("<C-w>j", "split-focus", "Other side of the split"),
    ("<C-w>k", "split-focus", "Other side of the split"),
    ("<C-w>x", "split-swap", "Swap the split"),
    ("<C-w>o", "only", "End the split"),
    ("<C-w>q", "tabclose", "Close this side"),
    ("gw", "space", "Spaces"),
    ("M", "palette menu", "Merlin menu"),
    ("gh", "history", "Search history"),
    ("gb", "bookmarks", "Search bookmarks"),
    ("gB", "bookmark", "Bookmark this page"),
    ("gO", "outline", "Page outline"),
    ("gl", "links", "Links on this page"),
    ("]]", "jump heading next", "Next heading"),
    ("[[", "jump heading previous", "Previous heading"),
    ("]c", "jump code next", "Next code block"),
    ("[c", "jump code previous", "Previous code block"),
    ("]t", "jump table next", "Next table"),
    ("[t", "jump table previous", "Previous table"),
    ("ge", "hint edit", "Edit a field in your editor"),
    ("m", "mark", "Set a mark (then a letter)"),
    ("'", "jump-mark", "Go to a mark (then a letter)"),
    ("`", "jump-mark", "Go to a mark (then a letter)"),
    (
        "q",
        "macro record",
        "Record a macro (then a register; q stops)",
    ),
    (
        "@",
        "macro play",
        "Play a macro (then a register; @@ repeats)",
    ),
    ("j", "scroll down", "Scroll down"),
    ("k", "scroll up", "Scroll up"),
    ("h", "scroll left", "Scroll left"),
    ("l", "scroll right", "Scroll right"),
    ("gg", "scroll top", "Top of page"),
    ("G", "scroll bottom", "Bottom of page"),
    ("<C-d>", "scroll half-down", "Half page down"),
    ("<C-u>", "scroll half-up", "Half page up"),
    ("<C-f>", "scroll page-down", "Page down"),
    ("<C-b>", "scroll page-up", "Page up"),
    (":", "cmdline", "Command line"),
    ("?", "help", "Search commands and keys"),
    ("i", "mode insert", "Insert mode"),
    ("v", "hint select", "Select text (Visual mode)"),
    ("<C-v>", "mode passthrough", "Passthrough mode"),
    ("<C-l>", "focus-address", "Address bar"),
];

/// Default Visual-mode bindings: Vim motions that move the selection's
/// focus, and `y` to copy. `<Esc>` leaves Visual mode and clears the
/// selection.
pub const DEFAULT_VISUAL: &[(&str, &str, &str)] = &[
    ("y", "yank selection", "Copy the selection"),
    ("h", "select backward character", "Extend left"),
    ("l", "select forward character", "Extend right"),
    ("j", "select forward line", "Extend down a line"),
    ("k", "select backward line", "Extend up a line"),
    ("w", "select forward word", "Extend to the next word"),
    ("e", "select forward word", "Extend to the end of the word"),
    ("b", "select backward word", "Extend back a word"),
    (
        ")",
        "select forward sentence",
        "Extend to the next sentence",
    ),
    ("(", "select backward sentence", "Extend back a sentence"),
    (
        "}",
        "select forward paragraph",
        "Extend to the next paragraph",
    ),
    ("{", "select backward paragraph", "Extend back a paragraph"),
    ("G", "select forward document", "Extend to the end"),
    ("gg", "select backward document", "Extend to the start"),
];
