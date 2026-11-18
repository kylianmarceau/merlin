//! Named workspaces: a saved set of tabs with pin state, split pairs, tab
//! groups, the active tab and the window's place on screen, restored on
//! demand.
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
//!     {"url": "https://github.com", "title": "GitHub", "group": 0},
//!     {"url": "https://crates.io", "title": "crates.io", "group": 0},
//!     {"url": "https://www.netflix.com/browse", "title": "Netflix", "engine": "webkit"}
//!   ],
//!   "splits": [{"tabs": [1, 2], "layout": "side-by-side", "ratio": 0.5}],
//!   "groups": [{"title": "Rust", "color": "blue", "collapsed": false}],
//!   "window": {"x": 40, "y": 60, "width": 1400, "height": 900,
//!              "maximized": false},
//!   "project": "/Users/me/code/foo"
//! }
//! ```
//!
//! `project` is optional: the folder of the code this workspace is for, so
//! `browserctl workspace here` in that folder (or below it) opens it.
//! `groups`, `window` and a split's `ratio` are optional too: files written
//! before they existed still open, with no groups and the default window.
//! A tab's `"engine": "webkit"` says the shell showed it in WebKit, so its
//! address is WebKit's page; reopening loads it and the engine its site uses
//! then shows it.
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

/// A tab group's color, by the names Chromium's group editor shows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum GroupColor {
    #[default]
    Grey,
    Blue,
    Red,
    Yellow,
    Green,
    Pink,
    Purple,
    Cyan,
    Orange,
}

impl GroupColor {
    pub const ALL: [GroupColor; 9] = [
        GroupColor::Grey,
        GroupColor::Blue,
        GroupColor::Red,
        GroupColor::Yellow,
        GroupColor::Green,
        GroupColor::Pink,
        GroupColor::Purple,
        GroupColor::Cyan,
        GroupColor::Orange,
    ];

    pub fn name(self) -> &'static str {
        match self {
            GroupColor::Grey => "grey",
            GroupColor::Blue => "blue",
            GroupColor::Red => "red",
            GroupColor::Yellow => "yellow",
            GroupColor::Green => "green",
            GroupColor::Pink => "pink",
            GroupColor::Purple => "purple",
            GroupColor::Cyan => "cyan",
            GroupColor::Orange => "orange",
        }
    }

    pub fn from_name(name: &str) -> Option<GroupColor> {
        GroupColor::ALL.into_iter().find(|c| c.name() == name)
    }
}

/// A tab group as the host reports it on each of its tabs.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WindowGroup {
    /// Tabs with the same id are in the same group.
    pub id: i32,
    pub title: String,
    pub color: GroupColor,
    pub collapsed: bool,
}

