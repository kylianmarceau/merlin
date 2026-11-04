//! Session flows added in Phases 3 and 4: splits, pins, workspaces,
//! host-supplied lists, the page outline, extraction, the external editor
//! and Visual-mode selection.

use modal_browser_core::{
    Action, Block, BlockJump, BlockKind, BrowserPage, DocumentPurpose, ExtractDestination,
    ExtractKind, FieldInfo, FieldKind, FocusContext, HintAction, HintKind, ItemSource, KeySequence,
    ListItem, MessageLevel, ModalSession, Mode, OpenTarget, Outcome, PageDocument, PaletteKey,
    PaletteKind, SelectUnit, SplitLayout, Switch, TabInfo, WindowTab, YankKind,
};

const PAGE: FocusContext = FocusContext::PAGE;

fn last(s: &mut ModalSession, notation: &str) -> Outcome {
    KeySequence::parse(notation)
        .unwrap()
        .keys()
        .iter()
        .map(|&k| s.handle_key(k, &PAGE))
        .last()
        .unwrap()
}

fn run(s: &mut ModalSession, line: &str) -> Outcome {
    let o = s.submit_command_line(line);
    assert_eq!(o.error, None, "{line}");
    o
}

fn message(o: &Outcome) -> Option<(MessageLevel, &str)> {
    o.actions.iter().find_map(|a| match a {
        Action::ShowMessage { level, text } => Some((*level, text.as_str())),
        _ => None,
    })
}

fn rows(s: &ModalSession) -> Vec<String> {
    s.palette()
        .map(|p| p.rows.iter().map(|r| r.primary.clone()).collect())
        .unwrap_or_default()
}

fn tab(id: i32, url: &str, active: bool) -> TabInfo {
    TabInfo {
        id,
        title: url.into(),
        url: url.into(),
        active,
    }
}

// -- Splits and pins ----------------------------------------------------------

#[test]
fn split_keys_and_commands() {
    let mut s = ModalSession::new();
    assert_eq!(
        last(&mut s, "<C-w>v").actions,
        vec![Action::Split {
            layout: SplitLayout::SideBySide,
            target: None
        }]
    );
    assert_eq!(
        run(&mut s, "split docs.rs").actions,
        vec![Action::Split {
            layout: SplitLayout::Stacked,
            target: Some(OpenTarget::Url("https://docs.rs".into()))
        }]
    );
    assert_eq!(
        last(&mut s, "<C-w>w").actions,
        vec![Action::SplitFocusOther]
    );
    assert_eq!(last(&mut s, "<C-w>x").actions, vec![Action::SplitSwap]);
    assert_eq!(last(&mut s, "<C-w>o").actions, vec![Action::Unsplit]);
    assert_eq!(
        last(&mut s, "gp").actions,
        vec![Action::PinTab(Switch::Toggle)]
    );
    assert_eq!(
        run(&mut s, "pin off").actions,
        vec![Action::PinTab(Switch::Off)]
    );
    assert!(
        s.submit_command_line("vsplit javascript:alert(1)")
            .error
            .is_some()
    );
}

#[test]
fn windows_and_browser_pages() {
    let mut s = ModalSession::new();
    assert_eq!(
        run(&mut s, "private").actions,
        vec![Action::NewWindow { private: true }]
    );
    assert_eq!(
        run(&mut s, "window").actions,
        vec![Action::NewWindow { private: false }]
    );
    // Merlin has one profile: no :profile command or profiles palette.
    assert!(s.submit_command_line("profile Work").error.is_some());
    assert!(s.submit_command_line("palette profiles").error.is_some());
    assert_eq!(
        run(&mut s, "downloads").actions,
        vec![Action::ShowBrowserPage(BrowserPage::Downloads)]
    );
    assert_eq!(
        run(&mut s, "read").actions,
        vec![Action::ShowBrowserPage(BrowserPage::ReadingMode)]
    );
    assert_eq!(
        run(&mut s, "devtools").actions,
        vec![Action::ToggleDevTools]
    );
    assert_eq!(last(&mut s, "gB").actions, vec![Action::AddBookmark]);
}

// -- Workspaces --------------------------------------------------------------

