//! The command registry and command-line parser.
//!
//! Every user-facing operation is a named command. Key bindings, the `:`
//! command line, and later the palette, `browserctl` and plugins all run
//! commands through this registry, so there is one place that defines what
//! the browser can do.
//!
//! Command handlers are pure functions from an [`Invocation`] to
//! [`Effects`]. They never touch the browser, which makes them cheap to test
//! and safe to dry-run (key bindings are validated by running their command
//! once at bind time).
//!
//! Grammar, deliberately small:
//!
//! ```text
//! line    := [':'] name ['!'] (ws arg)*
//! name    := [A-Za-z][A-Za-z0-9_-]*
//! arg     := bare | '"' ... '"' | '\'' ... '\''
//! ```
//!
//! Double-quoted arguments accept `\"` and `\\` escapes. Command names are
//! matched exactly or through explicit aliases; there is no automatic
//! unique-prefix matching, so adding a command never changes what an
//! existing abbreviation means.

use std::collections::BTreeMap;
use std::fmt;

use crate::action::{
    Action, BlockJump, BrowserPage, Disposition, DocumentPurpose, ExtractDestination, MessageLevel,
    Scroll, SelectUnit, Switch, TabEdge, YankKind,
};
use crate::document::ExtractKind;
use crate::fuzzy;
use crate::hints::HintAction;
use crate::mode::Mode;
use crate::palette::{PaletteKind, TabInfo};
use crate::target::{self, OpenTarget, TargetError};
use crate::workspace::{self, SplitLayout};

/// Upper bound on a command line, in bytes.
pub const MAX_COMMAND_LINE_LEN: usize = 8 * 1024;

/// Upper bound on counts, from key prefixes or arguments.
pub const MAX_COUNT: u32 = 9999;

/// A parsed command, ready to run.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Invocation {
    /// Canonical command name (aliases resolved).
    pub name: &'static str,
    pub bang: bool,
    pub args: Vec<String>,
    /// Count from a key binding prefix such as `3` in `3J`.
    pub count: Option<u32>,
}

impl Invocation {
    fn joined_args(&self) -> String {
        self.args.join(" ")
    }
}

/// A change to key bindings requested by `:map` or `:unmap`. The session
/// applies it, since handlers cannot mutate state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KeymapEdit {
    Map {
        mode: Mode,
        keys: String,
        command: String,
    },
    Unmap {
        mode: Mode,
        keys: String,
    },
}

/// A command that takes its argument from the next key, as Vim's `m`, `'`,
/// `q` and `@` do.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AwaitChar {
    SetMark,
    GoToMark,
    RecordMacro,
    PlayMacro,
}

impl AwaitChar {
    /// The command line the next key completes.
    pub fn command(self, c: char) -> String {
        match self {
            AwaitChar::SetMark => format!("mark {c}"),
            AwaitChar::GoToMark => format!("jump-mark {c}"),
            AwaitChar::RecordMacro => format!("macro record {c}"),
            AwaitChar::PlayMacro => format!("macro play {c}"),
        }
    }
}

/// A change to session state requested by a command. Handlers stay pure;
/// the session applies these.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SessionEdit {
    /// Associate this window's workspace with a project folder, or clear it.
    SetProject(Option<String>),
    GoToMark(char),
    ListMarks,
    StartRecording(char),
    StopRecording,
    /// `None` replays the last macro played.
    PlayMacro {
        register: Option<char>,
        count: u32,
    },
}

/// What running a command produces.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Effects {
    pub actions: Vec<Action>,
    /// Mode to switch to after the actions.
    pub enter_mode: Option<Mode>,
    pub keymap_edits: Vec<KeymapEdit>,
    /// Take the argument from the next key press.
    pub await_char: Option<AwaitChar>,
    pub session_edits: Vec<SessionEdit>,
}

impl Effects {
    fn action(action: Action) -> Self {
        Self {
            actions: vec![action],
            ..Self::default()
        }
    }

    fn edit(edit: SessionEdit) -> Self {
        Self {
            session_edits: vec![edit],
            ..Self::default()
        }
    }

    fn awaiting(what: AwaitChar) -> Self {
        Self {
            await_char: Some(what),
            ..Self::default()
        }
    }

    fn mode(mode: Mode) -> Self {
        Self {
            enter_mode: Some(mode),
            ..Self::default()
        }
    }

    fn palette(kind: PaletteKind) -> Self {
        Self::palette_with_text(kind, String::new())
    }

    fn palette_with_text(kind: PaletteKind, text: String) -> Self {
        Self {
            actions: vec![Action::OpenPalette { kind, text }],
            enter_mode: Some(Mode::Command),
            ..Self::default()
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandStatus {
    Available,
    /// Part of the roadmap. Listed in help, refused when run.
    Planned,
}

/// User options that change what commands produce.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandOptions {
    /// Pixels per `j`/`k`/`h`/`l` step.
    pub scroll_step: u32,
    /// Animate page-sized scroll jumps.
    pub smooth_scroll: bool,
}

impl Default for CommandOptions {
    fn default() -> Self {
        Self {
            scroll_step: 60,
            smooth_scroll: true,
        }
    }
}

/// Read-only state a command may consult. Handlers stay pure: everything
/// they need is passed in, and they return effects rather than mutating.
#[derive(Clone, Copy, Debug)]
pub struct Context<'a> {
    pub registry: &'a CommandRegistry,
    /// The window's tabs in strip order, as last reported by the host.
    pub tabs: &'a [TabInfo],
    pub options: &'a CommandOptions,
    /// The workspace this window was opened from or last saved as.
    pub workspace: Option<&'a str>,
    /// A private (incognito) window: nothing is written to disk.
    pub private: bool,
    /// User-defined commands from `[aliases]`: name to command line.
    pub aliases: &'a BTreeMap<String, String>,
}

impl<'a> Context<'a> {
    /// A context with no tabs, no workspace, in a normal window.
    pub fn new(registry: &'a CommandRegistry, options: &'a CommandOptions) -> Self {
        static NO_ALIASES: BTreeMap<String, String> = BTreeMap::new();
        Self {
            registry,
            tabs: &[],
            options,
            workspace: None,
            private: false,
            aliases: &NO_ALIASES,
        }
    }

    /// Expands a user-defined command: `name args` becomes the alias's
    /// command line followed by `args`. One level only, so an alias can
    /// never loop.
    pub fn expand_alias(&self, line: &str) -> Option<String> {
        expand_alias(self.aliases, line)
    }
}

/// See [`Context::expand_alias`].
pub fn expand_alias(aliases: &BTreeMap<String, String>, line: &str) -> Option<String> {
    let trimmed = line.trim();
    let trimmed = trimmed.strip_prefix(':').unwrap_or(trimmed).trim_start();
    let end = trimmed
        .find(|c: char| c.is_whitespace())
        .unwrap_or(trimmed.len());
    let expansion = aliases.get(&trimmed[..end])?;
    let rest = trimmed[end..].trim();
    Some(if rest.is_empty() {
        expansion.clone()
    } else {
        format!("{expansion} {rest}")
    })
}

pub type Handler = fn(&Invocation, &Context) -> Result<Effects, CommandError>;

#[derive(Clone, Debug)]
pub struct CommandSpec {
    pub name: &'static str,
    pub aliases: &'static [&'static str],
    pub usage: &'static str,
    pub summary: &'static str,
    pub status: CommandStatus,
    pub accepts_bang: bool,
    /// `None` for planned commands.
    pub handler: Option<Handler>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommandError {
    Empty,
    TooLong {
        len: usize,
    },
    InvalidName(String),
    Unknown {
        name: String,
        suggestion: Option<&'static str>,
    },
    NotImplemented {
        name: &'static str,
    },
    BangNotSupported {
        name: &'static str,
    },
    MissingArgument {
        name: &'static str,
        usage: &'static str,
    },
    TooManyArguments {
        name: &'static str,
        usage: &'static str,
    },
    InvalidArgument {
        name: &'static str,
        arg: String,
        reason: String,
    },
    UnterminatedQuote,
    Target {
        name: &'static str,
        error: TargetError,
    },
}

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => f.write_str("empty command"),
            Self::TooLong { len } => {
                write!(
                    f,
                    "command is {len} bytes; the limit is {MAX_COMMAND_LINE_LEN}"
                )
            }
            Self::InvalidName(n) => write!(f, "invalid command name '{n}'"),
            Self::Unknown {
                name,
                suggestion: Some(s),
            } => write!(f, "unknown command '{name}' (did you mean '{s}'?)"),
            Self::Unknown {
                name,
                suggestion: None,
            } => write!(f, "unknown command '{name}' (try ':help')"),
            Self::NotImplemented { name } => write!(f, "':{name}' is planned but not built yet"),
            Self::BangNotSupported { name } => write!(f, "':{name}' does not take '!'"),
            Self::MissingArgument { name, usage } => {
                write!(f, "':{name}' needs an argument. Usage: {usage}")
            }
            Self::TooManyArguments { name, usage } => {
                write!(f, "too many arguments for ':{name}'. Usage: {usage}")
            }
            Self::InvalidArgument { name, arg, reason } => {
                write!(f, "':{name}': invalid argument '{arg}': {reason}")
            }
            Self::UnterminatedQuote => f.write_str("unterminated quote"),
            Self::Target { name, error } => write!(f, "':{name}': {error}"),
        }
    }
}

