//! The last pieces of the plan: user-defined commands, the Insert-mode
//! edit key, marks, macros and project-aware workspaces.

use modal_browser_core::ipc::{self, Request, WorkspaceRequest};
use modal_browser_core::workspace::{self, best_for_dir, project_of, validate_project};
use modal_browser_core::{
    Action, FocusContext, Key, KeyCode, KeyDisposition, KeySequence, MessageLevel, ModalSession,
    Mode, Modifiers, OpenTarget, Outcome, PaletteKind, Scroll, WindowTab, Workspace,
};

const PAGE: FocusContext = FocusContext::PAGE;
const EDITABLE: FocusContext = FocusContext::EDITABLE;

fn press(s: &mut ModalSession, notation: &str, focus: FocusContext) -> Vec<Outcome> {
    KeySequence::parse(notation)
        .unwrap()
        .keys()
        .iter()
        .map(|&k| s.handle_key(k, &focus))
        .collect()
}

fn last(s: &mut ModalSession, notation: &str) -> Outcome {
    press(s, notation, PAGE).pop().unwrap()
}

fn all_actions(outcomes: &[Outcome]) -> Vec<Action> {
    outcomes.iter().flat_map(|o| o.actions.clone()).collect()
}

fn message(o: &Outcome) -> Option<(MessageLevel, String)> {
    o.actions.iter().find_map(|a| match a {
        Action::ShowMessage { level, text } => Some((*level, text.clone())),
        _ => None,
    })
}

fn scroll_down(count: u32) -> Action {
    Action::Scroll {
        scroll: Scroll::Down,
        count,
        step: 60,
        smooth: true,
    }
}

// -- User-defined commands --------------------------------------------------

#[test]
fn aliases_expand_complete_and_bind() {
    let mut s = ModalSession::new();
    let report = s.load_config(
        r#"[aliases]
gh = "open github.com"
search-rust = "open"
tabnew = "open nope"
broken = "frobnicate"
"bad name" = "open x"

[keys.normal]
",g" = "gh"
"#,
    );
    let errors: Vec<String> = report.errors.iter().map(|e| e.to_string()).collect();
    assert_eq!(errors.len(), 3, "{errors:?}");
    assert!(errors[0].contains("built-in command"));
    assert!(errors[1].contains("alias 'broken'"));
    assert!(errors[2].contains("not a command name"));

    let o = s.submit_command_line("gh");
    assert_eq!(
        o.actions,
        vec![Action::Open {
            target: OpenTarget::Url("https://github.com".into()),
            disposition: modal_browser_core::Disposition::CurrentTab
        }]
    );
    // Arguments are appended.
    let o = s.submit_command_line("search-rust borrow checker");
    assert!(
        matches!(&o.actions[0], Action::Open { target: OpenTarget::Search(t), .. } if t == "borrow checker")
    );
    // Bindings to aliases bind what they stand for.
    let o = last(&mut s, ",g");
    assert!(matches!(&o.actions[0], Action::Open { .. }));
    // Offered in completion and in the command list.
    assert!(s.complete("g").iter().any(|c| c.text == "gh"));
    s.run_command("palette commands").unwrap();
    assert!(s.palette().unwrap().rows.iter().any(|r| r.primary == "gh"));
    s.cancel_command_line();
    // :map accepts an alias too.
    assert!(s.submit_command_line("map ,h gh").error.is_none());
    assert!(matches!(
        &last(&mut s, ",h").actions[0],
        Action::Open { .. }
    ));
}

// -- Insert-mode edit key ----------------------------------------------------

#[test]
fn edit_key_opens_the_focused_field() {
    let mut s = ModalSession::new();
    let edit = Key::new(KeyCode::Char('e'), Modifiers::CTRL.union(Modifiers::SHIFT));
    // Typing goes to the page...
    assert_eq!(
        s.handle_key(Key::char('x'), &EDITABLE).disposition,
        KeyDisposition::Forward
    );
    assert_eq!(s.mode(), Mode::Insert);
    // ...except the edit key.
    let o = s.handle_key(edit, &EDITABLE);
    assert_eq!(o.disposition, KeyDisposition::Consumed);
    assert_eq!(o.actions, vec![Action::InspectField { force: false }]);
    // Plain Ctrl+E (end of line on macOS) is untouched.
    let ctrl_e = Key::new(KeyCode::Char('e'), Modifiers::CTRL);
    assert_eq!(
        s.handle_key(ctrl_e, &EDITABLE).disposition,
        KeyDisposition::Forward
    );
    // Configurable, and must be a chord.
    assert!(
        s.load_config("[options]\nedit_key = \"<D-e>\"\n")
            .errors
            .is_empty()
    );
    let cmd_e = Key::new(KeyCode::Char('e'), Modifiers::META);
    assert_eq!(
        s.handle_key(cmd_e, &EDITABLE).actions,
        vec![Action::InspectField { force: false }]
    );
    let report = s.load_config("[options]\nedit_key = \"e\"\n");
    assert!(report.errors[0].message.contains("Control or Command"));
}

// -- Marks ------------------------------------------------------------------