#[test]
fn workspace_save_needs_a_name_until_it_has_one() {
    let mut s = ModalSession::new();
    let o = s.submit_command_line("workspace save");
    assert!(o.error.unwrap().contains("no workspace yet"));
    let o = run(&mut s, "workspace save research");
    assert_eq!(
        o.actions,
        vec![Action::SnapshotWorkspace {
            name: "research".into(),
            quiet: false
        }]
    );
    assert!(s.submit_command_line("workspace save ../x").error.is_some());

    // The host answers with the window's tabs; the core produces the file.
    let tabs = vec![
        WindowTab {
            url: "https://docs.rs".into(),
            title: "Docs".into(),
            active: true,
            ..WindowTab::default()
        },
        WindowTab {
            url: "https://github.com".into(),
            title: "GitHub".into(),
            pinned: true,
            ..WindowTab::default()
        },
    ];
    let o = s.save_workspace("research", false, &tabs, 100);
    let [
        Action::WriteWorkspace {
            name,
            contents,
            message,
        },
    ] = o.actions.as_slice()
    else {
        panic!("{:?}", o.actions);
    };
    assert_eq!(name, "research");
    assert_eq!(message, "Saved workspace research (2 tabs)");
    assert!(contents.contains("https://github.com"));
    assert_eq!(s.workspace(), Some("research"));
    // Now a bare save reuses the name, and autosave knows it.
    assert_eq!(
        run(&mut s, "workspace save").actions,
        vec![Action::SnapshotWorkspace {
            name: "research".into(),
            quiet: false
        }]
    );
    assert_eq!(s.autosave_workspace(), Some("research"));
    let o = s.save_workspace("research", true, &tabs, 100);
    assert!(
        matches!(&o.actions[..], [Action::WriteWorkspace { message, .. }] if message.is_empty())
    );
}

#[test]
fn private_windows_never_save() {
    let mut s = ModalSession::new();
    s.set_window(true);
    assert!(
        s.submit_command_line("workspace save secret")
            .error
            .unwrap()
            .contains("private")
    );
    s.set_workspace("x", None);
    assert_eq!(s.autosave_workspace(), None);
    let tabs = [WindowTab {
        url: "https://a.b".into(),
        ..WindowTab::default()
    }];
    let o = s.save_workspace("x", false, &tabs, 0);
    assert_eq!(message(&o).unwrap().0, MessageLevel::Error);
}

#[test]
fn workspace_open_restores_in_place_or_in_a_new_window() {
    let file = {
        let mut s = ModalSession::new();
        let tabs = [
            WindowTab {
                url: "https://a.example".into(),
                split: Some(1),
                ..WindowTab::default()
            },
            WindowTab {
                url: "https://b.example".into(),
                split: Some(1),
                active: true,
                ..WindowTab::default()
            },
        ];
        match &s.save_workspace("pair", true, &tabs, 0).actions[0] {
            Action::WriteWorkspace { contents, .. } => contents.clone(),
            other => panic!("{other:?}"),
        }
    };

    let mut s = ModalSession::new();
    assert_eq!(
        run(&mut s, "workspace open pair").actions,
        vec![Action::ReadWorkspace {
            name: "pair".into()
        }]
    );
    // A window with only a new-tab page is reused.
    s.set_tabs(vec![tab(1, "chrome://newtab/", true)]);
    let o = s.workspace_read("pair", true, &file);
    let Action::RestoreWorkspace {
        workspace,
        new_window,
    } = &o.actions[0]
    else {
        panic!("{:?}", o.actions);
    };
    assert!(!new_window);
    assert_eq!(workspace.tabs.len(), 2);
    assert_eq!(workspace.splits.len(), 1);
    assert_eq!(workspace.active, 1);
    assert_eq!(message(&o).unwrap().1, "Opened workspace pair (2 tabs)");
    assert_eq!(s.workspace(), Some("pair"));

    // A window with real tabs gets a new window instead.
    let mut s = ModalSession::new();
    s.set_tabs(vec![tab(1, "https://x.example", true)]);
    let o = s.workspace_read("pair", true, &file);
    assert!(matches!(
        &o.actions[0],
        Action::RestoreWorkspace {
            new_window: true,
            ..
        }
    ));
    assert_eq!(s.workspace(), None, "the new window owns the workspace");

    let o = s.workspace_read("gone", false, "");
    assert!(message(&o).unwrap().1.contains("No workspace named gone"));
    let o = s.workspace_read("bad", true, "{oops");
    assert_eq!(message(&o).unwrap().0, MessageLevel::Error);
    assert_eq!(
        run(&mut s, "workspace delete pair").actions,
        vec![Action::DeleteWorkspace {
            name: "pair".into()
        }]
    );
}

// -- Host-supplied lists -----------------------------------------------------------