impl std::error::Error for CommandError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RegistryError {
    DuplicateName(&'static str),
    InvalidName(&'static str),
    MissingHandler(&'static str),
}

impl fmt::Display for RegistryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DuplicateName(n) => {
                write!(f, "command name or alias '{n}' is already registered")
            }
            Self::InvalidName(n) => write!(f, "'{n}' is not a valid command name"),
            Self::MissingHandler(n) => write!(f, "available command '{n}' has no handler"),
        }
    }
}

impl std::error::Error for RegistryError {}

/// A completion candidate for the command line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Completion {
    /// The full command-line text this candidate completes to.
    pub text: String,
    pub summary: String,
}

#[derive(Debug, Default)]
pub struct CommandRegistry {
    specs: Vec<CommandSpec>,
    /// Name or alias to index in `specs`.
    index: BTreeMap<&'static str, usize>,
}

impl CommandRegistry {
    /// An empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// The registry with every built-in command.
    pub fn with_builtins() -> Self {
        let mut registry = Self::new();
        for spec in builtin_specs() {
            registry
                .register(spec)
                .expect("built-in command table is consistent");
        }
        registry
    }

    pub fn register(&mut self, spec: CommandSpec) -> Result<(), RegistryError> {
        for name in std::iter::once(&spec.name).chain(spec.aliases) {
            if !is_valid_name(name) {
                return Err(RegistryError::InvalidName(name));
            }
            if self.index.contains_key(name) {
                return Err(RegistryError::DuplicateName(name));
            }
        }
        if spec.status == CommandStatus::Available && spec.handler.is_none() {
            return Err(RegistryError::MissingHandler(spec.name));
        }
        let i = self.specs.len();
        self.index.insert(spec.name, i);
        for alias in spec.aliases {
            self.index.insert(alias, i);
        }
        self.specs.push(spec);
        Ok(())
    }

    pub fn get(&self, name_or_alias: &str) -> Option<&CommandSpec> {
        self.index.get(name_or_alias).map(|&i| &self.specs[i])
    }

    pub fn specs(&self) -> impl Iterator<Item = &CommandSpec> {
        self.specs.iter()
    }

    /// Parses a command line into an invocation without running it.
    pub fn parse(&self, line: &str, count: Option<u32>) -> Result<Invocation, CommandError> {
        if line.len() > MAX_COMMAND_LINE_LEN {
            return Err(CommandError::TooLong { len: line.len() });
        }
        let line = line.trim();
        let line = line.strip_prefix(':').unwrap_or(line).trim_start();
        if line.is_empty() {
            return Err(CommandError::Empty);
        }
        let name_end = line
            .find(|c: char| c.is_whitespace() || c == '!')
            .unwrap_or(line.len());
        let raw_name = &line[..name_end];
        if !is_valid_name(raw_name) {
            return Err(CommandError::InvalidName(raw_name.to_string()));
        }
        let mut rest = &line[name_end..];
        let bang = rest.starts_with('!');
        if bang {
            rest = &rest[1..];
            if rest.chars().next().is_some_and(|c| !c.is_whitespace()) {
                let token_end = line.find(char::is_whitespace).unwrap_or(line.len());
                return Err(CommandError::InvalidName(line[..token_end].to_string()));
            }
        }
        let spec = self.get(raw_name).ok_or_else(|| CommandError::Unknown {
            name: raw_name.to_string(),
            suggestion: self.suggest(raw_name),
        })?;
        if bang && !spec.accepts_bang {
            return Err(CommandError::BangNotSupported { name: spec.name });
        }
        Ok(Invocation {
            name: spec.name,
            bang,
            args: tokenize(rest)?,
            count: count.map(|c| c.clamp(1, MAX_COUNT)),
        })
    }

    /// Runs with no tabs and default options; see [`Self::run_in`].
    pub fn run(&self, invocation: &Invocation) -> Result<Effects, CommandError> {
        let options = CommandOptions::default();
        self.run_in(invocation, &Context::new(self, &options))
    }

    pub fn run_in(&self, invocation: &Invocation, ctx: &Context) -> Result<Effects, CommandError> {
        let spec = self
            .get(invocation.name)
            .ok_or_else(|| CommandError::Unknown {
                name: invocation.name.to_string(),
                suggestion: None,
            })?;
        match (spec.status, spec.handler) {
            (CommandStatus::Available, Some(handler)) => handler(invocation, ctx),
            _ => Err(CommandError::NotImplemented { name: spec.name }),
        }
    }

    /// Parses and runs a command line with no tabs and default options.
    pub fn execute(&self, line: &str, count: Option<u32>) -> Result<Effects, CommandError> {
        let invocation = self.parse(line, count)?;
        self.run(&invocation)
    }

    /// Parses and runs a command line in a context.
    pub fn execute_in(
        &self,
        line: &str,
        count: Option<u32>,
        ctx: &Context,
    ) -> Result<Effects, CommandError> {
        let invocation = self.parse(line, count)?;
        self.run_in(&invocation, ctx)
    }

    /// Completion candidates for partially typed command-line text.
    ///
    /// Completes command names (and aliases) while the first word is being
    /// typed, then the first argument of commands with a fixed vocabulary.
    /// Prefix matching only; fuzzy ranking comes with the palette.
    pub fn complete(&self, text: &str) -> Vec<Completion> {
        self.complete_in(text, &[])
    }

