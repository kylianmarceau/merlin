use modal_browser_core::workspace::{self, Split, VERSION, restorable_url, validate_name};
use modal_browser_core::{SplitLayout, WindowTab, Workspace, WorkspaceError};

fn tab(url: &str) -> WindowTab {
    WindowTab {
        url: url.into(),
        title: format!("Title of {url}"),
        ..WindowTab::default()
    }
}

#[test]
fn names_become_safe_file_names() {
    for good in ["research", "rust-2026", "a", "x.y_z", "9lives"] {
        assert_eq!(validate_name(good), Ok(good));
    }
    for bad in [
        "",
        "../etc",
        "a/b",
        "-x",
        ".hidden",
        "has space",
        "émoji",
        &"a".repeat(65),
    ] {
        assert!(validate_name(bad).is_err(), "accepted {bad:?}");
    }
}

#[test]
fn only_reopenable_urls_are_kept() {
    for ok in [
        "https://docs.rs",
        "http://localhost:3000/x",
        "file:///tmp/a.html",
        "chrome://settings",
        "about:blank",
    ] {
        assert!(restorable_url(ok), "{ok}");
    }
    for bad in [
        "javascript:alert(1)",
        "data:text/html,hi",
        "blob:https://x/y",
        "nonsense",
        "https:",
    ] {
        assert!(!restorable_url(bad), "{bad}");
    }
}

#[test]
fn from_window_keeps_pins_splits_and_the_active_tab() {
    let tabs = vec![
        WindowTab {
            pinned: true,
            ..tab("https://mail.example.com")
        },
        tab("data:text/html,<p>scratch"),
        WindowTab {
            split: Some(7),
            layout: SplitLayout::Stacked,
            ..tab("https://docs.rs")
        },
        WindowTab {
            split: Some(7),
            active: true,
            ..tab("https://github.com")
        },
        // A split whose partner was dropped is not a split.
        WindowTab {
            split: Some(9),
            ..tab("https://lonely.example")
        },
    ];
    let ws = Workspace::from_window("research", 1_761_650_000, &tabs, None).unwrap();
    assert_eq!(ws.tabs.len(), 4, "the data: URL is left out");
    assert!(ws.tabs[0].pinned);
    assert_eq!(ws.active, 2);
    assert_eq!(
        ws.splits,
        vec![Split {
            tabs: [1, 2],
            layout: SplitLayout::Stacked
        }]
    );
    assert_eq!(
        Workspace::from_window("x", 0, &[tab("javascript:void(0)")], None),
        Err(WorkspaceError::Empty)
    );
    assert!(Workspace::from_window("bad/name", 0, &tabs, None).is_err());
}

#[test]
fn encode_decode_round_trip() {
    let tabs = vec![
        tab("https://a.example"),
        WindowTab {
            split: Some(1),
            ..tab("https://b.example")
        },
        WindowTab {
            split: Some(1),
            active: true,
            pinned: true,
            ..tab("https://c.example")
        },
    ];
    let ws = Workspace::from_window("round", 1234, &tabs, None).unwrap();
    let text = ws.encode();
    assert!(text.contains("\"format\": \"modal_browser.workspace\""));
    assert!(text.contains("\"layout\": \"side-by-side\""));
    let (back, skipped) = Workspace::decode("round", &text).unwrap();
    assert_eq!(skipped, 0);
    assert_eq!(back, ws);
}

#[test]
fn decode_is_forgiving_per_tab_and_strict_per_file() {
    let text = r#"{
        "format": "modal_browser.workspace", "version": 1, "name": "other-name",
        "active": 2,
        "tabs": [
            {"url": "javascript:alert(1)"},
            {"url": "https://kept.example", "title": "Kept"},
            {"url": "https://also.example", "pinned": true},
            {"no-url": true}
        ],
        "splits": [{"tabs": [0, 1]}, {"tabs": [1, 2], "layout": "stacked"}, {"tabs": [2, 2]}]
    }"#;
    let (ws, skipped) = Workspace::decode("mine", text).unwrap();
    assert_eq!(ws.name, "mine", "the requested name wins over the file's");
    assert_eq!(skipped, 2);
    assert_eq!(ws.tabs.len(), 2);
    assert_eq!(ws.active, 1, "active index follows the kept tabs");
    assert!(ws.tabs[1].pinned);
    assert_eq!(
        ws.splits,
        vec![Split {
            tabs: [0, 1],
            layout: SplitLayout::Stacked
        }]
    );

    assert!(matches!(
        Workspace::decode("x", "{\"format\":\"other\"}"),
        Err(WorkspaceError::NotAWorkspace)
    ));
    let newer = format!(
        "{{\"format\":\"{}\",\"version\":{},\"tabs\":[]}}",
        workspace::FORMAT,
        VERSION + 1
    );
    assert_eq!(
        Workspace::decode("x", &newer),
        Err(WorkspaceError::NewerVersion(VERSION + 1))
    );
    assert!(matches!(
        Workspace::decode("x", "{"),
        Err(WorkspaceError::Json(_))
    ));
    assert!(matches!(
        Workspace::decode("x", &" ".repeat(workspace::MAX_FILE_LEN + 1)),
        Err(WorkspaceError::TooLarge)
    ));
}
