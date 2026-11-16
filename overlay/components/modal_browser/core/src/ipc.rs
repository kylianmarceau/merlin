//! The `browserctl` protocol: one JSON object per line over a Unix-domain
//! socket that only the same user can reach.
//!
//! ```text
//! -> {"v":1,"id":7,"cmd":"open","url":"https://docs.rs","where":"tab"}
//! <- {"v":1,"id":7,"ok":true,"result":"Opened in a new tab"}
//! -> {"v":1,"id":8,"cmd":"tabs"}
//! <- {"v":1,"id":8,"ok":true,"result":[{"index":1,"id":42,"title":"Docs.rs",...}]}
//! ```
//!
//! Both ends use this module: the browser parses requests and formats
//! replies, `browserctl` does the reverse. Requests are bounded
//! ([`MAX_REQUEST_LEN`]) and every field is type-checked; unknown commands
//! and fields are errors, so a typo never does something unexpected.
//!
//! Safety rules the host enforces (see `docs/ARCHITECTURE.md`): the socket
//! lives in a directory only the user can read, peers with another user id
//! are refused, private windows are never listed or read, and `command`
//! goes through the same registry as the `:` line, which refuses script
//! URLs and runs nothing outside the browser.
//!
//! `shell-call` is for end-to-end tests: it runs one React shell bridge
//! method in the front window, through the same dispatcher the shell uses,
//! and answers with its result. The browser refuses it unless it was started
//! with `--merlin-test-shell-api` and a `--user-data-dir`.

use std::fmt;

use crate::json::{self, Value};

pub const PROTOCOL_VERSION: u64 = 1;
/// Longest request line accepted, in bytes.
pub const MAX_REQUEST_LEN: usize = 64 * 1024;
/// Longest reply a client should accept, in bytes.
pub const MAX_REPLY_LEN: usize = 4 * 1024 * 1024;

/// Where `open` puts the page.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum OpenPlace {
    Current,
    #[default]
    Tab,
    Background,
    Window,
}