    /// Like [`Self::complete`], also completing `:buffer` with tab titles.
    pub fn complete_in(&self, text: &str, tabs: &[TabInfo]) -> Vec<Completion> {
        let text = text.trim_start();
        let text = text.strip_prefix(':').unwrap_or(text);
        match text.split_once(char::is_whitespace) {
            None => {
                let mut out: Vec<Completion> = self
                    .index
                    .iter()
                    .filter(|(name, _)| name.starts_with(text))
                    .map(|(name, &i)| (name, &self.specs[i]))
                    .filter(|(_, spec)| spec.status == CommandStatus::Available)
                    .map(|(name, spec)| Completion {
                        text: (*name).to_string(),
                        summary: if *name == spec.name {
                            spec.summary.to_string()
                        } else {
                            format!("alias for :{}", spec.name)
                        },
                    })
                    .collect();
                // Canonical names first, then aliases; each group sorted.
                out.sort_by_key(|c| (c.summary.starts_with("alias for"), c.text.clone()));
                out
            }
            Some((name, rest)) => {
                let Some(spec) = self.get(name) else {
                    return Vec::new();
                };
                if spec.name == "buffer" {
                    // Rank tabs by the typed text, so `:b doc<Tab>`
                    // offers the docs tab first.
                    let mut ranked: Vec<(i32, usize)> = tabs
                        .iter()
                        .enumerate()
                        .filter_map(|(i, t)| {
                            let m = fuzzy::match_fields(rest.trim(), &[&t.title, &t.url])?;
                            Some((m.score, i))
                        })
                        .collect();
                    ranked.sort_by_key(|(score, i)| (std::cmp::Reverse(*score), *i));
                    return ranked
                        .into_iter()
                        .map(|(_, i)| Completion {
                            text: format!("{} {}", spec.name, i + 1),
                            summary: tabs[i].title.clone(),
                        })
                        .collect();
                }
                if rest.contains(char::is_whitespace) && !rest.trim_end().is_empty() {
                    if spec.name == "adblock"
                        && rest.trim_start().starts_with("site ")
                        && "toggle".starts_with(rest.trim_start()[5..].trim_start())
                    {
                        return vec![Completion {
                            text: "adblock site toggle".into(),
                            summary: "toggle protection for this exact site".into(),
                        }];
                    }
                    return Vec::new(); // only the first argument is completed
                }
                let partial = rest.trim_start();
                let words: Vec<(String, String)> = match spec.name {
                    "adblock" => [
                        ("on", "enable native protection"),
                        ("off", "disable native protection"),
                        ("site toggle", "toggle protection for this exact site"),
                        ("status", "show protection status"),
                        ("update", "refresh filter lists"),
                    ]
                    .iter()
                    .map(|(n, d)| ((*n).into(), (*d).into()))
                    .collect(),
                    "scroll" => Scroll::ALL
                        .iter()
                        .map(|(_, n)| ((*n).to_string(), format!("scroll {n}")))
                        .collect(),
                    "mode" => SETTABLE_MODES
                        .iter()
                        .map(|m| (m.name().to_string(), format!("enter {} mode", m.name())))
                        .collect(),
                    "help" => self
                        .specs
                        .iter()
                        .map(|s| (s.name.to_string(), s.summary.to_string()))
                        .collect(),
                    "hint" => HintAction::ALL
                        .iter()
                        .map(|(a, n)| ((*n).to_string(), format!("hints: {}", a.describe())))
                        .collect(),
                    "yank" => YankKind::ALL
                        .iter()
                        .map(|(_, n)| ((*n).to_string(), format!("copy the page {n}")))
                        .collect(),
                    "set" => [
                        ("tabs=side", "tabs in a sidebar"),
                        ("tabs=top", "tabs on top"),
                    ]
                    .iter()
                    .map(|(n, d)| ((*n).to_string(), (*d).to_string()))
                    .collect(),
                    "vertical-tabs" | "sidebar" | "hide-tabs" => ["on", "off"]
                        .iter()
                        .map(|n| ((*n).to_string(), format!("turn {n}")))
                        .collect(),
                    "find" => ["next", "previous"]
                        .iter()
                        .map(|n| ((*n).to_string(), format!("{n} match")))
                        .collect(),
                    "palette" => PaletteKind::NAMED
                        .iter()
                        .map(|(k, n)| ((*n).to_string(), k.title().to_string()))
                        .collect(),
                    "browser" => BROWSER_COMMANDS
                        .iter()
                        .filter(|(n, _)| !n.starts_with("download-"))
                        .map(|(n, d)| ((*n).to_string(), (*d).to_string()))
                        .collect(),
                    "pin" => ["on", "off"]
                        .iter()
                        .map(|n| ((*n).to_string(), format!("pin {n}")))
                        .collect(),
                    "workspace" => [
                        ("save", "save this window's tabs"),
                        ("open", "open a saved workspace"),
                        ("delete", "delete a saved workspace"),
                        ("list", "list saved workspaces"),
                        ("project", "tie this workspace to a project folder"),
                    ]
                    .iter()
                    .map(|(n, d)| ((*n).to_string(), (*d).to_string()))
                    .collect(),
                    "extract" => ExtractKind::ALL
                        .iter()
                        .map(|(_, n, d)| ((*n).to_string(), format!("copy {d}")))
                        .collect(),
                    "jump" => BlockJump::ALL
                        .iter()
                        .map(|(_, n)| ((*n).to_string(), format!("next {n}")))
                        .collect(),
                    "macro" => [
                        ("record", "record keys into a register"),
                        ("stop", "stop recording"),
                        ("play", "replay a register"),
                    ]
                    .iter()
                    .map(|(n, d)| ((*n).to_string(), (*d).to_string()))
                    .collect(),
                    "select" => ["forward", "backward"]
                        .iter()
                        .map(|n| ((*n).to_string(), format!("extend the selection {n}")))
                        .collect(),
                    _ => Vec::new(),
                };
                words
                    .into_iter()
                    .filter(|(w, _)| w.starts_with(partial))
                    .map(|(w, summary)| Completion {
                        text: format!("{} {w}", spec.name),
                        summary,
                    })
                    .collect()
            }
        }
    }

    /// Help text: an overview, or details for one command.
    pub fn help(&self, topic: Option<&str>) -> Result<String, CommandError> {
        match topic {
            None => {
                let mut out = String::from("Commands:\n");
                for spec in self
                    .specs
                    .iter()
                    .filter(|s| s.status == CommandStatus::Available)
                {
                    out.push_str(&format!("  :{:<14} {}\n", spec.name, spec.summary));
                }
                out.push_str("Planned:\n  ");
                let planned: Vec<&str> = self
                    .specs
                    .iter()
                    .filter(|s| s.status == CommandStatus::Planned)
                    .map(|s| s.name)
                    .collect();
                out.push_str(&planned.join(", "));
                out.push('\n');
                Ok(out)
            }
            Some(topic) => {
                let topic = topic.strip_prefix(':').unwrap_or(topic);
                let spec = self.get(topic).ok_or_else(|| CommandError::Unknown {
                    name: topic.to_string(),
                    suggestion: self.suggest(topic),
                })?;
                let mut out = format!("{}\n  {}\n", spec.usage, spec.summary);
                if !spec.aliases.is_empty() {
                    let aliases: Vec<String> =
                        spec.aliases.iter().map(|a| format!(":{a}")).collect();
                    out.push_str(&format!("  Aliases: {}\n", aliases.join(", ")));
                }
                if spec.status == CommandStatus::Planned {
                    out.push_str("  Status: planned, not built yet\n");
                }
                Ok(out)
            }
        }
    }

    /// The closest name or alias within edit distance 2, if any. On a tie a
    /// canonical name beats an alias.
    fn suggest(&self, name: &str) -> Option<&'static str> {
        self.index
            .iter()
            .map(|(candidate, &i)| {
                let is_alias = self.specs[i].name != *candidate;
                (edit_distance(name, candidate), is_alias, *candidate)
            })
            .filter(|(d, _, _)| *d <= 2)
            .min()
            .map(|(_, _, c)| c)
    }
}

fn is_valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn tokenize(input: &str) -> Result<Vec<String>, CommandError> {
    let mut args = Vec::new();
    let mut chars = input.chars().peekable();
    loop {
        while chars.next_if(|c| c.is_whitespace()).is_some() {}
        let Some(&first) = chars.peek() else {
            return Ok(args);
        };
        let mut arg = String::new();
        match first {
            '"' => {
                chars.next();
                loop {
                    match chars.next() {
                        None => return Err(CommandError::UnterminatedQuote),
                        Some('"') => break,
                        Some('\\') => match chars.next() {
                            Some(c @ ('"' | '\\')) => arg.push(c),
                            Some(c) => {
                                arg.push('\\');
                                arg.push(c);
                            }
                            None => return Err(CommandError::UnterminatedQuote),
                        },
                        Some(c) => arg.push(c),
                    }
                }
            }
            '\'' => {
                chars.next();
                loop {
                    match chars.next() {
                        None => return Err(CommandError::UnterminatedQuote),
                        Some('\'') => break,
                        Some(c) => arg.push(c),
                    }
                }
            }
            _ => {
                while let Some(c) = chars.next_if(|c| !c.is_whitespace()) {
                    arg.push(c);
                }
            }
        }
        args.push(arg);
    }
}

fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for (i, ca) in a.chars().enumerate() {
        cur[0] = i + 1;
        for (j, &cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            cur[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

// ---------------------------------------------------------------------------
// Built-in commands
// ---------------------------------------------------------------------------

/// Modes that `:mode` may enter directly. Command and Hint have their own
/// entry points (`:cmdline`, `:hint`) because they need UI.
const SETTABLE_MODES: [Mode; 4] = [Mode::Normal, Mode::Insert, Mode::Visual, Mode::Passthrough];

fn no_args(inv: &Invocation, spec_usage: &'static str) -> Result<(), CommandError> {
    if inv.args.is_empty() {
        Ok(())
    } else {
        Err(CommandError::TooManyArguments {
            name: inv.name,
            usage: spec_usage,
        })
    }
}

/// At most one argument.
fn optional_arg<'a>(
    inv: &'a Invocation,
    usage: &'static str,
) -> Result<Option<&'a str>, CommandError> {
    match inv.args.as_slice() {
        [] => Ok(None),
        [a] => Ok(Some(a.as_str())),
        _ => Err(CommandError::TooManyArguments {
            name: inv.name,
            usage,
        }),
    }
}

fn invalid(inv: &Invocation, arg: &str, reason: impl Into<String>) -> CommandError {
    CommandError::InvalidArgument {
        name: inv.name,
        arg: arg.to_string(),
        reason: reason.into(),
    }
}

/// The count for commands that take one either from a key prefix or a
/// single numeric argument. Both together is an error.
fn count_arg(inv: &Invocation, usage: &'static str) -> Result<u32, CommandError> {
    match inv.args.as_slice() {
        [] => Ok(inv.count.unwrap_or(1)),
        [n] if inv.count.is_none() => match n.parse::<u32>() {
            Ok(v) if (1..=MAX_COUNT).contains(&v) => Ok(v),
            _ => Err(invalid(
                inv,
                n,
                format!("expected a count from 1 to {MAX_COUNT}"),
            )),
        },
        _ => Err(CommandError::TooManyArguments {
            name: inv.name,
            usage,
        }),
    }
}

fn open_target(inv: &Invocation) -> Result<OpenTarget, CommandError> {
    target::classify(&inv.joined_args()).map_err(|error| CommandError::Target {
        name: inv.name,
        error,
    })
}

const OPEN_USAGE: &str = ":open <url | search terms>";
const TABNEW_USAGE: &str = ":tabnew [url | search terms]";
const TABCLOSE_USAGE: &str = ":tabclose";
const TABNEXT_USAGE: &str = ":tabnext [count]";
const TABPREV_USAGE: &str = ":tabprevious [count]";
const TABRESTORE_USAGE: &str = ":tabrestore";
const TABFIRST_USAGE: &str = ":tabfirst";
const TABLAST_USAGE: &str = ":tablast";
const TABS_USAGE: &str = ":tabs";
const BUFFER_USAGE: &str = ":buffer [number | search terms]";
const BACK_USAGE: &str = ":back [count]";
const FORWARD_USAGE: &str = ":forward [count]";
const RELOAD_USAGE: &str = ":reload[!]";
const UP_USAGE: &str = ":up [count]";
const ROOT_USAGE: &str = ":root";
const SCROLL_USAGE: &str =
    ":scroll <down|up|left|right|top|bottom|half-down|half-up|page-down|page-up> [count]";
const FIND_USAGE: &str = ":find [next|previous]";
const ADDRESS_USAGE: &str = ":focus-address";
const CMDLINE_USAGE: &str = ":cmdline [text]";
const PALETTE_USAGE: &str = ":palette [commands|tabs|history|bookmarks|workspaces|outline|links]";
const HINT_USAGE: &str = ":hint [follow|tab|yank|input|edit|code|select]";
const YANK_USAGE: &str = ":yank [url|title|markdown|selection]";
const PASTE_USAGE: &str = ":paste [tab]";
const MODE_USAGE: &str = ":mode <normal|insert|visual|passthrough>";
const MAP_USAGE: &str = ":map <keys> <command>";
const UNMAP_USAGE: &str = ":unmap <keys>";
const CONFIG_RELOAD_USAGE: &str = ":config-reload";
const NOP_USAGE: &str = ":nop";
const VERTICAL_TABS_USAGE: &str = ":vertical-tabs [on|off]";
const SET_USAGE: &str = ":set tabs=top|side";
const SIDEBAR_USAGE: &str = ":sidebar [on|off]";
const HIDE_TABS_USAGE: &str = ":hide-tabs [on|off]";
const HELP_USAGE: &str = ":help [command]";
const SPLIT_USAGE: &str = ":split [url | search terms]";
const VSPLIT_USAGE: &str = ":vsplit [url | search terms]";
const ONLY_USAGE: &str = ":only";
const SPLIT_FOCUS_USAGE: &str = ":split-focus";
const SPLIT_SWAP_USAGE: &str = ":split-swap";
const PIN_USAGE: &str = ":pin [on|off]";
const WINDOW_USAGE: &str = ":window";
const PRIVATE_USAGE: &str = ":private";
const WORKSPACE_USAGE: &str =
    ":workspace [save [name] | open <name> | delete <name> | list | project <dir|clear>]";
const MARK_USAGE: &str = ":mark [a-z|A-Z]";
const JUMP_MARK_USAGE: &str = ":jump-mark [a-z|A-Z]";
const MARKS_USAGE: &str = ":marks";
const MACRO_USAGE: &str = ":macro <record [a-z] | stop | play [a-z|@]>";
const HISTORY_USAGE: &str = ":history [search terms]";
const BOOKMARK_USAGE: &str = ":bookmark";
const BOOKMARKS_USAGE: &str = ":bookmarks [search terms]";
const DOWNLOADS_USAGE: &str = ":downloads";
const SETTINGS_USAGE: &str = ":settings";
const EXTENSIONS_USAGE: &str = ":extensions";
const SITE_USAGE: &str = ":site";
const DEVTOOLS_USAGE: &str = ":devtools";
const BROWSER_USAGE: &str = ":browser <action> [download id]";
const PEEK_USAGE: &str = ":peek <url | search terms>";
const GROUP_USAGE: &str = ":group [name]";
const UNGROUP_USAGE: &str = ":ungroup";
const ADBLOCK_USAGE: &str = ":adblock [on|off|site toggle|status|update]";

/// What `:browser` runs: the window actions Chromium's ⋮ menu offered that
/// have no command of their own. Merlin's menu (`:palette menu`) lists
/// them; the `download-*` ones take a download id and back the downloads
/// palette.
pub const BROWSER_COMMANDS: [(&str, &str); 18] = [
    ("print", "print the page"),
    ("save-page", "save the page as a file"),
    ("zoom-in", "make the page larger"),
    ("zoom-out", "make the page smaller"),
    ("zoom-reset", "reset the page size"),
    ("fullscreen", "enter or leave full screen"),
    ("task-manager", "show what each tab and extension uses"),
    ("clear-data", "delete browsing data"),
    ("passwords", "open saved passwords"),
    ("cast", "cast this tab to a screen"),
    ("view-source", "show the page's source"),
    ("close-window", "close this window"),
    ("quit", "quit Merlin"),
    ("download-open", "open a downloaded file"),
    ("download-show", "show a download in Finder"),
    ("download-cancel", "cancel a download"),
    ("download-pause", "pause or resume a download"),
    ("download-retry", "download a failed file again"),
];
const READ_USAGE: &str = ":read";
const OUTLINE_USAGE: &str = ":outline";
const LINKS_USAGE: &str = ":links";
const EXTRACT_USAGE: &str = ":extract <markdown|text|links|code|headings> [editor]";
const JUMP_USAGE: &str = ":jump <heading|code|table|paragraph|link> [next|previous]";
const EDIT_USAGE: &str = ":edit[!]";
const SELECT_USAGE: &str =
    ":select <forward|backward> <character|word|line|sentence|paragraph|document>";

fn cmd_open(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    if inv.args.is_empty() {
        return Err(CommandError::MissingArgument {
            name: inv.name,
            usage: OPEN_USAGE,
        });
    }
    Ok(Effects::action(Action::Open {
        target: open_target(inv)?,
        disposition: Disposition::CurrentTab,
    }))
}

fn cmd_tabnew(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    if inv.args.is_empty() {
        return Ok(Effects::action(Action::NewTab));
    }
    Ok(Effects::action(Action::Open {
        target: open_target(inv)?,
        disposition: Disposition::NewForegroundTab,
    }))
}

fn cmd_tabclose(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, TABCLOSE_USAGE)?;
    Ok(Effects::action(Action::CloseTab))
}

fn cmd_tabnext(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let count = count_arg(inv, TABNEXT_USAGE)?;
    Ok(Effects::action(Action::NextTab { count }))
}

fn cmd_tabprevious(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let count = count_arg(inv, TABPREV_USAGE)?;
    Ok(Effects::action(Action::PreviousTab { count }))
}

fn cmd_tabrestore(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, TABRESTORE_USAGE)?;
    Ok(Effects::action(Action::RestoreTab))
}

fn cmd_tabfirst(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, TABFIRST_USAGE)?;
    Ok(Effects::action(Action::SelectTabEdge(TabEdge::First)))
}

fn cmd_tablast(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, TABLAST_USAGE)?;
    Ok(Effects::action(Action::SelectTabEdge(TabEdge::Last)))
}

fn cmd_tabs(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, TABS_USAGE)?;
    Ok(Effects::palette(PaletteKind::Tabs))
}

/// `:buffer` alone opens the tab switcher. A number selects that tab
/// (1-based, strip order); anything else picks the best fuzzy match.
fn cmd_buffer(inv: &Invocation, ctx: &Context) -> Result<Effects, CommandError> {
    if inv.args.is_empty() {
        // A count prefix (`3b`) means tab 3, like Vim's `:3b`.
        let Some(n) = inv.count else {
            return Ok(Effects::palette(PaletteKind::Tabs));
        };
        return buffer_number(inv, ctx, n as usize, &n.to_string());
    }
    let query = inv.joined_args();
    if let [only] = inv.args.as_slice()
        && let Ok(n) = only.parse::<usize>()
    {
        return buffer_number(inv, ctx, n, only);
    }
    let best = ctx
        .tabs
        .iter()
        .enumerate()
        .filter_map(|(i, t)| {
            fuzzy::match_fields(&query, &[&t.title, &t.url]).map(|m| (m.score, i, t))
        })
        .max_by_key(|(score, i, _)| (*score, std::cmp::Reverse(*i)));
    match best {
        Some((_, _, tab)) => Ok(Effects::action(Action::ActivateTab { id: tab.id })),
        None => Err(invalid(inv, &query, "no tab matches")),
    }
}

