use modal_browser_core::workspace::{self, Split, VERSION, restorable_url, validate_name};
use modal_browser_core::{
    GroupColor, SplitLayout, WindowBounds, WindowGroup, WindowTab, Workspace, WorkspaceError,
};

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
    let ws = Workspace::from_window("research", 1_761_650_000, &tabs, None, None).unwrap();
    assert_eq!(ws.tabs.len(), 4, "the data: URL is left out");
    assert!(ws.tabs[0].pinned);
    assert_eq!(ws.active, 2);
    assert_eq!(
        ws.splits,
        vec![Split {
            tabs: [1, 2],
            layout: SplitLayout::Stacked,
            ratio: None,
        }]
    );
    assert_eq!(
        Workspace::from_window("x", 0, &[tab("javascript:void(0)")], None, None),
        Err(WorkspaceError::Empty)
    );
    assert!(Workspace::from_window("bad/name", 0, &tabs, None, None).is_err());
}

#[test]
fn encode_decode_round_trip() {
    let tabs = vec![
        tab("https://a.example"),
        WindowTab {
            split: Some(1),
            pinned: true,
            ..tab("https://b.example")
        },
        WindowTab {
            split: Some(1),
            active: true,
            pinned: true,
            ..tab("https://c.example")
        },
    ];
    let ws = Workspace::from_window("round", 1234, &tabs, None, None).unwrap();
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
            {"url": "https://kept.example", "title": "Kept", "pinned": true},
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
            layout: SplitLayout::Stacked,
            ratio: None,
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

fn grouped(url: &str, id: i32, title: &str, color: GroupColor) -> WindowTab {
    WindowTab {
        group: Some(WindowGroup {
            id,
            title: title.into(),
            color,
            collapsed: id == 2,
        }),
        ..tab(url)
    }
}

#[test]
fn groups_window_and_split_ratio_round_trip() {
    let tabs = vec![
        WindowTab {
            pinned: true,
            // Pinned tabs cannot be grouped; the group is ignored.
            ..grouped("https://pinned.example", 9, "Ignored", GroupColor::Red)
        },
        WindowTab {
            split: Some(4),
            split_ratio: Some(0.3),
            ..grouped("https://a.example", 7, "Research", GroupColor::Blue)
        },
        WindowTab {
            split: Some(4),
            split_ratio: Some(0.3),
            active: true,
            ..grouped("https://b.example", 7, "Research", GroupColor::Blue)
        },
        tab("https://loose.example"),
        grouped("https://c.example", 2, "Later", GroupColor::Green),
    ];
    let window = WindowBounds {
        x: -1200,
        y: 40,
        width: 1400,
        height: 900,
        maximized: true,
    };
    let ws = Workspace::from_window("grouped", 1, &tabs, None, Some(window)).unwrap();
    assert_eq!(ws.groups.len(), 2, "the pinned tab's group is not kept");
    assert_eq!(ws.groups[0].title, "Research");
    assert_eq!(ws.groups[0].color, GroupColor::Blue);
    assert!(ws.groups[1].collapsed);
    assert_eq!(
        ws.tabs.iter().map(|t| t.group).collect::<Vec<_>>(),
        vec![None, Some(0), Some(0), None, Some(1)]
    );
    assert_eq!(ws.splits[0].ratio, Some(300));
    assert_eq!(ws.window, Some(window));

    let text = ws.encode();
    assert!(text.contains("\"ratio\": 0.3"), "{text}");
    assert!(text.contains("\"color\": \"blue\""), "{text}");
    assert!(text.contains("\"maximized\": true"), "{text}");
    let (back, skipped) = Workspace::decode("grouped", &text).unwrap();
    assert_eq!(skipped, 0);
    assert_eq!(back, ws);
}

#[test]
fn old_files_and_bad_groups_or_windows_still_open() {
    // A file from before groups and windows were saved.
    let (old, _) = Workspace::decode(
        "old",
        r#"{"format":"modal_browser.workspace","version":1,
            "tabs":[{"url":"https://a.example"},{"url":"https://b.example"}],
            "splits":[{"tabs":[1,0],"layout":"side-by-side","ratio":0.25}]}"#,
    )
    .unwrap();
    assert!(old.groups.is_empty());
    assert_eq!(old.window, None);
    // Listed second-first: the ratio is turned to belong to the first tab.
    assert_eq!(old.splits[0].tabs, [0, 1]);
    assert_eq!(old.splits[0].ratio, Some(750));

    let (odd, _) = Workspace::decode(
        "odd",
        r#"{"format":"modal_browser.workspace","version":1,
            "tabs":[
              {"url":"https://a.example","group":5},
              {"url":"https://b.example","group":1},
              {"url":"https://c.example","group":1,"pinned":true}
            ],
            "groups":[{"title":"unused"},{"title":"kept","color":"chartreuse"}],
            "splits":[{"tabs":[1,2],"ratio":7}],
            "window":{"x":0,"y":0,"width":5,"height":900}}"#,
    )
    .unwrap();
    assert_eq!(
        odd.tabs.iter().map(|t| t.group).collect::<Vec<_>>(),
        vec![None, Some(0), None],
        "unknown group indices and pinned tabs are left ungrouped"
    );
    assert_eq!(odd.groups.len(), 1, "unused groups are dropped");
    assert_eq!(odd.groups[0].title, "kept");
    assert_eq!(
        odd.groups[0].color,
        GroupColor::Grey,
        "unknown colors fall back"
    );
    assert!(
        odd.splits.is_empty(),
        "a pinned and an unpinned tab cannot share a split"
    );
    assert_eq!(odd.window, None, "a 5 px window is not restored");
}