impl OpenPlace {
    pub const ALL: [(OpenPlace, &'static str); 4] = [
        (OpenPlace::Current, "current"),
        (OpenPlace::Tab, "tab"),
        (OpenPlace::Background, "background"),
        (OpenPlace::Window, "window"),
    ];

    pub fn from_name(name: &str) -> Option<OpenPlace> {
        Self::ALL.iter().find(|(_, n)| *n == name).map(|(p, _)| *p)
    }

    pub fn name(self) -> &'static str {
        Self::ALL
            .iter()
            .find(|(p, _)| *p == self)
            .map(|(_, n)| *n)
            .unwrap_or("tab")
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkspaceRequest {
    Save(String),
    Open(String),
    Delete(String),
    List,
    /// Open the workspace whose project folder contains this directory.
    Here(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Request {
    /// Is a browser listening? Replies with its protocol version.
    Ping,
    /// A URL or search terms.
    Open {
        target: String,
        place: OpenPlace,
    },
    /// Tabs of every normal (non-private) window.
    Tabs,
    /// Activate a tab of the front window by 1-based position.
    Focus {
        tab: u32,
    },
    /// The front window's active tab.
    Current,
    /// The selected text in the front window's active tab.
    Selection,
    Workspace(WorkspaceRequest),
    /// Any command line, as typed after `:`.
    Command {
        line: String,
    },
    /// Test builds only: one shell bridge method in the front window.
    /// `args` is the argument object as compact JSON.
    ShellCall {
        method: String,
        args: String,
    },
}

impl Request {
    pub fn name(&self) -> &'static str {
        match self {
            Request::Ping => "ping",
            Request::Open { .. } => "open",
            Request::Tabs => "tabs",
            Request::Focus { .. } => "focus",
            Request::Current => "current",
            Request::Selection => "selection",
            Request::Workspace(_) => "workspace",
            Request::Command { .. } => "command",
            Request::ShellCall { .. } => "shell-call",
        }
    }
}

/// A request with its correlation id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Envelope {
    pub id: Option<u64>,
    pub request: Request,
}

/// A rejected request: the id (if it could be read) and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RequestError {
    pub id: Option<u64>,
    pub message: String,
}

impl fmt::Display for RequestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

const COMMANDS: &[&str] = &[
    "ping",
    "open",
    "tabs",
    "focus",
    "current",
    "selection",
    "workspace",
    "command",
    "shell-call",
];

/// Longest shell method name, in bytes.
const MAX_METHOD_LEN: usize = 64;

/// A bridge method name as the shell vocabulary writes them: "tabs.create".
fn valid_method(name: &str) -> bool {
    let mut parts = name.split('.');
    let first = parts.next().unwrap_or("");
    let rest: Vec<&str> = parts.collect();
    name.len() <= MAX_METHOD_LEN
        && !first.is_empty()
        && first.bytes().all(|b| b.is_ascii_lowercase())
        && !rest.is_empty()
        && rest.iter().all(|p| {
            p.bytes().next().is_some_and(|b| b.is_ascii_lowercase())
                && p.bytes().all(|b| b.is_ascii_alphabetic())
        })
}

/// Parses one request line.
pub fn parse_request(line: &str) -> Result<Envelope, RequestError> {
    let fail = |id: Option<u64>, message: String| RequestError { id, message };
    if line.len() > MAX_REQUEST_LEN {
        return Err(fail(
            None,
            format!("request is longer than {MAX_REQUEST_LEN} bytes"),
        ));
    }
    let root = json::parse(line.trim()).map_err(|e| fail(None, e.to_string()))?;
    let Value::Object(fields) = &root else {
        return Err(fail(None, "a request is a JSON object".into()));
    };
    let id = match root.get("id") {
        None | Some(Value::Null) => None,
        Some(v) => Some(
            v.as_u64()
                .ok_or_else(|| fail(None, "'id' must be a whole number".into()))?,
        ),
    };
    match root.get("v").map(|v| v.as_u64()) {
        None => {}
        Some(Some(PROTOCOL_VERSION)) => {}
        Some(_) => {
            return Err(fail(
                id,
                format!("unsupported protocol version (this browser speaks {PROTOCOL_VERSION})"),
            ));
        }
    }
    let cmd = root
        .get("cmd")
        .and_then(Value::as_str)
        .ok_or_else(|| fail(id, "missing 'cmd'".into()))?;
    let allowed: &[&str] = match cmd {
        "open" => &["url", "where"],
        "focus" => &["tab"],
        "workspace" => &["action", "name", "dir"],
        "command" => &["line"],
        "shell-call" => &["method", "args"],
        c if COMMANDS.contains(&c) => &[],
        other => return Err(fail(id, format!("unknown command '{other}'"))),
    };
    for (key, _) in fields {
        if !matches!(key.as_str(), "v" | "id" | "cmd") && !allowed.contains(&key.as_str()) {
            return Err(fail(id, format!("'{cmd}' does not take '{key}'")));
        }
    }
    let string = |key: &str| -> Result<String, RequestError> {
        match root.get(key) {
            Some(Value::String(s)) if !s.trim().is_empty() => Ok(s.clone()),
            Some(Value::String(_)) | None => Err(fail(id, format!("'{cmd}' needs '{key}'"))),
            Some(v) => Err(fail(
                id,
                format!("'{key}' must be a string, not {}", v.type_name()),
            )),
        }
    };
    let request = match cmd {
        "ping" => Request::Ping,
        "tabs" => Request::Tabs,
        "current" => Request::Current,
        "selection" => Request::Selection,
        "open" => {
            let place = match root.get("where") {
                None => OpenPlace::default(),
                Some(Value::String(s)) => OpenPlace::from_name(s).ok_or_else(|| {
                    fail(
                        id,
                        format!("'where' must be current, tab, background or window, not '{s}'"),
                    )
                })?,
                Some(v) => {
                    return Err(fail(
                        id,
                        format!("'where' must be a string, not {}", v.type_name()),
                    ));
                }
            };
            Request::Open {
                target: string("url")?,
                place,
            }
        }
        "focus" => {
            let tab = root
                .get("tab")
                .and_then(Value::as_u64)
                .filter(|n| (1..=10_000).contains(n))
                .ok_or_else(|| fail(id, "'tab' must be a tab number from 1".into()))?;
            Request::Focus { tab: tab as u32 }
        }
        "workspace" => {
            let action = string("action")?;
            if action != "here" && root.get("dir").is_some() {
                return Err(fail(
                    id,
                    format!("'workspace {action}' does not take 'dir'"),
                ));
            }
            let named = |make: fn(String) -> WorkspaceRequest| -> Result<Request, RequestError> {
                let name = string("name")?;
                crate::workspace::validate_name(&name).map_err(|e| fail(id, e.to_string()))?;
                Ok(Request::Workspace(make(name)))
            };
            match action.as_str() {
                "save" => named(WorkspaceRequest::Save)?,
                "open" => named(WorkspaceRequest::Open)?,
                "delete" => named(WorkspaceRequest::Delete)?,
                "list" => {
                    if root.get("name").is_some() {
                        return Err(fail(id, "'workspace list' does not take 'name'".into()));
                    }
                    Request::Workspace(WorkspaceRequest::List)
                }
                "here" => {
                    let dir = string("dir")?;
                    let dir = crate::workspace::validate_project(&dir)
                        .map_err(|e| fail(id, format!("'dir': {e}")))?;
                    Request::Workspace(WorkspaceRequest::Here(dir))
                }
                other => {
                    return Err(fail(
                        id,
                        format!(
                            "workspace action must be save, open, delete, list or here, not '{other}'"
                        ),
                    ));
                }
            }
        }
        "command" => Request::Command {
            line: string("line")?,
        },
        "shell-call" => {
            let method = string("method")?;
            if !valid_method(&method) {
                return Err(fail(
                    id,
                    format!("'{method}' is not a shell method name like 'tabs.create'"),
                ));
            }
            let args = match root.get("args") {
                None => "{}".to_string(),
                Some(v @ Value::Object(_)) => v.to_json(),
                Some(v) => {
                    return Err(fail(
                        id,
                        format!("'args' must be an object, not {}", v.type_name()),
                    ));
                }
            };
            Request::ShellCall { method, args }
        }
        _ => unreachable!("checked against COMMANDS above"),
    };
    Ok(Envelope { id, request })
}

/// Encodes a request line (without the trailing newline).
pub fn encode_request(id: u64, request: &Request) -> String {
    let mut fields: Vec<(&str, Value)> = vec![
        ("v", Value::Number(PROTOCOL_VERSION as f64)),
        ("id", Value::Number(id as f64)),
        ("cmd", Value::string(request.name())),
    ];
    match request {
        Request::Open { target, place } => {
            fields.push(("url", Value::string(target)));
            fields.push(("where", Value::string(place.name())));
        }
        Request::Focus { tab } => fields.push(("tab", Value::from(*tab))),
        Request::Workspace(w) => {
            let (action, name) = match w {
                WorkspaceRequest::Save(n) => ("save", Some(n)),
                WorkspaceRequest::Open(n) => ("open", Some(n)),
                WorkspaceRequest::Delete(n) => ("delete", Some(n)),
                WorkspaceRequest::List => ("list", None),
                WorkspaceRequest::Here(dir) => {
                    fields.push(("action", Value::string("here")));
                    fields.push(("dir", Value::string(dir)));
                    return Value::object(fields).to_json();
                }
            };
            fields.push(("action", Value::string(action)));
            if let Some(n) = name {
                fields.push(("name", Value::string(n)));
            }
        }
        Request::Command { line } => fields.push(("line", Value::string(line))),
        Request::ShellCall { method, args } => {
            fields.push(("method", Value::string(method)));
            // Requests come from parse_request or a caller that checked args;
            // anything else is sent as no arguments.
            let args = match json::parse(args) {
                Ok(v @ Value::Object(_)) => v,
                _ => Value::Object(Vec::new()),
            };
            fields.push(("args", args));
        }
        Request::Ping | Request::Tabs | Request::Current | Request::Selection => {}
    }
    Value::object(fields).to_json()
}

fn reply(id: Option<u64>, ok: bool, key: &str, value: Value) -> String {
    let mut fields: Vec<(&str, Value)> = vec![("v", Value::Number(PROTOCOL_VERSION as f64))];
    if let Some(id) = id {
        fields.push(("id", Value::Number(id as f64)));
    }
    fields.push(("ok", Value::Bool(ok)));
    fields.push((key, value));
    Value::object(fields).to_json()
}

/// A successful reply line.
pub fn reply_ok(id: Option<u64>, result: Value) -> String {
    reply(id, true, "result", result)
}

/// A failed reply line.
pub fn reply_error(id: Option<u64>, message: &str) -> String {
    reply(id, false, "error", Value::string(message))
}

/// One tab in replies to `tabs` and `current`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TabSummary {
    /// 1-based position in its window.
    pub index: u32,
    /// Stable tab handle.
    pub id: i32,
    /// 1-based window number, front window first.
    pub window: u32,
    pub title: String,
    pub url: String,
    pub active: bool,
    pub pinned: bool,
    /// The title of the tab group it is in; empty when ungrouped (or when
    /// the group has no title).
    pub group: String,
}