fn buffer_number(
    inv: &Invocation,
    ctx: &Context,
    n: usize,
    arg: &str,
) -> Result<Effects, CommandError> {
    match n.checked_sub(1).and_then(|i| ctx.tabs.get(i)) {
        Some(tab) => Ok(Effects::action(Action::ActivateTab { id: tab.id })),
        None => Err(invalid(
            inv,
            arg,
            format!("there are {} tabs", ctx.tabs.len()),
        )),
    }
}

fn cmd_back(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let count = count_arg(inv, BACK_USAGE)?;
    Ok(Effects::action(Action::Back { count }))
}

fn cmd_forward(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let count = count_arg(inv, FORWARD_USAGE)?;
    Ok(Effects::action(Action::Forward { count }))
}

fn cmd_reload(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, RELOAD_USAGE)?;
    Ok(Effects::action(Action::Reload {
        bypass_cache: inv.bang,
    }))
}

fn cmd_up(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let count = count_arg(inv, UP_USAGE)?;
    Ok(Effects::action(Action::NavigateUp { count }))
}

fn cmd_root(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, ROOT_USAGE)?;
    Ok(Effects::action(Action::NavigateRoot))
}

fn cmd_scroll(inv: &Invocation, ctx: &Context) -> Result<Effects, CommandError> {
    let Some(direction) = inv.args.first() else {
        return Err(CommandError::MissingArgument {
            name: inv.name,
            usage: SCROLL_USAGE,
        });
    };
    let scroll =
        Scroll::from_name(direction).ok_or_else(|| invalid(inv, direction, "unknown direction"))?;
    let rest = Invocation {
        args: inv.args[1..].to_vec(),
        ..inv.clone()
    };
    let count = count_arg(&rest, SCROLL_USAGE)?;
    Ok(Effects::action(Action::Scroll {
        scroll,
        count,
        step: ctx.options.scroll_step,
        smooth: ctx.options.smooth_scroll,
    }))
}

fn cmd_find(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let action = match optional_arg(inv, FIND_USAGE)? {
        None => Action::FindInPage,
        Some("next") => Action::FindNext,
        Some("previous" | "prev") => Action::FindPrevious,
        Some(other) => return Err(invalid(inv, other, "expected 'next' or 'previous'")),
    };
    Ok(Effects::action(action))
}

fn cmd_focus_address(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, ADDRESS_USAGE)?;
    Ok(Effects::action(Action::FocusAddressBar))
}

fn cmd_cmdline(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    // `:cmdline open` pre-fills "open " so the user types the argument next.
    let mut prefill = inv.joined_args();
    if !prefill.is_empty() {
        prefill.push(' ');
    }
    Ok(Effects::palette_with_text(
        PaletteKind::CommandLine,
        prefill,
    ))
}

fn cmd_palette(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let kind = match optional_arg(inv, PALETTE_USAGE)? {
        None => PaletteKind::Commands,
        Some(name) => PaletteKind::from_name(name).ok_or_else(|| {
            invalid(
                inv,
                name,
                "expected commands, tabs, history, bookmarks, workspaces, outline, links, menu or downloads",
            )
        })?,
    };
    Ok(Effects::palette(kind))
}

fn cmd_hint(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let action = match optional_arg(inv, HINT_USAGE)? {
        None => HintAction::Follow,
        Some(name) => HintAction::from_name(name).ok_or_else(|| {
            invalid(
                inv,
                name,
                "expected follow, tab, yank, input, edit, code or select",
            )
        })?,
    };
    Ok(Effects {
        // The session assigns the generation when it applies this.
        actions: vec![Action::CollectHints {
            generation: 0,
            action,
        }],
        enter_mode: Some(Mode::Hint),
        ..Effects::default()
    })
}

fn cmd_yank(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let kind = match optional_arg(inv, YANK_USAGE)? {
        None => YankKind::Url,
        Some(name) => YankKind::from_name(name)
            .ok_or_else(|| invalid(inv, name, "expected url, title, markdown or selection"))?,
    };
    if kind == YankKind::Selection {
        // Like Vim's `y` in Visual mode: copy, then back to Normal.
        return Ok(Effects {
            actions: vec![Action::Yank(kind), Action::ClearSelection],
            enter_mode: Some(Mode::Normal),
            ..Effects::default()
        });
    }
    Ok(Effects::action(Action::Yank(kind)))
}

fn cmd_paste(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let disposition = match optional_arg(inv, PASTE_USAGE)? {
        None => Disposition::CurrentTab,
        Some("tab") => Disposition::NewForegroundTab,
        Some(other) => return Err(invalid(inv, other, "expected 'tab'")),
    };
    Ok(Effects::action(Action::OpenClipboard { disposition }))
}

fn cmd_mode(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let name = match inv.args.as_slice() {
        [] => {
            return Err(CommandError::MissingArgument {
                name: inv.name,
                usage: MODE_USAGE,
            });
        }
        [name] => name,
        _ => {
            return Err(CommandError::TooManyArguments {
                name: inv.name,
                usage: MODE_USAGE,
            });
        }
    };
    match Mode::from_name(name) {
        Some(mode) if SETTABLE_MODES.contains(&mode) => Ok(Effects::mode(mode)),
        Some(mode) => Err(invalid(
            inv,
            name,
            format!(
                "{} mode is entered with {}",
                mode.name(),
                if mode == Mode::Command {
                    ":cmdline"
                } else {
                    ":hint"
                }
            ),
        )),
        None => Err(invalid(inv, name, "unknown mode")),
    }
}

fn cmd_map(inv: &Invocation, ctx: &Context) -> Result<Effects, CommandError> {
    let [keys, command @ ..] = inv.args.as_slice() else {
        return Err(CommandError::MissingArgument {
            name: inv.name,
            usage: MAP_USAGE,
        });
    };
    if command.is_empty() {
        return Err(CommandError::MissingArgument {
            name: inv.name,
            usage: MAP_USAGE,
        });
    }
    let command = command.join(" ");
    // A user-defined command binds to what it stands for.
    let command = ctx.expand_alias(&command).unwrap_or(command);
    // Validate the command now so `:map` fails at once, not on key press.
    // Mapping to `:map` itself is refused to keep bindings simple.
    let parsed = ctx.registry.parse(&command, None)?;
    if matches!(parsed.name, "map" | "unmap") {
        return Err(invalid(inv, &command, "bindings cannot change bindings"));
    }
    ctx.registry.run_in(&parsed, ctx)?;
    Ok(Effects {
        keymap_edits: vec![KeymapEdit::Map {
            mode: Mode::Normal,
            keys: keys.clone(),
            command,
        }],
        ..Effects::default()
    })
}

fn cmd_unmap(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let [keys] = inv.args.as_slice() else {
        return Err(if inv.args.is_empty() {
            CommandError::MissingArgument {
                name: inv.name,
                usage: UNMAP_USAGE,
            }
        } else {
            CommandError::TooManyArguments {
                name: inv.name,
                usage: UNMAP_USAGE,
            }
        });
    };
    Ok(Effects {
        keymap_edits: vec![KeymapEdit::Unmap {
            mode: Mode::Normal,
            keys: keys.clone(),
        }],
        ..Effects::default()
    })
}

fn cmd_config_reload(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, CONFIG_RELOAD_USAGE)?;
    Ok(Effects::action(Action::ReloadConfig))
}

/// No argument toggles; `on`/`off` set.
fn switch_arg(inv: &Invocation, usage: &'static str) -> Result<Switch, CommandError> {
    match optional_arg(inv, usage)? {
        None => Ok(Switch::Toggle),
        Some("on") => Ok(Switch::On),
        Some("off") => Ok(Switch::Off),
        Some(other) => Err(invalid(inv, other, "expected 'on' or 'off'")),
    }
}

fn cmd_vertical_tabs(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let switch = switch_arg(inv, VERTICAL_TABS_USAGE)?;
    Ok(Effects::action(Action::VerticalTabs(switch)))
}

/// `:set name=value` for the settings that change live. Only the tab
/// layout for now; the rest live in the configuration file.
fn cmd_set(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let Some(arg) = optional_arg(inv, SET_USAGE)? else {
        return Err(CommandError::MissingArgument {
            name: inv.name,
            usage: SET_USAGE,
        });
    };
    let Some((name, value)) = arg.split_once('=') else {
        return Err(invalid(inv, arg, "expected name=value, like tabs=side"));
    };
    match (name, value) {
        ("tabs", "side") => Ok(Effects::action(Action::VerticalTabs(Switch::On))),
        ("tabs", "top") => Ok(Effects::action(Action::VerticalTabs(Switch::Off))),
        ("tabs", _) => Err(invalid(inv, arg, "tabs is 'top' or 'side'")),
        _ => Err(invalid(inv, arg, "the only setting here is tabs=top|side")),
    }
}

