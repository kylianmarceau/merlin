//! Modal input and command core for the browser.
//!
//! This crate decides *what* a key press or command means. It never calls
//! browser APIs: it returns typed [`Action`]s that the C++ host performs with
//! Chromium's own functions. That split keeps the logic deterministic and
//! testable without a browser, and keeps Chromium in charge of lifecycle,
//! threading and security.
//!
//! ```text
//! host key event -> Key + FocusContext -> ModalSession::handle_key
//!     -> Keymap lookup -> CommandRegistry::execute -> Effects
//!     -> Outcome { disposition, actions, mode, ... } -> host performs actions
//! ```
//!
//! Tests live in `tests/` rather than in `#[cfg(test)]` modules because
//! Chromium's GN build does not run in-crate Rust tests; see
//! `docs/TESTING.md`.

pub mod action;
pub mod command;
pub mod config;
pub mod document;
pub mod editor;
pub mod focus;
pub mod fuzzy;
pub mod hints;
pub mod ipc;
pub mod json;
pub mod key;
pub mod keymap;
pub mod mode;
pub mod palette;
pub mod session;
pub mod target;
pub mod toml_lite;
pub mod workspace;

pub use action::{
    Action, BlockJump, BrowserPage, Disposition, DocumentPurpose, ExtractDestination, MessageLevel,
    Scroll, SelectUnit, Switch, TabEdge, YankKind,
};
pub use command::{
    CommandError, CommandOptions, CommandRegistry, CommandSpec, CommandStatus, Completion, Context,
    Effects, Invocation, KeymapEdit,
};
pub use config::{ConfigError, ConfigFile, PopupTransparency, SitePattern};
pub use document::{Block, BlockKind, ExtractKind, OutlineEntry, PageDocument, Span, SpanKind};
pub use editor::{EditDecision, FieldInfo, FieldKind};
pub use focus::{Editable, FocusContext, FocusTarget};
pub use hints::{Hint, HintAction, HintAlphabet, HintKind, HintSet, HintTargets};
pub use key::{Key, KeyCode, KeyParseError, KeySequence, Modifiers};
pub use keymap::{Binding, Keymap, KeymapError, Lookup};
pub use mode::Mode;
pub use palette::{ItemSource, ListItem, Palette, PaletteKey, PaletteKind, PaletteRow, TabInfo};
pub use session::{ConfigReport, KeyDisposition, KeyHint, ModalSession, Outcome, SessionConfig};
pub use target::{OpenTarget, TargetError};
pub use workspace::{
    Group, GroupColor, SplitLayout, WindowBounds, WindowGroup, WindowTab, Workspace,
    WorkspaceError, WorkspaceTab,
};