#[test]
fn history_palette_loads_then_filters_and_opens() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "gh");
    assert_eq!(
        o.actions,
        vec![
            Action::OpenPalette {
                kind: PaletteKind::History,
                text: String::new()
            },
            Action::RequestItems(ItemSource::History)
        ]
    );
    assert!(s.palette().unwrap().loading);
    let now = 1_000_000;
    let items = vec![
        ListItem {
            title: "The Rust Book".into(),
            detail: "https://doc.rust-lang.org/book/".into(),
            value: "https://doc.rust-lang.org/book/".into(),
            time: now - 7200,
            current: false,
        },
        ListItem {
            title: "".into(),
            detail: "https://example.com/\"quoted\"".into(),
            value: "https://example.com/\"quoted\"".into(),
            time: now - 30,
            current: false,
        },
    ];
    s.set_items(ItemSource::History, items.clone(), now);
    let p = s.palette().unwrap();
    assert!(!p.loading);
    assert_eq!(p.rows[0].keys, "2 h");
    assert_eq!(
        p.rows[1].primary, "https://example.com/\"quoted\"",
        "untitled rows show the URL"
    );
    // Answers for a palette that is not open are ignored.
    let o = s.set_items(ItemSource::Bookmarks, items, now);
    assert!(o.actions.is_empty());

    s.palette_input("rust bk");
    assert_eq!(rows(&s), vec!["The Rust Book"]);
    let o = s.palette_key(PaletteKey::Accept);
    assert_eq!(
        o.actions,
        vec![
            Action::ClosePalette,
            Action::Open {
                target: OpenTarget::Url("https://doc.rust-lang.org/book/".into()),
                disposition: modal_browser_core::Disposition::CurrentTab
            }
        ]
    );

    // Quotes in URLs survive the trip through the command line.
    run(&mut s, "history example");
    s.set_items(
        ItemSource::History,
        vec![ListItem {
            title: "Q".into(),
            detail: "https://example.com/\"quoted\"".into(),
            value: "https://example.com/\"quoted\"".into(),
            ..ListItem::default()
        }],
        now,
    );
    let o = s.palette_key(PaletteKey::Accept);
    assert!(o.actions.contains(&Action::Open {
        target: OpenTarget::Url("https://example.com/\"quoted\"".into()),
        disposition: modal_browser_core::Disposition::CurrentTab
    }));
}

#[test]
fn bookmarklets_from_lists_are_refused() {
    let mut s = ModalSession::new();
    run(&mut s, "bookmarks");
    s.set_items(
        ItemSource::Bookmarks,
        vec![ListItem {
            title: "Bookmarklet".into(),
            value: "javascript:alert(1)".into(),
            ..ListItem::default()
        }],
        0,
    );
    let o = s.palette_key(PaletteKey::Accept);
    assert!(o.error.is_some());
    assert!(!o.actions.iter().any(|a| matches!(a, Action::Open { .. })));
}

#[test]
fn workspace_lists() {
    let mut s = ModalSession::new();
    s.set_workspace("research", None);
    let o = last(&mut s, "gw");
    assert!(
        o.actions
            .contains(&Action::RequestItems(ItemSource::Workspaces))
    );
    s.set_items(
        ItemSource::Workspaces,
        vec![
            ListItem {
                title: "research".into(),
                value: "research".into(),
                time: 940,
                ..ListItem::default()
            },
            ListItem {
                title: "travel".into(),
                value: "travel".into(),
                ..ListItem::default()
            },
        ],
        1000,
    );
    let p = s.palette().unwrap();
    assert!(p.rows[0].active);
    assert_eq!(p.rows[0].keys, "current");
    assert_eq!(p.rows[0].secondary, "saved 1 min ago");
    s.palette_input("trav");
    assert_eq!(
        s.palette_key(PaletteKey::Accept).actions[1],
        Action::ReadWorkspace {
            name: "travel".into()
        }
    );
}

// -- Page structure -------------------------------------------------------------

fn doc() -> PageDocument {
    let heading = |level: u8, text: &str, element: u32| Block {
        level,
        element,
        ..Block::new(BlockKind::Heading, text)
    };
    let mut link = Block::new(BlockKind::Paragraph, "see the guide");
    link.spans = vec![modal_browser_core::Span {
        start: 8,
        end: 13,
        kind: modal_browser_core::SpanKind::Link,
        href: "https://example.com/guide".into(),
    }];
    PageDocument::new(
        "Page",
        "https://example.com/",
        vec![
            heading(1, "Intro", 0),
            heading(2, "Background", 1),
            heading(3, "Details", 2),
            link,
            heading(1, "Usage", 3),
            Block {
                lang: "sh".into(),
                element: 4,
                ..Block::new(BlockKind::Code, "cargo run\n")
            },
        ],
    )
}