fn cmd_sidebar(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let switch = switch_arg(inv, SIDEBAR_USAGE)?;
    Ok(Effects::action(Action::TabSidebar(switch)))
}

fn cmd_hide_tabs(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let switch = switch_arg(inv, HIDE_TABS_USAGE)?;
    Ok(Effects::action(Action::HideTabs(switch)))
}

fn cmd_nop(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, NOP_USAGE)?;
    Ok(Effects::default())
}

fn split(inv: &Invocation, layout: SplitLayout) -> Result<Effects, CommandError> {
    let target = if inv.args.is_empty() {
        None
    } else {
        Some(open_target(inv)?)
    };
    Ok(Effects::action(Action::Split { layout, target }))
}

fn cmd_split(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    split(inv, SplitLayout::Stacked)
}

fn cmd_vsplit(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    split(inv, SplitLayout::SideBySide)
}

fn cmd_only(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, ONLY_USAGE)?;
    Ok(Effects::action(Action::Unsplit))
}

fn cmd_split_focus(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, SPLIT_FOCUS_USAGE)?;
    Ok(Effects::action(Action::SplitFocusOther))
}

fn cmd_split_swap(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, SPLIT_SWAP_USAGE)?;
    Ok(Effects::action(Action::SplitSwap))
}

fn cmd_pin(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let switch = switch_arg(inv, PIN_USAGE)?;
    Ok(Effects::action(Action::PinTab(switch)))
}

fn cmd_window(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, WINDOW_USAGE)?;
    Ok(Effects::action(Action::NewWindow { private: false }))
}

fn cmd_private(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, PRIVATE_USAGE)?;
    Ok(Effects::action(Action::NewWindow { private: true }))
}

fn cmd_peek(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    if inv.args.is_empty() {
        return Err(CommandError::MissingArgument {
            name: inv.name,
            usage: PEEK_USAGE,
        });
    }
    Ok(Effects::action(Action::Open {
        target: open_target(inv)?,
        disposition: Disposition::Peek,
    }))
}

/// Adds the tab to the group with that name (any case), or to a new group
/// with that name; with no name, to a new unnamed group.
fn cmd_group(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let name = inv.joined_args();
    if name.chars().count() > 100 {
        return Err(invalid(
            inv,
            &name,
            "a group name is at most 100 characters",
        ));
    }
    Ok(Effects::action(Action::BrowserCommand {
        name: "group".into(),
        arg: name.trim().to_string(),
    }))
}

fn cmd_ungroup(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, UNGROUP_USAGE)?;
    Ok(Effects::action(Action::BrowserCommand {
        name: "ungroup".into(),
        arg: String::new(),
    }))
}

fn cmd_adblock(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let arg = match inv.args.as_slice() {
        [] => "status".to_string(),
        [verb] if matches!(verb.as_str(), "on" | "off" | "status" | "update") => verb.clone(),
        [site, toggle] if site == "site" && toggle == "toggle" => "site toggle".into(),
        _ => return Err(invalid(inv, &inv.args.join(" "), ADBLOCK_USAGE)),
    };
    Ok(Effects::action(Action::BrowserCommand {
        name: "adblock".into(),
        arg,
    }))
}

fn workspace_name<'a>(inv: &Invocation, name: &'a str) -> Result<&'a str, CommandError> {
    workspace::validate_name(name).map_err(|e| CommandError::InvalidArgument {
        name: inv.name,
        arg: name.to_string(),
        reason: match e {
            workspace::WorkspaceError::InvalidName { reason, .. } => reason,
            other => other.to_string(),
        },
    })
}

fn cmd_workspace(inv: &Invocation, ctx: &Context) -> Result<Effects, CommandError> {
    let missing = || CommandError::MissingArgument {
        name: inv.name,
        usage: WORKSPACE_USAGE,
    };
    let too_many = || CommandError::TooManyArguments {
        name: inv.name,
        usage: WORKSPACE_USAGE,
    };
    match inv.args.as_slice() {
        [] => Ok(Effects::palette(PaletteKind::Workspaces)),
        [list] if list == "list" => Ok(Effects::palette(PaletteKind::Workspaces)),
        [save, rest @ ..] if save == "save" => {
            if ctx.private {
                return Err(invalid(inv, save, "private windows are not saved to disk"));
            }
            let name = match rest {
                [] => ctx.workspace.ok_or_else(|| CommandError::InvalidArgument {
                    name: inv.name,
                    arg: "save".into(),
                    reason: "this window has no workspace yet; name it: :workspace save <name>"
                        .into(),
                })?,
                [name] => workspace_name(inv, name)?,
                _ => return Err(too_many()),
            };
            Ok(Effects::action(Action::SnapshotWorkspace {
                name: name.to_string(),
                quiet: false,
            }))
        }
        [verb, rest @ ..] if verb == "project" => match rest {
            [] => Err(missing()),
            [dir] if dir == "clear" => Ok(Effects::edit(SessionEdit::SetProject(None))),
            [dir] => {
                let dir = workspace::validate_project(dir).map_err(|reason| {
                    CommandError::InvalidArgument {
                        name: inv.name,
                        arg: dir.clone(),
                        reason,
                    }
                })?;
                Ok(Effects::edit(SessionEdit::SetProject(Some(dir))))
            }
            _ => Err(too_many()),
        },
        [verb, rest @ ..] if verb == "open" || verb == "delete" => {
            let name = match rest {
                [] => return Err(missing()),
                [name] => workspace_name(inv, name)?.to_string(),
                _ => return Err(too_many()),
            };
            Ok(Effects::action(if verb == "open" {
                Action::ReadWorkspace { name }
            } else {
                Action::DeleteWorkspace { name }
            }))
        }
        [other, ..] => Err(invalid(
            inv,
            other,
            "expected save, open, delete, list or project",
        )),
    }
}

fn cmd_history(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    Ok(Effects::palette_with_text(
        PaletteKind::History,
        inv.joined_args(),
    ))
}

fn cmd_bookmark(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, BOOKMARK_USAGE)?;
    Ok(Effects::action(Action::AddBookmark))
}

fn cmd_bookmarks(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    Ok(Effects::palette_with_text(
        PaletteKind::Bookmarks,
        inv.joined_args(),
    ))
}

fn page(inv: &Invocation, usage: &'static str, page: BrowserPage) -> Result<Effects, CommandError> {
    no_args(inv, usage)?;
    Ok(Effects::action(Action::ShowBrowserPage(page)))
}

fn cmd_downloads(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    page(inv, DOWNLOADS_USAGE, BrowserPage::Downloads)
}

fn cmd_settings(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    page(inv, SETTINGS_USAGE, BrowserPage::Settings)
}

fn cmd_extensions(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    page(inv, EXTENSIONS_USAGE, BrowserPage::Extensions)
}

fn cmd_site(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    page(inv, SITE_USAGE, BrowserPage::SiteInfo)
}

fn cmd_read(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    page(inv, READ_USAGE, BrowserPage::ReadingMode)
}

fn cmd_browser(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let (name, arg) = match inv.args.as_slice() {
        [name] => (name.as_str(), ""),
        [name, arg] => (name.as_str(), arg.as_str()),
        [] => {
            return Err(CommandError::MissingArgument {
                name: inv.name,
                usage: BROWSER_USAGE,
            });
        }
        _ => {
            return Err(CommandError::TooManyArguments {
                name: inv.name,
                usage: BROWSER_USAGE,
            });
        }
    };
    if !BROWSER_COMMANDS.iter().any(|(n, _)| *n == name) {
        return Err(invalid(inv, name, "see :help browser for the actions"));
    }
    let takes_id = name.starts_with("download-");
    if takes_id != !arg.is_empty() {
        return Err(invalid(
            inv,
            if arg.is_empty() { name } else { arg },
            if takes_id {
                "expected a download id"
            } else {
                "takes no argument"
            },
        ));
    }
    if takes_id && (arg.len() > 20 || !arg.bytes().all(|b| b.is_ascii_digit())) {
        return Err(invalid(inv, arg, "expected a download id"));
    }
    Ok(Effects::action(Action::BrowserCommand {
        name: name.to_string(),
        arg: arg.to_string(),
    }))
}

fn cmd_devtools(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, DEVTOOLS_USAGE)?;
    Ok(Effects::action(Action::ToggleDevTools))
}