#[test]
fn marks_record_and_jump() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "m");
    assert!(o.actions.is_empty());
    assert_eq!(o.pending, "m");
    let o = last(&mut s, "a");
    assert_eq!(o.actions, vec![Action::RecordMark { letter: 'a' }]);
    assert_eq!(o.pending, "");
    let o = s.mark_recorded('a', "https://docs.rs/x", 0, 1200);
    assert_eq!(message(&o).unwrap().1, "Mark a set");

    assert_eq!(
        all_actions(&press(&mut s, "'a", PAGE)),
        vec![Action::GoToMark {
            letter: 'a',
            url: "https://docs.rs/x".into(),
            x: 0,
            y: 1200,
            navigate: false
        }]
    );
    // Uppercase marks may take you to their page.
    s.mark_recorded('B', "https://mdn.dev/y", 0, 10);
    assert!(matches!(
        &all_actions(&press(&mut s, "`B", PAGE))[0],
        Action::GoToMark { navigate: true, .. }
    ));
    // Unset marks, non-letters and Esc.
    assert_eq!(
        message(&press(&mut s, "'z", PAGE).pop().unwrap())
            .unwrap()
            .1,
        "Mark z is not set"
    );
    assert_eq!(
        message(&press(&mut s, "m1", PAGE).pop().unwrap())
            .unwrap()
            .0,
        MessageLevel::Error
    );
    let o = s.handle_key(Key::plain(KeyCode::Escape), &PAGE);
    assert_eq!(
        o.disposition,
        KeyDisposition::Forward,
        "nothing was waiting"
    );
    last(&mut s, "m");
    let o = s.handle_key(Key::plain(KeyCode::Escape), &PAGE);
    assert_eq!(o.disposition, KeyDisposition::Consumed);
    assert!(last(&mut s, "j").actions == vec![scroll_down(1)]);
    // :marks lists them.
    let o = s.run_command("marks").unwrap();
    assert!(message(&o).unwrap().1.contains("a  https://docs.rs/x"));
}

// -- Macros -------------------------------------------------------------------

#[test]
fn macros_record_play_and_repeat() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "qa");
    assert_eq!(message(&o).unwrap().1, "Recording @a (q stops)");
    assert_eq!(o.pending, "recording @a");
    press(&mut s, "jj", PAGE);
    // Keys the page gets are not recorded.
    press(&mut s, "z", PAGE);
    let o = last(&mut s, "q");
    assert_eq!(message(&o).unwrap().1, "Recorded @a (2 keys)");

    assert_eq!(
        all_actions(&press(&mut s, "@a", PAGE)),
        vec![scroll_down(1), scroll_down(1)]
    );
    assert_eq!(all_actions(&press(&mut s, "2@a", PAGE)).len(), 4);
    assert_eq!(all_actions(&press(&mut s, "@@", PAGE)).len(), 2);
    assert_eq!(
        message(&press(&mut s, "@b", PAGE).pop().unwrap())
            .unwrap()
            .1,
        "Register b is empty"
    );
}

#[test]
fn a_macro_cannot_play_itself() {
    let mut s = ModalSession::new();
    press(&mut s, "qa", PAGE);
    press(&mut s, "j@a", PAGE);
    press(&mut s, "q", PAGE);
    // Plays j once; the nested @a is ignored rather than looping.
    assert_eq!(
        all_actions(&press(&mut s, "@a", PAGE)),
        vec![scroll_down(1)]
    );
}

// -- Project-aware workspaces --------------------------------------------------

#[test]
fn projects_are_saved_and_matched_by_folder() {
    assert_eq!(validate_project("/a/b/").unwrap(), "/a/b");
    assert!(validate_project("relative/x").is_err());

    let mut s = ModalSession::new();
    let o = s.submit_command_line("workspace project /Users/me/code/foo/");
    assert_eq!(o.error, None);
    assert_eq!(s.project(), Some("/Users/me/code/foo"));
    assert!(
        s.submit_command_line("workspace project code/foo")
            .error
            .is_some()
    );

    let tabs = [WindowTab {
        url: "http://localhost:3000".into(),
        ..WindowTab::default()
    }];
    let o = s.save_workspace("foo", true, &tabs, 0);
    let Action::WriteWorkspace { contents, .. } = &o.actions[0] else {
        panic!("{:?}", o.actions)
    };
    assert_eq!(project_of(contents).as_deref(), Some("/Users/me/code/foo"));
    let (ws, _) = Workspace::decode("foo", contents).unwrap();
    assert_eq!(ws.project.as_deref(), Some("/Users/me/code/foo"));

    // Once the window has a workspace, setting the project saves it.
    let o = s.submit_command_line("workspace project clear");
    assert!(o.actions.contains(&Action::SnapshotWorkspace {
        name: "foo".into(),
        quiet: true
    }));
    assert_eq!(s.project(), None);

    let entries = vec![
        ("foo".to_string(), "/Users/me/code/foo".to_string()),
        ("foo-api".to_string(), "/Users/me/code/foo/api".to_string()),
        ("foobar".to_string(), "/Users/me/code/foobar".to_string()),
    ];
    assert_eq!(
        best_for_dir(&entries, "/Users/me/code/foo/api/src"),
        Some("foo-api")
    );
    assert_eq!(
        best_for_dir(&entries, "/Users/me/code/foo/web"),
        Some("foo")
    );
    assert_eq!(
        best_for_dir(&entries, "/Users/me/code/foobar"),
        Some("foobar")
    );
    assert_eq!(best_for_dir(&entries, "/Users/me/code"), None);
    assert_eq!(workspace::project_of("{not json"), None);
}

#[test]
fn browserctl_workspace_here() {
    let r = Request::Workspace(WorkspaceRequest::Here("/Users/me/code/foo".into()));
    let line = ipc::encode_request(3, &r);
    assert_eq!(ipc::parse_request(&line).unwrap().request, r);
    assert!(
        ipc::parse_request(r#"{"cmd":"workspace","action":"here","dir":"rel"}"#)
            .unwrap_err()
            .message
            .contains("absolute")
    );
    assert!(
        ipc::parse_request(r#"{"cmd":"workspace","action":"open","name":"x","dir":"/a"}"#)
            .unwrap_err()
            .message
            .contains("does not take 'dir'")
    );
    let _ = PaletteKind::Workspaces;
}
