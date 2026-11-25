//! `browserctl`: drive the running browser from a terminal, Neovim or a
//! script.
//!
//! ```text
//! browserctl open https://docs.rs            # new tab (default)
//! browserctl open --current rust lifetimes   # search in the current tab
//! browserctl tabs [--json]
//! browserctl focus --tab 3
//! browserctl current [--json]
//! browserctl selection [--text]
//! browserctl space save|open|delete <name>
//! browserctl space list
//! browserctl space here                      # the saved space for this folder
//! browserctl space project [dir]             # tie the space showing to a folder
//! browserctl command 'vsplit https://docs.rs'
//! browserctl ping
//! browserctl shell-call window.snapshot '{}'  # test builds only (tests/e2e)
//! ```
//!
//! It talks to the browser over a Unix-domain socket that only the same user
//! can open (`$MODAL_BROWSER_SOCKET`, else `$TMPDIR/modal_browser/browserctl.sock`).
//! There is no network listener. Exit codes: 0 success, 1 the browser
//! refused, 2 usage error, 3 no browser reachable.

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use modal_browser_core::ipc::{
    self, OpenPlace, Request, TabSummary, WorkspaceRequest, encode_request, parse_reply,
};
use modal_browser_core::json::Value;

const USAGE: &str = "\
usage: browserctl [--socket PATH] <command> [options]

commands:
  open [--tab|--background|--window|--current] <url or search terms>
  tabs [--json]                 list tabs of normal windows
  focus --tab N                 switch the front window to tab N
  current [--json]              the front window's tab
  selection [--text]            the selected text in that tab
  space save|open|delete <name> saved spaces (`workspace` also works)
  space list [--json]
  space here                    open the saved space whose project holds this folder
  space project [DIR]           tie the space showing to DIR (default: here)
  command <line>                any ':' command, e.g. 'vsplit docs.rs'
  ping                          is a browser listening?
  shell-call METHOD [JSON]      tests only: one shell bridge method in the front
                                window (needs --merlin-test-shell-api)

The socket is $MODAL_BROWSER_SOCKET, else $TMPDIR/modal_browser/browserctl.sock.";

const EXIT_REFUSED: u8 = 1;
const EXIT_USAGE: u8 = 2;
const EXIT_UNREACHABLE: u8 = 3;

#[derive(Debug)]
struct Invocation {
    socket: PathBuf,
    request: Request,
    json: bool,
}

fn default_socket() -> PathBuf {
    if let Some(path) = std::env::var_os("MODAL_BROWSER_SOCKET").filter(|p| !p.is_empty()) {
        return PathBuf::from(path);
    }
    let tmp = std::env::var_os("TMPDIR")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    tmp.join("modal_browser").join("browserctl.sock")
}

fn parse_args(args: &[String]) -> Result<Invocation, String> {
    let mut socket = None;
    let mut json = false;
    let mut rest: Vec<&str> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--socket" => {
                i += 1;
                socket = Some(PathBuf::from(args.get(i).ok_or("--socket needs a path")?));
            }
            "--json" => json = true,
            "-h" | "--help" | "help" => return Err(String::new()),
            other => rest.push(other),
        }
        i += 1;
    }
    let Some((&command, args)) = rest.split_first() else {
        return Err(String::new());
    };
    let request = match command {
        "ping" => no_more(args, Request::Ping)?,
        "tabs" => no_more(args, Request::Tabs)?,
        "current" => no_more(args, Request::Current)?,
        "selection" => {
            let args: Vec<&str> = args.iter().copied().filter(|a| *a != "--text").collect();
            no_more(&args, Request::Selection)?
        }
        "open" => {
            let mut place = OpenPlace::Tab;
            let mut words = Vec::new();
            for a in args {
                match *a {
                    "--tab" => place = OpenPlace::Tab,
                    "--background" | "--bg" => place = OpenPlace::Background,
                    "--window" => place = OpenPlace::Window,
                    "--current" | "--here" => place = OpenPlace::Current,
                    flag if flag.starts_with("--") => return Err(format!("unknown option {flag}")),
                    word => words.push(word),
                }
            }
            if words.is_empty() {
                return Err("open needs a URL or search terms".into());
            }
            Request::Open {
                target: words.join(" "),
                place,
            }
        }
        "focus" => {
            let n = match args {
                ["--tab", n] | [n] => n,
                _ => return Err("usage: browserctl focus --tab N".into()),
            };
            let tab = n
                .parse::<u32>()
                .ok()
                .filter(|n| *n >= 1)
                .ok_or_else(|| format!("'{n}' is not a tab number"))?;
            Request::Focus { tab }
        }
        // Saved spaces were workspaces before Merlin had spaces.
        "space" | "workspace" => match args {
            ["list"] => Request::Workspace(WorkspaceRequest::List),
            ["here"] => Request::Workspace(WorkspaceRequest::Here(current_dir()?)),
            ["project"] => Request::Command {
                line: format!("space project {}", quote(&current_dir()?)),
            },
            ["project", dir] => Request::Command {
                line: format!("space project {}", quote(&absolute(dir)?)),
            },
            [verb, name] => {
                let name = name.to_string();
                Request::Workspace(match *verb {
                    "save" => WorkspaceRequest::Save(name),
                    "open" => WorkspaceRequest::Open(name),
                    "delete" => WorkspaceRequest::Delete(name),
                    other => return Err(format!("unknown space action '{other}'")),
                })
            }
            _ => {
                return Err(
                    "usage: browserctl space save|open|delete <name> | list | here | project [dir]"
                        .into(),
                );
            }
        },
        "command" => {
            if args.is_empty() {
                return Err("command needs a command line, e.g. 'vsplit docs.rs'".into());
            }
            Request::Command {
                line: args.join(" "),
            }
        }
        "shell-call" => {
            let (method, args) = match args {
                [method] => (*method, "{}"),
                [method, args] => (*method, *args),
                _ => return Err("usage: browserctl shell-call METHOD [JSON object]".into()),
            };
            match modal_browser_core::json::parse(args) {
                Ok(Value::Object(_)) => {}
                Ok(other) => {
                    return Err(format!(
                        "the arguments must be a JSON object, not {}",
                        other.type_name()
                    ));
                }
                Err(e) => return Err(format!("the arguments are not JSON: {e}")),
            }
            Request::ShellCall {
                method: method.to_string(),
                args: args.to_string(),
            }
        }
        other => return Err(format!("unknown command '{other}'")),
    };
    Ok(Invocation {
        socket: socket.unwrap_or_else(default_socket),
        request,
        json,
    })
}

