//! Named workspaces: a saved set of tabs with pin state, split pairs and
//! the active tab, restored on demand.
//!
//! A workspace is *not* a profile. Profiles are Chromium storage identities
//! (cookies, credentials); a workspace is only a list of pages and how they
//! were laid out (`docs/DECISIONS.md` #11). Nothing private beyond URLs and
//! titles is stored: no form data, no scroll positions, no page content.
//!
//! The core encodes and decodes; the host reads and writes the files
//! (atomically, off the UI thread) under
//! `$XDG_DATA_HOME/modal_browser/workspaces/<name>.json`.
//!
//! File format, version 1:
//!
//! ```json
//! {
//!   "format": "modal_browser.workspace",
//!   "version": 1,
//!   "name": "research",
//!   "saved": 1761650000,
//!   "active": 1,
//!   "tabs": [
//!     {"url": "https://docs.rs", "title": "Docs.rs", "pinned": true},
//!     {"url": "https://github.com", "title": "GitHub"}
//!   ],
//!   "splits": [{"tabs": [0, 1], "layout": "side-by-side"}],
//!   "project": "/Users/me/code/foo"
//! }
//! ```
//!
//! `project` is optional: the folder of the code this workspace is for, so
//! `browserctl workspace here` in that folder (or below it) opens it.
//!
//! Newer versions are refused with a message rather than half-read, so a
//! file written by a newer browser is never silently damaged by an older one.

use std::fmt;

use crate::json::{self, Value};

pub const FORMAT: &str = "modal_browser.workspace";
pub const VERSION: u64 = 1;
/// Most tabs kept in one workspace.
pub const MAX_WORKSPACE_TABS: usize = 500;
/// Longest workspace name.
pub const MAX_NAME_LEN: usize = 64;
/// Largest workspace file accepted.
pub const MAX_FILE_LEN: usize = 2 * 1024 * 1024;
/// Characters kept from each URL and title.
const MAX_URL_LEN: usize = 8 * 1024;
const MAX_TITLE_LEN: usize = 1024;

/// How two tabs share the window in a split view.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum SplitLayout {
    /// Next to each other (`:vsplit`).
    #[default]
    SideBySide,
    /// One above the other (`:split`).
    Stacked,
}

impl SplitLayout {
    pub fn name(self) -> &'static str {
        match self {
            SplitLayout::SideBySide => "side-by-side",
            SplitLayout::Stacked => "stacked",
        }
    }

    pub fn from_name(name: &str) -> Option<SplitLayout> {
        match name {
            "side-by-side" => Some(SplitLayout::SideBySide),
            "stacked" => Some(SplitLayout::Stacked),
            _ => None,
        }
    }
}

/// One tab as the host reports it when saving.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WindowTab {
    pub url: String,
    pub title: String,
    pub pinned: bool,
    pub active: bool,
    /// Tabs with the same id share a split view; `None` when not split.
    pub split: Option<i32>,
    pub layout: SplitLayout,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceTab {
    pub url: String,
    pub title: String,
    pub pinned: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Split {
    /// Indices into `Workspace::tabs`, in order.
    pub tabs: [usize; 2],
    pub layout: SplitLayout,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Workspace {
    pub name: String,
    /// Absolute path of the project folder this workspace belongs to.
    pub project: Option<String>,
    /// Seconds since the Unix epoch.
    pub saved: i64,
    /// Index into `tabs`.
    pub active: usize,
    pub tabs: Vec<WorkspaceTab>,
    pub splits: Vec<Split>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkspaceError {
    InvalidName { name: String, reason: String },
    Empty,
    Json(json::ParseError),
    TooLarge,
    NotAWorkspace,
    NewerVersion(u64),
    Field { field: String, reason: String },
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidName { name, reason } => {
                write!(f, "'{name}' is not a workspace name: {reason}")
            }
            Self::Empty => f.write_str("there are no tabs to save"),
            Self::Json(e) => write!(f, "{e}"),
            Self::TooLarge => write!(f, "file is larger than {MAX_FILE_LEN} bytes"),
            Self::NotAWorkspace => f.write_str("not a workspace file"),
            Self::NewerVersion(v) => write!(
                f,
                "written by a newer browser (format version {v}; this one reads {VERSION})"
            ),
            Self::Field { field, reason } => write!(f, "'{field}': {reason}"),
        }
    }
}

impl std::error::Error for WorkspaceError {}

/// Checks a workspace name. Names become file names, so they are limited
/// to letters, digits, `-`, `_` and `.`, start with a letter or digit, and
/// are at most [`MAX_NAME_LEN`] characters.
pub fn validate_name(name: &str) -> Result<&str, WorkspaceError> {
    let invalid = |reason: &str| WorkspaceError::InvalidName {
        name: name.chars().take(MAX_NAME_LEN + 8).collect(),
        reason: reason.to_string(),
    };
    if name.is_empty() {
        return Err(invalid("it is empty"));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(invalid(&format!("longer than {MAX_NAME_LEN} characters")));
    }
    if !name
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphanumeric())
    {
        return Err(invalid("it must start with a letter or digit"));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(invalid("use letters, digits, '-', '_' and '.'"));
    }
    Ok(name)
}