/// One tab as the host reports it when saving.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WindowTab {
    pub url: String,
    pub title: String,
    pub pinned: bool,
    pub active: bool,
    /// Tabs with the same id share a split view; `None` when not split.
    pub split: Option<i32>,
    pub layout: SplitLayout,
    /// The first tab's share of the split, from 0 to 1; `None` if unknown.
    pub split_ratio: Option<f64>,
    pub group: Option<WindowGroup>,
    /// The shell shows the tab in WebKit; `url` and `title` are WebKit's page.
    pub webkit: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceTab {
    pub url: String,
    pub title: String,
    pub pinned: bool,
    /// Index into `Workspace::groups`. Pinned tabs are never grouped.
    pub group: Option<usize>,
    /// Shown in WebKit when saved (`"engine": "webkit"`). Reopening loads
    /// the address, and the engine its site uses then shows it.
    pub webkit: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Split {
    /// Indices into `Workspace::tabs`, in order.
    pub tabs: [usize; 2],
    pub layout: SplitLayout,
    /// The first tab's share of the window in thousandths; `None` for an
    /// even split. Written to the file as a fraction (`0.5`).
    pub ratio: Option<u16>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Group {
    pub title: String,
    pub color: GroupColor,
    pub collapsed: bool,
}

/// Where the window was, in screen coordinates (its normal, unzoomed
/// bounds).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    /// Zoomed to fill the screen.
    pub maximized: bool,
}

/// Bounds on what a window can be: on screen somewhere sensible, and big
/// enough to use.
const MIN_WINDOW_SIDE: i32 = 200;
const MAX_WINDOW_SIDE: i32 = 32_000;
const MAX_WINDOW_OFFSET: i32 = 64_000;
/// Longest group title kept.
const MAX_GROUP_TITLE_LEN: usize = 256;

impl WindowBounds {
    /// `None` for bounds no screen could show.
    pub fn validated(self) -> Option<WindowBounds> {
        let side = MIN_WINDOW_SIDE..=MAX_WINDOW_SIDE;
        let offset = -MAX_WINDOW_OFFSET..=MAX_WINDOW_OFFSET;
        (side.contains(&self.width)
            && side.contains(&self.height)
            && offset.contains(&self.x)
            && offset.contains(&self.y))
        .then_some(self)
    }
}

/// A split's ratio, in thousandths, if it is one Chromium would draw.
fn usable_ratio(ratio: f64) -> Option<u16> {
    (ratio.is_finite() && (0.05..=0.95).contains(&ratio)).then(|| (ratio * 1000.0).round() as u16)
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
    pub groups: Vec<Group>,
    /// `None` when the file does not say (the host picks).
    pub window: Option<WindowBounds>,
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
    /// both kept are dropped, and so are groups with no tab kept.
    pub fn from_window(
        name: &str,
        saved: i64,
        tabs: &[WindowTab],
        project: Option<&str>,
        window: Option<WindowBounds>,
    ) -> Result<Self, WorkspaceError> {
        let name = validate_name(name)?.to_string();
        let mut out = Workspace {
            name,
            project: project.and_then(|p| validate_project(p).ok()),
            saved,
            active: 0,
            tabs: Vec::new(),
            splits: Vec::new(),
            groups: Vec::new(),
            window: window.and_then(WindowBounds::validated),
        };
        // Index in `out.tabs` of the first tab seen for each split id.
        let mut open_splits: Vec<(i32, usize, SplitLayout, Option<f64>)> = Vec::new();
        // Host group id -> index in `out.groups`.
        let mut group_ids: Vec<i32> = Vec::new();
        for tab in tabs.iter().take(MAX_WORKSPACE_TABS) {
            if !restorable_url(&tab.url) {
                continue;
            }
            let index = out.tabs.len();
            let group = tab.group.as_ref().filter(|_| !tab.pinned).map(|g| {
                group_ids
                    .iter()
                    .position(|id| *id == g.id)
                    .unwrap_or_else(|| {
                        group_ids.push(g.id);
                        out.groups.push(Group {
                            title: bounded(&g.title, MAX_GROUP_TITLE_LEN),
                            color: g.color,
                            collapsed: g.collapsed,
                        });
                        out.groups.len() - 1
                    })
            });
            out.tabs.push(WorkspaceTab {
                url: bounded(&tab.url, MAX_URL_LEN),
                title: bounded(&tab.title, MAX_TITLE_LEN),
                pinned: tab.pinned,
                group,
                webkit: tab.webkit,
            });
            if tab.active {
                out.active = index;
            }
            if let Some(id) = tab.split {
                if let Some(pos) = open_splits.iter().position(|(s, ..)| *s == id) {
                    let (_, first, layout, ratio) = open_splits.remove(pos);
                    // The browser keeps both halves in one pin state and
                    // group; a pair that is not cannot be restored as one.
                    let (a, b) = (&out.tabs[first], &out.tabs[index]);
                    if a.pinned != b.pinned || a.group != b.group {
                        continue;
                    }
                    out.splits.push(Split {
                        tabs: [first, index],
                        layout,
                        ratio: ratio.and_then(usable_ratio),
                    });
                } else {
                    open_splits.push((id, index, tab.layout, tab.split_ratio));
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
                if let Some(group) = t.group {
                    entries.push(("group", Value::from(group)));
                }
                if t.webkit {
                    entries.push(("engine", Value::string("webkit")));
                }
                Value::object(entries)
            })
            .collect();
        let splits = self
            .splits
            .iter()
            .map(|s| {
                let mut entries = vec![
                    (
                        "tabs",
                        Value::Array(vec![s.tabs[0].into(), s.tabs[1].into()]),
                    ),
                    ("layout", Value::string(s.layout.name())),
                ];
                if let Some(ratio) = s.ratio {
                    entries.push(("ratio", Value::Number(f64::from(ratio) / 1000.0)));
                }
                Value::object(entries)
            })
            .collect();
        let groups = self
            .groups
            .iter()
            .map(|g| {
                Value::object([
                    ("title", Value::string(&g.title)),
                    ("color", Value::string(g.color.name())),
                    ("collapsed", Value::Bool(g.collapsed)),
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
            ("groups", Value::Array(groups)),
        ];
        if let Some(w) = self.window {
            fields.push((
                "window",
                Value::object([
                    ("x", Value::from(w.x)),
                    ("y", Value::from(w.y)),
                    ("width", Value::from(w.width)),
                    ("height", Value::from(w.height)),
                    ("maximized", Value::Bool(w.maximized)),
                ]),
            ));
        }
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

        // Groups first: tabs refer to them by index.
        let groups: Vec<Group> = root
            .get("groups")
            .and_then(Value::as_array)
            .unwrap_or(&[])
            .iter()
            .take(MAX_WORKSPACE_TABS)
            .map(|g| Group {
                title: bounded(
                    g.get("title").and_then(Value::as_str).unwrap_or(""),
                    MAX_GROUP_TITLE_LEN,
                ),
                color: g
                    .get("color")
                    .and_then(Value::as_str)
                    .and_then(GroupColor::from_name)
                    .unwrap_or_default(),
                collapsed: g.get("collapsed").and_then(Value::as_bool).unwrap_or(false),
            })
            .collect();

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
            let pinned = t.get("pinned").and_then(Value::as_bool).unwrap_or(false);
            let group = t
                .get("group")
                .and_then(Value::as_u64)
                .and_then(|g| usize::try_from(g).ok())
                .filter(|g| *g < groups.len() && !pinned);
            tabs.push(WorkspaceTab {
                url: url.trim().to_string(),
                title: bounded(
                    t.get("title").and_then(Value::as_str).unwrap_or(""),
                    MAX_TITLE_LEN,
                ),
                pinned,
                group,
                webkit: t.get("engine").and_then(Value::as_str) == Some("webkit"),
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
            // A tab can be in one split only, and not with itself. Both
            // halves share a pin state and a group, as in the browser.
            let used = |i: usize| splits.iter().any(|s| s.tabs.contains(&i));
            if a == b
                || used(a)
                || used(b)
                || tabs[a].pinned != tabs[b].pinned
                || tabs[a].group != tabs[b].group
            {
                continue;
            }
            let layout = s
                .get("layout")
                .and_then(Value::as_str)
                .and_then(SplitLayout::from_name)
                .unwrap_or_default();
            let ratio = s
                .get("ratio")
                .and_then(Value::as_f64)
                .and_then(usable_ratio);
            splits.push(Split {
                tabs: [a.min(b), a.max(b)],
                layout,
                // The ratio belongs to the tab listed first.
                ratio: ratio.map(|r| if a <= b { r } else { 1000 - r }),
            });
        }
        // Groups no kept tab uses are dropped; indices are renumbered.
        let mut used_groups: Vec<usize> = tabs.iter().filter_map(|t| t.group).collect();
        used_groups.sort_unstable();
        used_groups.dedup();
        for t in &mut tabs {
            t.group = t
                .group
                .and_then(|g| used_groups.iter().position(|u| *u == g));
        }
        let groups: Vec<Group> = used_groups.iter().map(|g| groups[*g].clone()).collect();
        let window = root.get("window").and_then(|w| {
            let side = |key: &str| {
                w.get(key)
                    .and_then(Value::as_i64)
                    .and_then(|v| i32::try_from(v).ok())
            };
            WindowBounds {
                x: side("x")?,
                y: side("y")?,
                width: side("width")?,
                height: side("height")?,
                maximized: w.get("maximized").and_then(Value::as_bool).unwrap_or(false),
            }
            .validated()
        });
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
                groups,
                window,
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
