use modal_browser_core::ipc::{
    self, Envelope, OpenPlace, Request, TabSummary, WorkspaceRequest, encode_request, parse_reply,
    parse_request, reply_error, reply_ok,
};
use modal_browser_core::json::Value;

fn parse(line: &str) -> Request {
    parse_request(line)
        .unwrap_or_else(|e| panic!("{line}: {e}"))
        .request
}

fn error(line: &str) -> String {
    parse_request(line).expect_err(line).message
}

#[test]
fn every_request_round_trips() {
    let requests = [
        Request::Ping,
        Request::Open {
            target: "https://docs.rs".into(),
            place: OpenPlace::Background,
        },
        Request::Tabs,
        Request::Focus { tab: 3 },
        Request::Current,
        Request::Selection,
        Request::Workspace(WorkspaceRequest::Save("research".into())),
        Request::Workspace(WorkspaceRequest::Open("research".into())),
        Request::Workspace(WorkspaceRequest::Delete("old".into())),
        Request::Workspace(WorkspaceRequest::List),
        Request::Command {
            line: "vsplit \"https://a.b/c d\"".into(),
        },
        Request::ShellCall {
            method: "downloads.act".into(),
            args: r#"{"downloadId":"3","action":"pause"}"#.into(),
        },
    ];
    for (i, r) in requests.into_iter().enumerate() {
        let line = encode_request(i as u64, &r);
        assert!(!line.contains('\n'));
        assert_eq!(
            parse_request(&line),
            Ok(Envelope {
                id: Some(i as u64),
                request: r
            })
        );
    }
}

#[test]
fn defaults_and_minimal_requests() {
    assert_eq!(parse(r#"{"cmd":"ping"}"#), Request::Ping);
    assert_eq!(
        parse(r#"{"cmd":"open","url":"rust book"}"#),
        Request::Open {
            target: "rust book".into(),
            place: OpenPlace::Tab
        }
    );
}

#[test]
fn bad_requests_say_why_and_keep_the_id() {
    assert!(error("not json").contains("invalid JSON"));
    assert!(error("[1]").contains("JSON object"));
    assert!(error(r#"{"id":1}"#).contains("missing 'cmd'"));
    assert!(error(r#"{"cmd":"rm"}"#).contains("unknown command 'rm'"));
    assert!(error(r#"{"cmd":"tabs","url":"x"}"#).contains("does not take 'url'"));
    assert!(error(r#"{"cmd":"open"}"#).contains("needs 'url'"));
    assert!(error(r#"{"cmd":"open","url":"  "}"#).contains("needs 'url'"));
    assert!(error(r#"{"cmd":"open","url":1}"#).contains("must be a string"));
    assert!(error(r#"{"cmd":"open","url":"x","where":"moon"}"#).contains("'where'"));
    assert!(error(r#"{"cmd":"focus","tab":0}"#).contains("tab number"));
    assert!(error(r#"{"cmd":"focus","tab":"2"}"#).contains("tab number"));
    assert!(
        error(r#"{"cmd":"workspace","action":"save","name":"../x"}"#).contains("workspace name")
    );
    assert!(error(r#"{"cmd":"workspace","action":"burn","name":"x"}"#).contains("save, open"));
    assert!(error(r#"{"cmd":"workspace","action":"list","name":"x"}"#).contains("does not take"));
    assert!(error(r#"{"v":2,"cmd":"ping"}"#).contains("protocol version"));
    assert!(error(r#"{"id":-1,"cmd":"ping"}"#).contains("'id'"));
    let long = format!(
        r#"{{"cmd":"command","line":"{}"}}"#,
        "x".repeat(ipc::MAX_REQUEST_LEN)
    );
    assert!(error(&long).contains("longer than"));

    let e = parse_request(r#"{"id":9,"cmd":"rm"}"#).unwrap_err();
    assert_eq!(e.id, Some(9));
}

#[test]
fn replies() {
    let ok = reply_ok(Some(4), Value::string("done"));
    assert_eq!(ok, r#"{"v":1,"id":4,"ok":true,"result":"done"}"#);
    let parsed = parse_reply(&ok).unwrap();
    assert_eq!(parsed.id, Some(4));
    assert_eq!(parsed.result, Ok(Value::string("done")));

    let err = reply_error(None, "no window");
    assert_eq!(parse_reply(&err).unwrap().result, Err("no window".into()));
    assert!(parse_reply("{}").is_err());

    let tab = TabSummary {
        index: 2,
        id: 17,
        window: 1,
        title: "Docs \"quoted\"".into(),
        url: "https://docs.rs".into(),
        active: true,
        pinned: false,
        group: "Research".into(),
    };
    let line = reply_ok(Some(1), Value::Array(vec![tab.to_value()]));
    let result = parse_reply(&line).unwrap().result.unwrap();
    let back = TabSummary::from_value(&result.as_array().unwrap()[0]).unwrap();
    assert_eq!(back, tab);
}

#[test]
fn shell_calls_take_a_method_and_an_argument_object() {
    assert_eq!(
        parse(r#"{"cmd":"shell-call","method":"window.snapshot"}"#),
        Request::ShellCall {
            method: "window.snapshot".into(),
            args: "{}".into()
        }
    );
    assert_eq!(
        parse(r#"{"cmd":"shell-call","method":"bookmarks.export","args":{"path":"/tmp/b.html"}}"#),
        Request::ShellCall {
            method: "bookmarks.export".into(),
            args: r#"{"path":"/tmp/b.html"}"#.into()
        }
    );
    assert!(error(r#"{"cmd":"shell-call"}"#).contains("needs 'method'"));
    for bad in [
        "tabs",
        "tabs.",
        ".create",
        "Tabs.create",
        "tabs.Create",
        "tabs.cre-ate",
        "a.b c",
    ] {
        let line = format!(r#"{{"cmd":"shell-call","method":"{bad}"}}"#);
        assert!(error(&line).contains("not a shell method name"), "{bad}");
    }
    let long = format!(r#"{{"cmd":"shell-call","method":"a.{}"}}"#, "b".repeat(64));
    assert!(error(&long).contains("not a shell method name"));
    assert!(
        error(r#"{"cmd":"shell-call","method":"tabs.create","args":[]}"#)
            .contains("must be an object")
    );
    assert!(
        error(r#"{"cmd":"shell-call","method":"tabs.create","url":"x"}"#)
            .contains("does not take 'url'")
    );
}
