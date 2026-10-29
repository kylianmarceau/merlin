//! Input modes.

use std::fmt;

/// The modal state of one browser window.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Mode {
    /// Keys are browser commands. Unbound keys still reach the page.
    #[default]
    Normal,
    /// Keys go to the page. Entered automatically when an editable element
    /// gains focus, or explicitly with `i`. `<Esc>` returns to Normal.
    Insert,
    /// Keyboard selection. Only entering and leaving exist so far.
    Visual,
    /// The `:` command line is open and owns keyboard focus.
    Command,
    /// Every key goes to the page, including `<Esc>`, for sites with their
    /// own keyboard model (mail, editors, terminals, games). Left with the
    /// configured exit key, `<S-Esc>` by default.
    Passthrough,
    /// Link hints are shown; typed characters filter them.
    Hint,
}

impl Mode {
    pub const ALL: [Mode; 6] = [
        Mode::Normal,
        Mode::Insert,
        Mode::Visual,
        Mode::Command,
        Mode::Passthrough,
        Mode::Hint,
    ];

    /// Lowercase name used in commands and configuration.
    pub fn name(self) -> &'static str {
        match self {
            Mode::Normal => "normal",
            Mode::Insert => "insert",
            Mode::Visual => "visual",
            Mode::Command => "command",
            Mode::Passthrough => "passthrough",
            Mode::Hint => "hint",
        }
    }

    /// Short label for the mode indicator.
    pub fn indicator(self) -> &'static str {
        match self {
            Mode::Normal => "NORMAL",
            Mode::Insert => "INSERT",
            Mode::Visual => "VISUAL",
            Mode::Command => "COMMAND",
            Mode::Passthrough => "PASSTHROUGH",
            Mode::Hint => "HINT",
        }
    }

    pub fn from_name(name: &str) -> Option<Mode> {
        Mode::ALL.into_iter().find(|m| m.name() == name)
    }

    /// Whether users may attach key bindings to this mode. Insert and
    /// Passthrough exist precisely so the page receives keys, and Command
    /// and Hint keys are handled by their own UI.
    pub fn accepts_bindings(self) -> bool {
        matches!(self, Mode::Normal | Mode::Visual)
    }
}

impl fmt::Display for Mode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}