fn generation(o: &Outcome) -> u32 {
    o.actions
        .iter()
        .find_map(|a| match a {
            Action::CollectDocument { generation, .. } => Some(*generation),
            _ => None,
        })
        .expect("a CollectDocument action")
}

#[test]
fn outline_palette_jumps_and_folds() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "gO");
    assert!(o.actions.contains(&Action::OpenPalette {
        kind: PaletteKind::Outline,
        text: String::new()
    }));
    let g = generation(&o);
    assert!(s.palette().unwrap().loading);
    // A stale answer is ignored.
    assert!(s.document_collected(g + 1, doc()).actions.is_empty());
    s.document_collected(g, doc());
    let p = s.palette().unwrap();
    assert_eq!(
        rows(&s),
        vec!["Intro", "Background", "Details", "Usage", "cargo run"]
    );
    let indents: Vec<u8> = p.rows.iter().map(|r| r.indent).collect();
    assert_eq!(indents, vec![0, 1, 2, 0, 1]);
    assert_eq!(p.rows[4].keys, "code · sh");

    // Fold "Intro": its subsections hide; unfold brings them back.
    s.palette_key(PaletteKey::Collapse);
    assert_eq!(rows(&s), vec!["Intro", "Usage", "cargo run"]);
    assert!(s.palette().unwrap().rows[0].folded);
    s.palette_key(PaletteKey::Expand);
    assert_eq!(rows(&s).len(), 5);
    // Folding a leaf folds its parent and selects it.
    s.palette_key(PaletteKey::Down);
    s.palette_key(PaletteKey::Down);
    s.palette_key(PaletteKey::Collapse);
    assert_eq!(rows(&s), vec!["Intro", "Background", "Usage", "cargo run"]);
    assert_eq!(s.palette().unwrap().selected, Some(1));

    // Searching ignores folds and keeps page order.
    s.palette_input("u");
    assert_eq!(rows(&s), vec!["Background", "Usage", "cargo run"]);
    s.palette_input("usage");
    let o = s.palette_key(PaletteKey::Accept);
    assert_eq!(
        o.actions,
        vec![Action::ClosePalette, Action::RevealElement { element: 3 }]
    );
    assert_eq!(o.mode, Mode::Normal);
}

#[test]
fn links_palette_and_navigation_drop_the_document() {
    let mut s = ModalSession::new();
    let g = generation(&last(&mut s, "gl"));
    s.document_collected(g, doc());
    assert_eq!(rows(&s), vec!["guide"]);
    assert!(s.document().is_some());
    let o = s.on_page_changed("other.example");
    assert!(o.actions.contains(&Action::ClosePalette));
    assert!(s.document().is_none());
    assert!(s.palette().is_none());
}

#[test]
fn extract_to_clipboard_or_editor() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "yM");
    assert!(matches!(
        o.actions[..],
        [Action::CollectDocument {
            purpose: DocumentPurpose::Extract(ExtractKind::Markdown, ExtractDestination::Clipboard),
            ..
        }]
    ));
    let o = s.document_collected(generation(&o), doc());
    let [Action::CopyText { text, what }] = o.actions.as_slice() else {
        panic!("{:?}", o.actions);
    };
    assert!(text.starts_with("# Page\n"));
    assert_eq!(what, "page as Markdown");

    // No editor configured anywhere: a helpful error.
    let o = run(&mut s, "extract links editor");
    let o = s.document_collected(generation(&o), doc());
    assert!(message(&o).unwrap().1.contains("No editor configured"));

    s.set_environment("", "nvim-qt --nofork");
    let o = run(&mut s, "extract links editor");
    let o = s.document_collected(generation(&o), doc());
    assert_eq!(
        o.actions,
        vec![Action::OpenInEditor {
            text: "- [guide](https://example.com/guide)\n".into(),
            extension: "md".into(),
            argv: vec!["nvim-qt".into(), "--nofork".into(), "{file}".into()],
        }]
    );
    let o = run(&mut s, "extract code");
    let empty = PageDocument::new("", "", vec![]);
    assert!(
        message(&s.document_collected(generation(&o), empty))
            .unwrap()
            .1
            .contains("No code blocks")
    );
}

