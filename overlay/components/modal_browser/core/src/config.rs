//! The user configuration file.
//!
//! ```toml
//! [options]
//! modal_browsing = true            # false: keys go to the page as in any browser
//! sequence_timeout_ms = 800        # 100..=5000
//! hint_chars = "asdfghjkl"
//! auto_insert = true
//! passthrough_exit = "<S-Esc>"
//! scroll_step = 80                 # pixels per j/k, 10..=2000
//! smooth_scroll = true             # animate page-sized jumps
//! passthrough_sites = ["mail.google.com", "*.figma.com"]
//! tabs = "side"                    # "side" (a rail) or "top"; vertical_tabs = true|false also works
//! restore_session = true           # reopen last session's windows at launch
//! workspace_autosave = true        # keep an opened workspace saved as it changes
//! browserctl = true                # accept commands from browserctl (same user only)
//! editor = ["/Applications/Ghostty.app/Contents/MacOS/ghostty", "--quit-after-last-window-closed=true", "-e", "nvim", "{file}"]  # for :edit; else $VISUAL
//!
//! edit_key = "<C-S-e>"           # in a text field: open it in the editor
//!
//! [aliases]                        # your own commands
//! issues = "open github.com/issues"
//!
//! [keys.normal]
//! "<C-n>" = "tabnext"
//! x = "tabclose"
//!
//! [unmap]
//! normal = ["d"]                   # the page gets these keys again
//! ```
//!
//! The file is read by the host (the core does no I/O). Parsing collects
//! every error with its line instead of stopping at the first, and the
//! valid parts still apply, so one typo does not throw away a whole
//! keymap. Key notation and command lines are validated by the session,
//! which owns the registry.

use std::fmt;

use crate::hints::HintAlphabet;
use crate::key::{Key, KeySequence};
use crate::mode::Mode;
use crate::toml_lite::{self, Value};

/// Most entries applied from `[keys.*]` and `[unmap]`.
pub const MAX_BINDINGS: usize = 1000;
/// Most site patterns.
pub const MAX_SITES: usize = 200;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigError {
    pub line: usize,
    pub message: String,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "line {}: {}", self.line, self.message)
    }
}

/// A host pattern: `example.com` matches exactly; `*.example.com` matches
/// `example.com` and every subdomain.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SitePattern {
    domain: String,
    subdomains: bool,
}

impl SitePattern {
    pub fn parse(pattern: &str) -> Result<Self, String> {
        let lower = pattern.trim().to_ascii_lowercase();
        let (subdomains, domain) = match lower.strip_prefix("*.") {
            Some(rest) => (true, rest.to_string()),
            None => (false, lower.clone()),
        };
        let valid = !domain.is_empty()
            && domain.len() <= 253
            && !domain.starts_with('.')
            && !domain.ends_with('.')
            && !domain.contains("..")
            && domain
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.');
        if !valid {
            return Err(format!(
                "'{pattern}' is not a host pattern (use 'example.com' or '*.example.com', no scheme or path)"
            ));
        }
        Ok(Self { domain, subdomains })
    }

    pub fn matches(&self, host: &str) -> bool {
        let host = host.trim_end_matches('.').to_ascii_lowercase();
        if host == self.domain {
            return true;
        }
        self.subdomains
            && host.len() > self.domain.len()
            && host.ends_with(&self.domain)
            && host.as_bytes()[host.len() - self.domain.len() - 1] == b'.'
    }
}

impl fmt::Display for SitePattern {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.subdomains {
            f.write_str("*.")?;
        }
        f.write_str(&self.domain)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapEntry {
    pub mode: Mode,
    pub keys: String,
    pub command: String,
    pub line: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AliasEntry {
    pub name: String,
    pub command: String,
    pub line: usize,
}

/// Most user-defined commands.
pub const MAX_ALIASES: usize = 200;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnmapEntry {
    pub mode: Mode,
    pub keys: String,
    pub line: usize,
}

/// Everything the file sets. `None` means "keep the default".
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConfigFile {
    pub modal_browsing: Option<bool>,
    pub sequence_timeout_ms: Option<u32>,
    pub hint_chars: Option<HintAlphabet>,
    pub auto_insert: Option<bool>,
    pub passthrough_exit: Option<Key>,
    pub scroll_step: Option<u32>,
    pub smooth_scroll: Option<bool>,
    pub passthrough_sites: Option<Vec<SitePattern>>,
    pub vertical_tabs: Option<bool>,
    pub restore_session: Option<bool>,
    pub workspace_autosave: Option<bool>,
    pub browserctl: Option<bool>,
    pub editor: Option<Vec<String>>,
    pub edit_key: Option<Key>,
    pub aliases: Vec<AliasEntry>,
    pub maps: Vec<MapEntry>,
    pub unmaps: Vec<UnmapEntry>,
}

const OPTION_NAMES: &[&str] = &[
    "modal_browsing",
    "sequence_timeout_ms",
    "hint_chars",
    "auto_insert",
    "passthrough_exit",
    "scroll_step",
    "smooth_scroll",
    "passthrough_sites",
    "vertical_tabs",
    "tabs",
    "restore_session",
    "workspace_autosave",
    "browserctl",
    "editor",
    "edit_key",
];
const TABLE_NAMES: &[&str] = &["options", "keys", "unmap", "aliases"];

fn bindable_mode(name: &str) -> Option<Mode> {
    Mode::from_name(name).filter(|m| m.accepts_bindings())
}

fn closest<'a>(word: &str, candidates: &[&'a str]) -> Option<&'a str> {
    candidates
        .iter()
        .map(|c| (edit_distance(word, c), *c))
        .filter(|(d, _)| *d <= 3)
        .min()
        .map(|(_, c)| c)
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