fn cmd_outline(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    match optional_arg(inv, OUTLINE_USAGE)? {
        None => Ok(Effects::palette(PaletteKind::Outline)),
        // `:outline 12` jumps to entry 12 of the last extraction; this is
        // what the outline palette's rows run.
        Some(n) => {
            let element = n
                .parse::<u32>()
                .ok()
                .filter(|&e| e != crate::document::NO_ELEMENT)
                .ok_or_else(|| invalid(inv, n, "expected an outline entry number"))?;
            Ok(Effects::action(Action::RevealElement { element }))
        }
    }
}

fn cmd_links(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, LINKS_USAGE)?;
    Ok(Effects::palette(PaletteKind::Links))
}

fn cmd_extract(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let (kind, dest) = match inv.args.as_slice() {
        [] => {
            return Err(CommandError::MissingArgument {
                name: inv.name,
                usage: EXTRACT_USAGE,
            });
        }
        [kind] => (kind, None),
        [kind, dest] => (kind, Some(dest.as_str())),
        _ => {
            return Err(CommandError::TooManyArguments {
                name: inv.name,
                usage: EXTRACT_USAGE,
            });
        }
    };
    let kind = ExtractKind::from_name(kind).ok_or_else(|| {
        invalid(
            inv,
            kind,
            "expected markdown, text, links, code or headings",
        )
    })?;
    let dest = match dest {
        None | Some("clipboard") => ExtractDestination::Clipboard,
        Some("editor") => ExtractDestination::Editor,
        Some(other) => return Err(invalid(inv, other, "expected 'editor' or 'clipboard'")),
    };
    Ok(Effects::action(Action::CollectDocument {
        generation: 0,
        purpose: DocumentPurpose::Extract(kind, dest),
    }))
}

fn cmd_jump(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let (kind, direction) = match inv.args.as_slice() {
        [] => {
            return Err(CommandError::MissingArgument {
                name: inv.name,
                usage: JUMP_USAGE,
            });
        }
        [kind] => (kind, None),
        [kind, dir] => (kind, Some(dir.as_str())),
        _ => {
            return Err(CommandError::TooManyArguments {
                name: inv.name,
                usage: JUMP_USAGE,
            });
        }
    };
    let kind = BlockJump::from_name(kind).ok_or_else(|| {
        invalid(
            inv,
            kind,
            "expected heading, code, table, paragraph or link",
        )
    })?;
    let forward = match direction {
        None | Some("next") => true,
        Some("previous" | "prev") => false,
        Some(other) => return Err(invalid(inv, other, "expected 'next' or 'previous'")),
    };
    Ok(Effects::action(Action::JumpToBlock {
        kind,
        forward,
        count: inv.count.unwrap_or(1),
    }))
}

fn cmd_edit(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, EDIT_USAGE)?;
    Ok(Effects::action(Action::InspectField { force: inv.bang }))
}

fn cmd_select(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let [direction, unit] = inv.args.as_slice() else {
        return Err(if inv.args.len() < 2 {
            CommandError::MissingArgument {
                name: inv.name,
                usage: SELECT_USAGE,
            }
        } else {
            CommandError::TooManyArguments {
                name: inv.name,
                usage: SELECT_USAGE,
            }
        });
    };
    let forward = match direction.as_str() {
        "forward" => true,
        "backward" => false,
        other => return Err(invalid(inv, other, "expected 'forward' or 'backward'")),
    };
    let unit = SelectUnit::from_name(unit).ok_or_else(|| {
        invalid(
            inv,
            unit,
            "expected character, word, line, sentence, paragraph or document",
        )
    })?;
    Ok(Effects::action(Action::ExtendSelection {
        forward,
        unit,
        count: inv.count.unwrap_or(1),
    }))
}

fn letter_arg(inv: &Invocation, usage: &'static str) -> Result<Option<char>, CommandError> {
    match optional_arg(inv, usage)? {
        None => Ok(None),
        Some(a) => {
            let mut chars = a.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) if c.is_ascii_alphabetic() => Ok(Some(c)),
                _ => Err(invalid(inv, a, "expected a letter, a-z or A-Z")),
            }
        }
    }
}

fn cmd_mark(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    Ok(match letter_arg(inv, MARK_USAGE)? {
        None => Effects::awaiting(AwaitChar::SetMark),
        Some(letter) => Effects::action(Action::RecordMark { letter }),
    })
}

fn cmd_jump_mark(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    Ok(match letter_arg(inv, JUMP_MARK_USAGE)? {
        None => Effects::awaiting(AwaitChar::GoToMark),
        Some(letter) => Effects::edit(SessionEdit::GoToMark(letter)),
    })
}

fn cmd_marks(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    no_args(inv, MARKS_USAGE)?;
    Ok(Effects::edit(SessionEdit::ListMarks))
}

fn register_arg(inv: &Invocation, arg: &str, allow_last: bool) -> Result<char, CommandError> {
    let mut chars = arg.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if c.is_ascii_lowercase() => Ok(c),
        (Some('@'), None) if allow_last => Ok('@'),
        _ => Err(invalid(inv, arg, "registers are a-z")),
    }
}

fn cmd_macro(inv: &Invocation, _: &Context) -> Result<Effects, CommandError> {
    let too_many = || CommandError::TooManyArguments {
        name: inv.name,
        usage: MACRO_USAGE,
    };
    match inv.args.as_slice() {
        [] => Err(CommandError::MissingArgument {
            name: inv.name,
            usage: MACRO_USAGE,
        }),
        [verb] if verb == "record" => Ok(Effects::awaiting(AwaitChar::RecordMacro)),
        [verb, reg] if verb == "record" => Ok(Effects::edit(SessionEdit::StartRecording(
            register_arg(inv, reg, false)?,
        ))),
        [verb] if verb == "stop" => Ok(Effects::edit(SessionEdit::StopRecording)),
        [verb] if verb == "play" => Ok(Effects::awaiting(AwaitChar::PlayMacro)),
        [verb, reg] if verb == "play" => {
            let reg = register_arg(inv, reg, true)?;
            Ok(Effects::edit(SessionEdit::PlayMacro {
                register: (reg != '@').then_some(reg),
                count: inv.count.unwrap_or(1),
            }))
        }
        [verb, ..] if matches!(verb.as_str(), "record" | "stop" | "play") => Err(too_many()),
        [other, ..] => Err(invalid(inv, other, "expected record, stop or play")),
    }
}

fn cmd_help(inv: &Invocation, ctx: &Context) -> Result<Effects, CommandError> {
    match optional_arg(inv, HELP_USAGE)? {
        // The searchable command palette is the help overview: every
        // command and binding, with its keys.
        None => Ok(Effects::palette(PaletteKind::Commands)),
        Some(topic) => Ok(Effects::action(Action::ShowMessage {
            level: MessageLevel::Info,
            text: ctx.registry.help(Some(topic))?,
        })),
    }
}

fn available(
    name: &'static str,
    aliases: &'static [&'static str],
    usage: &'static str,
    summary: &'static str,
    handler: Handler,
) -> CommandSpec {
    CommandSpec {
        name,
        aliases,
        usage,
        summary,
        status: CommandStatus::Available,
        accepts_bang: false,
        handler: Some(handler),
    }
}

fn planned(
    name: &'static str,
    aliases: &'static [&'static str],
    usage: &'static str,
    summary: &'static str,
) -> CommandSpec {
    CommandSpec {
        name,
        aliases,
        usage,
        summary,
        status: CommandStatus::Planned,
        accepts_bang: false,
        handler: None,
    }
}

/// Whether running the command needs an argument, so the palette should
/// pre-fill the command line instead of running it.
pub fn needs_argument(spec: &CommandSpec) -> bool {
    let after_name = spec.usage.split_once(' ').map(|(_, rest)| rest);
    after_name.is_some_and(|rest| rest.starts_with('<'))
}