impl TabSummary {
    pub fn to_value(&self) -> Value {
        Value::object([
            ("window", Value::from(self.window)),
            ("index", Value::from(self.index)),
            ("id", Value::from(self.id)),
            ("title", Value::string(&self.title)),
            ("url", Value::string(&self.url)),
            ("active", Value::Bool(self.active)),
            ("pinned", Value::Bool(self.pinned)),
            ("group", Value::string(&self.group)),
        ])
    }

    pub fn from_value(v: &Value) -> Option<TabSummary> {
        Some(TabSummary {
            window: v.get("window")?.as_u64()? as u32,
            index: v.get("index")?.as_u64()? as u32,
            id: v.get("id")?.as_i64()? as i32,
            title: v.get("title")?.as_str()?.to_string(),
            url: v.get("url")?.as_str()?.to_string(),
            active: v.get("active")?.as_bool()?,
            pinned: v.get("pinned").and_then(Value::as_bool).unwrap_or(false),
            group: v
                .get("group")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        })
    }
}

/// A parsed reply.
#[derive(Clone, Debug, PartialEq)]
pub struct Reply {
    pub id: Option<u64>,
    pub result: Result<Value, String>,
}

pub fn parse_reply(line: &str) -> Result<Reply, String> {
    if line.len() > MAX_REPLY_LEN {
        return Err(format!("reply is longer than {MAX_REPLY_LEN} bytes"));
    }
    let root = json::parse(line.trim()).map_err(|e| e.to_string())?;
    let id = root.get("id").and_then(Value::as_u64);
    match root.get("ok").and_then(Value::as_bool) {
        Some(true) => Ok(Reply {
            id,
            result: Ok(root.get("result").cloned().unwrap_or(Value::Null)),
        }),
        Some(false) => Ok(Reply {
            id,
            result: Err(root
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
                .to_string()),
        }),
        None => Err("reply has no 'ok' field".into()),
    }
}