fn unknown(kind: &str, name: &str, candidates: &[&str]) -> String {
    match closest(name, candidates) {
        Some(s) => format!("unknown {kind} '{name}' (did you mean '{s}'?)"),
        None => format!("unknown {kind} '{name}'"),
    }
}

fn expect_bool(name: &str, v: &Value) -> Result<bool, String> {
    match v {
        Value::Boolean(b) => Ok(*b),
        other => Err(format!(
            "'{name}' must be true or false, not a {}",
            other.type_name()
        )),
    }
}

fn expect_int(name: &str, v: &Value, min: i64, max: i64) -> Result<u32, String> {
    match v {
        Value::Integer(i) if (min..=max).contains(i) => Ok(*i as u32),
        Value::Integer(i) => Err(format!("'{name}' must be from {min} to {max}, not {i}")),
        other => Err(format!(
            "'{name}' must be an integer, not a {}",
            other.type_name()
        )),
    }
}

fn expect_str<'a>(name: &str, v: &'a Value) -> Result<&'a str, String> {
    match v {
        Value::String(s) => Ok(s),
        other => Err(format!(
            "'{name}' must be a string, not a {}",
            other.type_name()
        )),
    }
}

fn expect_str_array<'a>(name: &str, v: &'a Value) -> Result<Vec<&'a str>, String> {
    let Value::Array(items) = v else {
        return Err(format!(
            "'{name}' must be an array of strings, not a {}",
            v.type_name()
        ));
    };
    items.iter().map(|i| expect_str(name, i)).collect()
}

impl ConfigFile {
    /// Parses the file. Returns what could be understood plus every error.
    pub fn parse(text: &str) -> (ConfigFile, Vec<ConfigError>) {
        let mut config = ConfigFile::default();
        let mut errors = Vec::new();
        let entries = match toml_lite::parse(text) {
            Ok(entries) => entries,
            Err(e) => {
                errors.push(ConfigError {
                    line: e.line,
                    message: e.message,
                });
                return (config, errors);
            }
        };
        for entry in entries {
            if let Err(message) = config.apply_entry(&entry.path, &entry.value, entry.line) {
                errors.push(ConfigError {
                    line: entry.line,
                    message,
                });
            }
        }
        (config, errors)
    }

    fn apply_entry(&mut self, path: &[String], value: &Value, line: usize) -> Result<(), String> {
        let parts: Vec<&str> = path.iter().map(String::as_str).collect();
        match parts.as_slice() {
            ["options", name] => self.apply_option(name, value),
            ["options", ..] => Err("options are not nested; use [options] name = value".into()),
            ["keys", mode, keys] => {
                let mode = bindable_mode(mode).ok_or_else(|| {
                    format!("[keys.{mode}]: only normal and visual take bindings")
                })?;
                let command = expect_str(keys, value)?;
                if self.maps.len() + self.unmaps.len() >= MAX_BINDINGS {
                    return Err(format!("more than {MAX_BINDINGS} bindings"));
                }
                self.maps.push(MapEntry {
                    mode,
                    keys: (*keys).to_string(),
                    command: command.to_string(),
                    line,
                });
                Ok(())
            }
            ["keys", ..] => Err(
                "bindings go in a [keys.normal] or [keys.visual] table: \"keys\" = \"command\""
                    .into(),
            ),
            ["aliases", name] => {
                let valid = name.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
                    && name
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                    && name.len() <= 64;
                if !valid {
                    return Err(format!(
                        "'{name}' is not a command name (letters, digits, '-' and '_', starting with a letter)"
                    ));
                }
                if self.aliases.len() >= MAX_ALIASES {
                    return Err(format!("more than {MAX_ALIASES} aliases"));
                }
                let command = expect_str(name, value)?;
                if command.trim().is_empty() {
                    return Err(format!("alias '{name}' is empty"));
                }
                self.aliases.push(AliasEntry {
                    name: (*name).to_string(),
                    command: command.trim().to_string(),
                    line,
                });
                Ok(())
            }
            ["aliases", ..] => Err("aliases are name = \"command line\" in [aliases]".into()),
            ["unmap", mode] => {
                let mode = bindable_mode(mode).ok_or_else(|| {
                    format!("[unmap] {mode}: only normal and visual take bindings")
                })?;
                for keys in expect_str_array(mode.name(), value)? {
                    if self.maps.len() + self.unmaps.len() >= MAX_BINDINGS {
                        return Err(format!("more than {MAX_BINDINGS} bindings"));
                    }
                    self.unmaps.push(UnmapEntry {
                        mode,
                        keys: keys.to_string(),
                        line,
                    });
                }
                Ok(())
            }
            [top, ..] => Err(unknown("table", top, TABLE_NAMES)),
            [] => Err("empty key".into()),
        }
    }