/// Longest project path accepted.
pub const MAX_PROJECT_LEN: usize = 4096;

/// Checks a project folder path: absolute, no NUL, bounded. Trailing
/// slashes are removed so `/a/b/` and `/a/b` are the same project.
pub fn validate_project(path: &str) -> Result<String, String> {
    if !path.starts_with('/') {
        return Err("use an absolute path".into());
    }
    if path.len() > MAX_PROJECT_LEN || path.contains('\0') {
        return Err("not a usable folder path".into());
    }
    let trimmed = path.trim_end_matches('/');
    Ok(if trimmed.is_empty() {
        "/".into()
    } else {
        trimmed.into()
    })
}

/// The workspace whose project contains `dir` most closely: `dir` itself,
/// else its nearest ancestor. `entries` are (name, project) pairs.
pub fn best_for_dir<'a>(entries: &'a [(String, String)], dir: &str) -> Option<&'a str> {
    let dir = validate_project(dir).ok()?;
    entries
        .iter()
        .filter_map(|(name, project)| {
            let project = validate_project(project).ok()?;
            let contains = dir == project
                || project == "/"
                || (dir.starts_with(&project) && dir.as_bytes()[project.len()] == b'/');
            contains.then_some((project.len(), name.as_str()))
        })
        .max_by_key(|(len, name)| (*len, std::cmp::Reverse(*name)))
        .map(|(_, name)| name)
}

/// Whether a saved URL may be reopened. Pages the user could have had open
/// normally (web, files, the browser's own pages) are fine; script and
/// inline-content URLs are not, since the file may have been edited.
pub fn restorable_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    let Some((scheme, rest)) = lower.split_once(':') else {
        return false;
    };
    !rest.is_empty()
        && url.len() <= MAX_URL_LEN
        && matches!(scheme, "http" | "https" | "file" | "chrome" | "about")
}