#[test]
fn structural_jumps_take_counts() {
    let mut s = ModalSession::new();
    assert_eq!(
        last(&mut s, "]]").actions,
        vec![Action::JumpToBlock {
            kind: BlockJump::Heading,
            forward: true,
            count: 1
        }]
    );
    assert_eq!(
        last(&mut s, "3[c").actions,
        vec![Action::JumpToBlock {
            kind: BlockJump::Code,
            forward: false,
            count: 3
        }]
    );
    assert_eq!(
        run(&mut s, "jump table prev").actions,
        vec![Action::JumpToBlock {
            kind: BlockJump::Table,
            forward: false,
            count: 1
        }]
    );
}

// -- External editor ------------------------------------------------------------

fn textarea() -> FieldInfo {
    FieldInfo {
        kind: FieldKind::TextArea,
        input_type: String::new(),
        autocomplete: String::new(),
        label: "comment_body".into(),
        length: 12,
        read_only: false,
    }
}

#[test]
fn edit_flow_checks_the_field_then_the_editor() {
    let mut s = ModalSession::new();
    assert_eq!(
        run(&mut s, "edit").actions,
        vec![Action::InspectField { force: false }]
    );
    assert_eq!(
        run(&mut s, "edit!").actions,
        vec![Action::InspectField { force: true }]
    );

    let o = s.field_info(&textarea(), false);
    assert!(message(&o).unwrap().1.contains("No editor configured"));

    let config = "[options]\neditor = [\"ghostty\", \"-e\", \"nvim\", \"{file}\"]\n";
    assert!(s.load_config(config).errors.is_empty());
    let o = s.field_info(&textarea(), false);
    assert_eq!(
        o.actions,
        vec![Action::EditField {
            argv: vec![
                "ghostty".into(),
                "-e".into(),
                "nvim".into(),
                "{file}".into()
            ]
        }]
    );
    let password = FieldInfo {
        kind: FieldKind::Input,
        input_type: "password".into(),
        ..textarea()
    };
    assert_eq!(
        message(&s.field_info(&password, true)).unwrap().0,
        MessageLevel::Error
    );
}

#[test]
fn edit_hint_focuses_then_inspects() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "ge");
    assert!(matches!(
        o.actions[..],
        [Action::CollectHints {
            action: HintAction::EditInput,
            ..
        }]
    ));
    let Action::CollectHints { generation, .. } = o.actions[0] else {
        unreachable!()
    };
    // One field: no labels, straight to the editor.
    let o = s.hints_collected(generation, &[HintKind::Link, HintKind::Editable]);
    assert_eq!(
        o.actions,
        vec![
            Action::ActivateHint {
                target: 1,
                action: HintAction::EditInput
            },
            Action::InspectField { force: false }
        ]
    );
}

// -- Visual mode and code blocks ---------------------------------------------------

#[test]
fn select_hint_enters_visual_and_y_copies() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "v");
    let Action::CollectHints { generation, action } = o.actions[0] else {
        panic!("{:?}", o.actions);
    };
    assert_eq!(action, HintAction::Select);
    assert_eq!(action.targets(), modal_browser_core::HintTargets::Text);
    let o = s.hints_collected(
        generation,
        &[HintKind::Block, HintKind::Block, HintKind::Code],
    );
    assert!(matches!(&o.actions[0], Action::ShowHints { hints, .. } if hints.len() == 3));
    let o = last(&mut s, "s");
    assert_eq!(o.mode, Mode::Visual);
    assert!(o.actions.contains(&Action::ActivateHint {
        target: 0,
        action: HintAction::Select
    }));

    assert_eq!(
        last(&mut s, "2w").actions,
        vec![Action::ExtendSelection {
            forward: true,
            unit: SelectUnit::Word,
            count: 2
        }]
    );
    let o = last(&mut s, "y");
    assert_eq!(
        o.actions,
        vec![Action::Yank(YankKind::Selection), Action::ClearSelection]
    );
    assert_eq!(o.mode, Mode::Normal);

    // Navigation ends Visual mode.
    s.run_command("mode visual").unwrap();
    assert_eq!(s.on_page_changed("x.example").mode, Mode::Normal);
}