    fn apply_option(&mut self, name: &str, value: &Value) -> Result<(), String> {
        match name {
            "sequence_timeout_ms" => {
                self.sequence_timeout_ms = Some(expect_int(name, value, 100, 5000)?);
            }
            "hint_chars" => {
                let chars = expect_str(name, value)?;
                self.hint_chars = Some(HintAlphabet::new(chars).map_err(|e| e.to_string())?);
            }
            "modal_browsing" => self.modal_browsing = Some(expect_bool(name, value)?),
            "auto_insert" => self.auto_insert = Some(expect_bool(name, value)?),
            "passthrough_exit" => {
                let notation = expect_str(name, value)?;
                let seq = KeySequence::parse(notation).map_err(|e| format!("'{name}': {e}"))?;
                let [key] = seq.keys() else {
                    return Err(format!("'{name}' must be a single key, like \"<S-Esc>\""));
                };
                if key.is_escape() {
                    return Err(format!(
                        "'{name}' cannot be plain <Esc>: sites in passthrough need it"
                    ));
                }
                self.passthrough_exit = Some(*key);
            }
            "edit_key" => {
                let notation = expect_str(name, value)?;
                let seq = KeySequence::parse(notation).map_err(|e| format!("'{name}': {e}"))?;
                let [key] = seq.keys() else {
                    return Err(format!("'{name}' must be a single key, like \"<C-S-e>\""));
                };
                let m = key.mods();
                if !(m.contains(crate::key::Modifiers::CTRL)
                    || m.contains(crate::key::Modifiers::META))
                {
                    return Err(format!(
                        "'{name}' needs Control or Command, or it would take a key you type"
                    ));
                }
                self.edit_key = Some(*key);
            }
            "scroll_step" => self.scroll_step = Some(expect_int(name, value, 10, 2000)?),
            "smooth_scroll" => self.smooth_scroll = Some(expect_bool(name, value)?),
            "vertical_tabs" => self.vertical_tabs = Some(expect_bool(name, value)?),
            "tabs" => {
                self.vertical_tabs = Some(match expect_str(name, value)? {
                    "side" => true,
                    "top" => false,
                    other => {
                        return Err(format!(
                            "'{name}' must be \"top\" or \"side\", not \"{other}\""
                        ));
                    }
                })
            }
            "restore_session" => self.restore_session = Some(expect_bool(name, value)?),
            "workspace_autosave" => self.workspace_autosave = Some(expect_bool(name, value)?),
            "browserctl" => self.browserctl = Some(expect_bool(name, value)?),
            "editor" => {
                let argv = expect_str_array(name, value)?;
                if argv.is_empty() || argv[0].trim().is_empty() {
                    return Err(format!(
                        "'{name}' needs a program, like [\"ghostty\", \"-e\", \"nvim\", \"{{file}}\"]"
                    ));
                }
                if argv.len() > crate::editor::MAX_EDITOR_ARGS {
                    return Err(format!(
                        "'{name}' has more than {} arguments",
                        crate::editor::MAX_EDITOR_ARGS
                    ));
                }
                self.editor = Some(argv.into_iter().map(str::to_string).collect());
            }
            "passthrough_sites" => {
                let patterns = expect_str_array(name, value)?;
                if patterns.len() > MAX_SITES {
                    return Err(format!("'{name}' has more than {MAX_SITES} entries"));
                }
                self.passthrough_sites = Some(
                    patterns
                        .into_iter()
                        .map(SitePattern::parse)
                        .collect::<Result<_, _>>()?,
                );
            }
            other => return Err(unknown("option", other, OPTION_NAMES)),
        }
        Ok(())
    }
}