fn current_dir() -> Result<String, String> {
    std::env::current_dir()
        .map(|d| d.to_string_lossy().into_owned())
        .map_err(|e| format!("cannot read the current folder: {e}"))
}

fn absolute(dir: &str) -> Result<String, String> {
    let path = std::path::Path::new(dir);
    let full = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::path::PathBuf::from(current_dir()?).join(path)
    };
    full.canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("{dir}: {e}"))
}

/// Quotes a command-line argument for the browser's `:` tokenizer.
fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

fn no_more(args: &[&str], request: Request) -> Result<Request, String> {
    match args.first() {
        None => Ok(request),
        Some(extra) => Err(format!("unexpected argument '{extra}'")),
    }
}

/// Sends one request and returns the reply line.
fn exchange(socket: &PathBuf, line: &str) -> Result<String, String> {
    let mut stream = UnixStream::connect(socket).map_err(|e| {
        format!(
            "no browser at {} ({e}). Is it running with browserctl enabled?",
            socket.display()
        )
    })?;
    let timeout = Some(Duration::from_secs(15));
    stream
        .set_read_timeout(timeout)
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(timeout)
        .map_err(|e| e.to_string())?;
    stream
        .write_all(format!("{line}\n").as_bytes())
        .map_err(|e| format!("sending: {e}"))?;
    let mut reader = BufReader::new(stream).take(ipc::MAX_REPLY_LEN as u64 + 1);
    let mut reply = String::new();
    reader
        .read_line(&mut reply)
        .map_err(|e| format!("reading the reply: {e}"))?;
    if reply.is_empty() {
        return Err("the browser closed the connection without replying".into());
    }
    Ok(reply)
}