fn builtin_specs() -> Vec<CommandSpec> {
    vec![
        available(
            "open",
            &["o"],
            OPEN_USAGE,
            "open a URL or search in this tab",
            cmd_open,
        ),
        available(
            "tabnew",
            &["tabopen", "tabe", "tabedit"],
            TABNEW_USAGE,
            "open a new tab, optionally at a URL or search",
            cmd_tabnew,
        ),
        available(
            "tabclose",
            &["tabc"],
            TABCLOSE_USAGE,
            "close the current tab",
            cmd_tabclose,
        ),
        available(
            "tabnext",
            &["tabn"],
            TABNEXT_USAGE,
            "go to the next tab",
            cmd_tabnext,
        ),
        available(
            "tabprevious",
            &["tabp", "tabprev", "tabN"],
            TABPREV_USAGE,
            "go to the previous tab",
            cmd_tabprevious,
        ),
        available(
            "tabrestore",
            &["undo"],
            TABRESTORE_USAGE,
            "reopen the last closed tab",
            cmd_tabrestore,
        ),
        available(
            "tabfirst",
            &["tabfir"],
            TABFIRST_USAGE,
            "go to the first tab",
            cmd_tabfirst,
        ),
        available(
            "tablast",
            &["tabl"],
            TABLAST_USAGE,
            "go to the last tab",
            cmd_tablast,
        ),
        available("tabs", &[], TABS_USAGE, "search open tabs", cmd_tabs),
        available(
            "buffer",
            &["b"],
            BUFFER_USAGE,
            "switch to a tab by number or fuzzy search",
            cmd_buffer,
        ),
        available("back", &[], BACK_USAGE, "go back in history", cmd_back),
        available(
            "forward",
            &[],
            FORWARD_USAGE,
            "go forward in history",
            cmd_forward,
        ),
        CommandSpec {
            accepts_bang: true,
            ..available(
                "reload",
                &["r"],
                RELOAD_USAGE,
                "reload the page; '!' bypasses the cache",
                cmd_reload,
            )
        },
        available("up", &[], UP_USAGE, "go up one level in the URL", cmd_up),
        available("root", &[], ROOT_USAGE, "go to the site's root", cmd_root),
        available("scroll", &[], SCROLL_USAGE, "scroll the page", cmd_scroll),
        available(
            "find",
            &[],
            FIND_USAGE,
            "find in page, or jump to the next/previous match",
            cmd_find,
        ),
        available(
            "focus-address",
            &[],
            ADDRESS_USAGE,
            "focus the address bar",
            cmd_focus_address,
        ),
        available(
            "cmdline",
            &[],
            CMDLINE_USAGE,
            "open the command line, optionally pre-filled",
            cmd_cmdline,
        ),
        available(
            "palette",
            &[],
            PALETTE_USAGE,
            "search commands or tabs",
            cmd_palette,
        ),
        available(
            "hint",
            &[],
            HINT_USAGE,
            "label links to pick by keyboard",
            cmd_hint,
        ),
        available(
            "yank",
            &["y"],
            YANK_USAGE,
            "copy the page URL, title or a Markdown link",
            cmd_yank,
        ),
        available(
            "paste",
            &[],
            PASTE_USAGE,
            "open the URL or search on the clipboard",
            cmd_paste,
        ),
        available("mode", &[], MODE_USAGE, "switch input mode", cmd_mode),
        available(
            "map",
            &["nmap"],
            MAP_USAGE,
            "bind keys in Normal mode for this window",
            cmd_map,
        ),
        available(
            "unmap",
            &["nunmap"],
            UNMAP_USAGE,
            "remove a Normal-mode binding for this window",
            cmd_unmap,
        ),
        available(
            "config-reload",
            &["source"],
            CONFIG_RELOAD_USAGE,
            "reload the configuration file",
            cmd_config_reload,
        ),
        available(
            "peek",
            &[],
            PEEK_USAGE,
            "show a page in a floating preview over this tab",
            cmd_peek,
        ),
        available(
            "group",
            &[],
            GROUP_USAGE,
            "add this tab to a tab group, by name, or to a new one",
            cmd_group,
        ),
        available(
            "ungroup",
            &[],
            UNGROUP_USAGE,
            "take this tab out of its group",
            cmd_ungroup,
        ),
        available(
            "adblock",
            &[],
            ADBLOCK_USAGE,
            "control native ad blocking and filter updates",
            cmd_adblock,
        ),
        available(
            "set",
            &[],
            SET_USAGE,
            "change a setting: tabs=top or tabs=side",
            cmd_set,
        ),
        available(
            "vertical-tabs",
            &["vtabs"],
            VERTICAL_TABS_USAGE,
            "show tabs in a sidebar or on top",
            cmd_vertical_tabs,
        ),
        available(
            "sidebar",
            &[],
            SIDEBAR_USAGE,
            "expand or collapse the tab sidebar",
            cmd_sidebar,
        ),
        available(
            "hide-tabs",
            &[],
            HIDE_TABS_USAGE,
            "hide the tabs, or show them again",
            cmd_hide_tabs,
        ),
        available("nop", &[], NOP_USAGE, "do nothing", cmd_nop),
        available(
            "help",
            &["h"],
            HELP_USAGE,
            "search commands, or describe one",
            cmd_help,
        ),
        available(
            "vsplit",
            &["vs", "vsp"],
            VSPLIT_USAGE,
            "split the window side by side",
            cmd_vsplit,
        ),
        available(
            "split",
            &["sp", "hsplit", "hsp"],
            SPLIT_USAGE,
            "split the window top and bottom",
            cmd_split,
        ),
        available(
            "only",
            &["on", "unsplit"],
            ONLY_USAGE,
            "end the split view",
            cmd_only,
        ),
        available(
            "split-focus",
            &[],
            SPLIT_FOCUS_USAGE,
            "move to the other side of the split",
            cmd_split_focus,
        ),
        available(
            "split-swap",
            &[],
            SPLIT_SWAP_USAGE,
            "swap the two sides of the split",
            cmd_split_swap,
        ),
        available("pin", &[], PIN_USAGE, "pin or unpin the tab", cmd_pin),
        available(
            "window",
            &["new-window"],
            WINDOW_USAGE,
            "open a new window",
            cmd_window,
        ),
        available(
            "private",
            &["incognito"],
            PRIVATE_USAGE,
            "open a private window",
            cmd_private,
        ),
        available(
            "workspace",
            &["ws"],
            WORKSPACE_USAGE,
            "save, open or list workspaces",
            cmd_workspace,
        ),
        available("history", &[], HISTORY_USAGE, "search history", cmd_history),
        available(
            "bookmark",
            &[],
            BOOKMARK_USAGE,
            "bookmark this page",
            cmd_bookmark,
        ),
        available(
            "bookmarks",
            &[],
            BOOKMARKS_USAGE,
            "search bookmarks",
            cmd_bookmarks,
        ),
        available(
            "downloads",
            &[],
            DOWNLOADS_USAGE,
            "show downloads",
            cmd_downloads,
        ),
        available(
            "settings",
            &["preferences"],
            SETTINGS_USAGE,
            "open settings",
            cmd_settings,
        ),
        available(
            "extensions",
            &[],
            EXTENSIONS_USAGE,
            "manage extensions",
            cmd_extensions,
        ),
        available(
            "site",
            &["site-info", "permissions"],
            SITE_USAGE,
            "this site's connection, permissions and cookies",
            cmd_site,
        ),
        available(
            "browser",
            &[],
            BROWSER_USAGE,
            "print, zoom, full screen, task manager and other window actions",
            cmd_browser,
        ),
        available(
            "devtools",
            &[],
            DEVTOOLS_USAGE,
            "show or hide developer tools",
            cmd_devtools,
        ),
        available(
            "read",
            &["reader"],
            READ_USAGE,
            "open this page in Reading mode",
            cmd_read,
        ),
        available(
            "outline",
            &["toc"],
            OUTLINE_USAGE,
            "headings, code and tables on this page",
            cmd_outline,
        ),
        available(
            "links",
            &[],
            LINKS_USAGE,
            "search links on this page",
            cmd_links,
        ),
        available(
            "extract",
            &[],
            EXTRACT_USAGE,
            "copy the page as Markdown, text, links, code or headings",
            cmd_extract,
        ),
        available(
            "jump",
            &[],
            JUMP_USAGE,
            "go to the next heading, code block, table, ...",
            cmd_jump,
        ),
        CommandSpec {
            accepts_bang: true,
            ..available(
                "edit",
                &["external-edit"],
                EDIT_USAGE,
                "edit the focused field in your editor",
                cmd_edit,
            )
        },
        available(
            "select",
            &[],
            SELECT_USAGE,
            "extend the selection (Visual mode)",
            cmd_select,
        ),
        available(
            "mark",
            &[],
            MARK_USAGE,
            "remember this page and position",
            cmd_mark,
        ),
        available(
            "jump-mark",
            &["jm"],
            JUMP_MARK_USAGE,
            "go back to a mark",
            cmd_jump_mark,
        ),
        available("marks", &[], MARKS_USAGE, "list marks", cmd_marks),
        available(
            "macro",
            &[],
            MACRO_USAGE,
            "record and replay keys",
            cmd_macro,
        ),
        // Beyond the beta (product plan): listed in help, refused when run.
        planned(
            "script",
            &[],
            ":script <name>",
            "run a script plugin (after a permission model exists)",
        ),
    ]
}