#[test]
fn code_hint_with_one_block_copies_at_once() {
    let mut s = ModalSession::new();
    let Action::CollectHints { generation, action } = last(&mut s, "yc").actions[0] else {
        panic!()
    };
    assert_eq!(action.targets(), modal_browser_core::HintTargets::Code);
    let o = s.hints_collected(generation, &[HintKind::Code]);
    assert_eq!(
        o.actions,
        vec![Action::ActivateHint {
            target: 0,
            action: HintAction::YankCode
        }]
    );
    assert_eq!(o.mode, Mode::Normal);
    let Action::CollectHints { generation, .. } = last(&mut s, "yc").actions[0] else {
        panic!()
    };
    let o = s.hints_collected(generation, &[]);
    assert_eq!(message(&o).unwrap().1, "No code blocks in view");
}

#[test]
fn new_config_options() {
    let mut s = ModalSession::new();
    let report = s.load_config(
        "[options]\nrestore_session = false\nworkspace_autosave = false\nbrowserctl = false\neditor = []\n",
    );
    assert_eq!(report.errors.len(), 1, "{:?}", report.errors);
    assert!(report.errors[0].message.contains("needs a program"));
    let c = s.config();
    assert!(!c.restore_session && !c.workspace_autosave && !c.browserctl);
    s.set_workspace("w", None);
    assert_eq!(s.autosave_workspace(), None);
}

// -- Round 2: Merlin menu, downloads palette, :browser -----------------------

#[test]
fn merlin_menu_lists_window_actions_with_their_keys() {
    let mut s = ModalSession::new();
    run(&mut s, "palette menu");
    let p = s.palette().unwrap();
    assert_eq!(p.kind, PaletteKind::Menu);
    assert!(!p.loading, "the menu needs nothing from the host");
    let names = rows(&s);
    for want in ["New tab", "History", "Settings", "Print…", "Quit Merlin"] {
        assert!(names.iter().any(|n| n == want), "{want} in {names:?}");
    }
    // Rows show the binding that runs them.
    let tabnew = &s.palette().unwrap().rows[0];
    assert_eq!(tabnew.primary, "New tab");
    assert!(!tabnew.keys.is_empty(), "tabnew is bound by default");

    s.palette_input("zoom in");
    let o = s.palette_key(PaletteKey::Accept);
    assert!(o.actions.contains(&Action::BrowserCommand {
        name: "zoom-in".into(),
        arg: String::new()
    }));
}

#[test]
fn downloads_palette_opens_finished_files_and_shows_running_ones() {
    let mut s = ModalSession::new();
    let o = run(&mut s, "palette downloads");
    assert!(
        o.actions
            .contains(&Action::RequestItems(ItemSource::Downloads))
    );
    let now = 1_800_000_000;
    s.set_items(
        ItemSource::Downloads,
        vec![
            ListItem {
                title: "report.pdf".into(),
                detail: "2.1 MB · example.com".into(),
                value: "7".into(),
                time: now - 120,
                current: false,
            },
            ListItem {
                title: "video.mp4".into(),
                detail: "45% · 3 of 7 MB".into(),
                value: "8".into(),
                time: now,
                current: true,
            },
        ],
        now,
    );
    assert_eq!(rows(&s), vec!["report.pdf", "video.mp4"]);
    let o = s.palette_key(PaletteKey::Accept);
    assert!(o.actions.contains(&Action::BrowserCommand {
        name: "download-open".into(),
        arg: "7".into()
    }));
    run(&mut s, "palette downloads");
    s.set_items(
        ItemSource::Downloads,
        vec![ListItem {
            title: "video.mp4".into(),
            value: "8".into(),
            current: true,
            ..ListItem::default()
        }],
        now,
    );
    let o = s.palette_key(PaletteKey::Accept);
    assert!(o.actions.contains(&Action::BrowserCommand {
        name: "download-show".into(),
        arg: "8".into()
    }));
}

#[test]
fn browser_command_checks_its_arguments() {
    let mut s = ModalSession::new();
    let o = run(&mut s, "browser print");
    assert!(o.actions.contains(&Action::BrowserCommand {
        name: "print".into(),
        arg: String::new()
    }));
    for bad in [
        "browser",
        "browser explode",
        "browser print 3",
        "browser download-open",
        "browser download-open x1",
        "browser download-open 1 2",
    ] {
        assert!(s.submit_command_line(bad).error.is_some(), "{bad}");
    }
}

#[test]
fn key_bindings_list_bound_commands_for_settings() {
    let s = ModalSession::new();
    let b = s.key_bindings();
    assert!(
        b.iter()
            .any(|(keys, cmd, _)| keys.split("  ").any(|k| k == "f") && cmd.starts_with("hint"))
    );
    assert!(b.iter().all(|(keys, _, _)| !keys.is_empty()));
}