fn print_human(request: &Request, result: &Value) {
    match (request, result) {
        (Request::Tabs, Value::Array(tabs)) => {
            for tab in tabs.iter().filter_map(TabSummary::from_value) {
                let group = if tab.group.is_empty() {
                    String::new()
                } else {
                    format!("[{}] ", tab.group)
                };
                println!(
                    "{}:{:<3} {} {}{}  {}",
                    tab.window,
                    tab.index,
                    if tab.active { "*" } else { " " },
                    group,
                    tab.title,
                    tab.url
                );
            }
        }
        (Request::Current, v) => {
            if let Some(tab) = TabSummary::from_value(v) {
                println!("{}\n{}", tab.title, tab.url);
            }
        }
        (_, Value::Array(items)) => {
            for item in items {
                println!("{}", item.as_str().unwrap_or(&item.to_json()));
            }
        }
        (_, Value::String(s)) => {
            if !s.is_empty() {
                println!("{s}");
            }
        }
        (_, Value::Null) => {}
        (_, other) => println!("{}", other.to_json()),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let invocation = match parse_args(&args) {
        Ok(i) => i,
        Err(e) => {
            if !e.is_empty() {
                eprintln!("browserctl: {e}");
            }
            eprintln!("{USAGE}");
            return ExitCode::from(if e.is_empty() && !args.is_empty() {
                0
            } else {
                EXIT_USAGE
            });
        }
    };
    let line = encode_request(1, &invocation.request);
    let reply = match exchange(&invocation.socket, &line) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("browserctl: {e}");
            return ExitCode::from(EXIT_UNREACHABLE);
        }
    };
    let reply = match parse_reply(&reply) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("browserctl: bad reply: {e}");
            return ExitCode::from(EXIT_REFUSED);
        }
    };
    match reply.result {
        Ok(value) => {
            if invocation.json {
                println!("{}", value.to_json());
            } else {
                print_human(&invocation.request, &value);
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("browserctl: {e}");
            ExitCode::from(EXIT_REFUSED)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Invocation, String> {
        parse_args(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn parses_the_plan_examples() {
        let open = parse(&["open", "https://docs.rs"]).unwrap();
        assert_eq!(
            open.request,
            Request::Open {
                target: "https://docs.rs".into(),
                place: OpenPlace::Tab
            }
        );
        assert!(parse(&["tabs", "--json"]).unwrap().json);
        assert_eq!(
            parse(&["focus", "--tab", "3"]).unwrap().request,
            Request::Focus { tab: 3 }
        );
        assert_eq!(
            parse(&["selection", "--text"]).unwrap().request,
            Request::Selection
        );
        assert_eq!(
            parse(&["workspace", "save", "research"]).unwrap().request,
            Request::Workspace(WorkspaceRequest::Save("research".into()))
        );
        assert_eq!(
            parse(&["command", "vsplit"]).unwrap().request,
            Request::Command {
                line: "vsplit".into()
            }
        );
        assert_eq!(
            parse(&[
                "shell-call",
                "downloads.act",
                r#"{"downloadId":"1","action":"show"}"#
            ])
            .unwrap()
            .request,
            Request::ShellCall {
                method: "downloads.act".into(),
                args: r#"{"downloadId":"1","action":"show"}"#.into()
            }
        );
        assert_eq!(
            parse(&["shell-call", "window.snapshot"]).unwrap().request,
            Request::ShellCall {
                method: "window.snapshot".into(),
                args: "{}".into()
            }
        );
        let s = parse(&["--socket", "/tmp/x.sock", "ping"]).unwrap();
        assert_eq!(s.socket, PathBuf::from("/tmp/x.sock"));
    }

    #[test]
    fn usage_errors() {
        assert!(parse(&[]).is_err());
        assert!(parse(&["open"]).is_err());
        assert!(parse(&["open", "--sideways", "x"]).is_err());
        assert!(parse(&["focus", "0"]).is_err());
        assert!(parse(&["workspace", "rename", "a"]).is_err());
        let here = parse(&["workspace", "here"]).unwrap().request;
        assert!(
            matches!(here, Request::Workspace(WorkspaceRequest::Here(d)) if d.starts_with('/'))
        );
        let project = parse(&["workspace", "project", "/tmp"]).unwrap().request;
        assert!(
            matches!(project, Request::Command { line } if line.starts_with("space project \"/"))
        );
        // `space` is the name now; `workspace` still works.
        let saved = parse(&["space", "save", "research"]).unwrap().request;
        assert!(matches!(saved, Request::Workspace(WorkspaceRequest::Save(n)) if n == "research"));
        assert!(parse(&["tabs", "extra"]).is_err());
        assert!(parse(&["shell-call"]).is_err());
        assert!(parse(&["shell-call", "tabs.create", "[1]"]).is_err());
        assert!(parse(&["shell-call", "tabs.create", "{oops"]).is_err());
        assert!(parse(&["frobnicate"]).is_err());
    }

    #[test]
    fn talks_to_a_socket() {
        // A fake browser: replies to one request on a temporary socket.
        let dir = std::env::temp_dir().join(format!("browserctl-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("s.sock");
        let _ = std::fs::remove_file(&path);
        let listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut line = String::new();
            BufReader::new(&stream).read_line(&mut line).unwrap();
            let envelope = ipc::parse_request(&line).unwrap();
            assert_eq!(envelope.request, Request::Ping);
            let mut stream = stream;
            writeln!(
                stream,
                "{}",
                ipc::reply_ok(envelope.id, Value::string("pong"))
            )
            .unwrap();
        });
        let reply = exchange(&path, &encode_request(1, &Request::Ping)).unwrap();
        server.join().unwrap();
        assert_eq!(
            parse_reply(&reply).unwrap().result,
            Ok(Value::string("pong"))
        );
        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            exchange(&dir.join("missing.sock"), "{}")
                .unwrap_err()
                .contains("no browser")
        );
    }
}