fn bounded(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

impl Workspace {
    /// Builds a workspace from a window's tabs. Tabs whose URL cannot be
    /// restored (a `data:` page) are left out; splits whose two tabs are not
    /// both kept are dropped.
    pub fn from_window(
        name: &str,
        saved: i64,
        tabs: &[WindowTab],
        project: Option<&str>,
    ) -> Result<Self, WorkspaceError> {
        let name = validate_name(name)?.to_string();
        let mut out = Workspace {
            name,
            project: project.and_then(|p| validate_project(p).ok()),
            saved,
            active: 0,
            tabs: Vec::new(),
            splits: Vec::new(),
        };
        // Index in `out.tabs` of the first tab seen for each split id.
        let mut open_splits: Vec<(i32, usize, SplitLayout)> = Vec::new();
        for tab in tabs.iter().take(MAX_WORKSPACE_TABS) {
            if !restorable_url(&tab.url) {
                continue;
            }
            let index = out.tabs.len();
            out.tabs.push(WorkspaceTab {
                url: bounded(&tab.url, MAX_URL_LEN),
                title: bounded(&tab.title, MAX_TITLE_LEN),
                pinned: tab.pinned,
            });
            if tab.active {
                out.active = index;
            }
            if let Some(id) = tab.split {
                if let Some(pos) = open_splits.iter().position(|(s, _, _)| *s == id) {
                    let (_, first, layout) = open_splits.remove(pos);
                    out.splits.push(Split {
                        tabs: [first, index],
                        layout,
                    });
                } else {
                    open_splits.push((id, index, tab.layout));
                }
            }
        }
        if out.tabs.is_empty() {
            return Err(WorkspaceError::Empty);
        }
        Ok(out)
    }

    pub fn to_value(&self) -> Value {
        let tabs = self
            .tabs
            .iter()
            .map(|t| {
                let mut entries = vec![
                    ("url", Value::string(&t.url)),
                    ("title", Value::string(&t.title)),
                ];
                if t.pinned {
                    entries.push(("pinned", Value::Bool(true)));
                }
                Value::object(entries)
            })
            .collect();
        let splits = self
            .splits
            .iter()
            .map(|s| {
                Value::object([
                    (
                        "tabs",
                        Value::Array(vec![s.tabs[0].into(), s.tabs[1].into()]),
                    ),
                    ("layout", Value::string(s.layout.name())),
                ])
            })
            .collect();
        let mut fields = vec![
            ("format", Value::string(FORMAT)),
            ("version", Value::Number(VERSION as f64)),
            ("name", Value::string(&self.name)),
            ("saved", Value::from(self.saved)),
            ("active", Value::from(self.active)),
            ("tabs", Value::Array(tabs)),
            ("splits", Value::Array(splits)),
        ];
        if let Some(project) = &self.project {
            fields.push(("project", Value::string(project)));
        }
        Value::object(fields)
    }

    /// The file contents.
    pub fn encode(&self) -> String {
        self.to_value().to_json_pretty()
    }

    /// Reads a workspace file. `name` is the name the user asked for; the
    /// file's own `name` field is informational and does not override it.
    ///
    /// Unusable tabs are skipped rather than failing the whole file; the
    /// second value counts them.
    pub fn decode(name: &str, text: &str) -> Result<(Self, usize), WorkspaceError> {
        let name = validate_name(name)?.to_string();
        if text.len() > MAX_FILE_LEN {
            return Err(WorkspaceError::TooLarge);
        }
        let root = json::parse(text).map_err(WorkspaceError::Json)?;
        if root.get("format").and_then(Value::as_str) != Some(FORMAT) {
            return Err(WorkspaceError::NotAWorkspace);
        }
        let field = |field: &str, reason: &str| WorkspaceError::Field {
            field: field.to_string(),
            reason: reason.to_string(),
        };
        let version = root
            .get("version")
            .and_then(Value::as_u64)
            .ok_or_else(|| field("version", "expected a whole number"))?;
        if version > VERSION {
            return Err(WorkspaceError::NewerVersion(version));
        }
        if version == 0 {
            return Err(field("version", "expected 1"));
        }
        let saved = root.get("saved").and_then(Value::as_i64).unwrap_or(0);
        let tabs_in = root
            .get("tabs")
            .and_then(Value::as_array)
            .ok_or_else(|| field("tabs", "expected an array"))?;

        // Old index -> new index for kept tabs.
        let mut remap: Vec<Option<usize>> = Vec::with_capacity(tabs_in.len());
        let mut tabs = Vec::new();
        let mut skipped = 0;
        for t in tabs_in {
            let url = t.get("url").and_then(Value::as_str).unwrap_or("");
            if tabs.len() >= MAX_WORKSPACE_TABS || !restorable_url(url) {
                skipped += 1;
                remap.push(None);
                continue;
            }
            remap.push(Some(tabs.len()));
            tabs.push(WorkspaceTab {
                url: url.trim().to_string(),
                title: bounded(
                    t.get("title").and_then(Value::as_str).unwrap_or(""),
                    MAX_TITLE_LEN,
                ),
                pinned: t.get("pinned").and_then(Value::as_bool).unwrap_or(false),
            });
        }
        if tabs.is_empty() {
            return Err(WorkspaceError::Empty);
        }
        let mapped = |i: Option<u64>| {
            i.and_then(|i| usize::try_from(i).ok())
                .and_then(|i| remap.get(i).copied().flatten())
        };
        let active = mapped(root.get("active").and_then(Value::as_u64)).unwrap_or(0);

        let mut splits: Vec<Split> = Vec::new();
        for s in root.get("splits").and_then(Value::as_array).unwrap_or(&[]) {
            let pair = s.get("tabs").and_then(Value::as_array).unwrap_or(&[]);
            let [a, b] = pair else { continue };
            let (Some(a), Some(b)) = (mapped(a.as_u64()), mapped(b.as_u64())) else {
                continue;
            };
            // A tab can be in one split only, and not with itself.
            let used = |i: usize| splits.iter().any(|s| s.tabs.contains(&i));
            if a == b || used(a) || used(b) {
                continue;
            }
            let layout = s
                .get("layout")
                .and_then(Value::as_str)
                .and_then(SplitLayout::from_name)
                .unwrap_or_default();
            splits.push(Split {
                tabs: [a.min(b), a.max(b)],
                layout,
            });
        }
        let project = root
            .get("project")
            .and_then(Value::as_str)
            .and_then(|p| validate_project(p).ok());
        Ok((
            Workspace {
                name,
                project,
                saved,
                active,
                tabs,
                splits,
            },
            skipped,
        ))
    }

    /// The split a tab belongs to, if any.
    pub fn split_of(&self, index: usize) -> Option<&Split> {
        self.splits.iter().find(|s| s.tabs.contains(&index))
    }
}

/// The project folder a workspace file names, if it is a valid workspace
/// file with one. For matching folders without opening every workspace.
pub fn project_of(text: &str) -> Option<String> {
    if text.len() > MAX_FILE_LEN {
        return None;
    }
    let root = json::parse(text).ok()?;
    if root.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return None;
    }
    validate_project(root.get("project")?.as_str()?).ok()
}
