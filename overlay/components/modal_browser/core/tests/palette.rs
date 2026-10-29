//! The palette: command line completion and history, tab switcher, and the
//! command list.

use modal_browser_core::{
    Action, FocusContext, KeySequence, ModalSession, Mode, PaletteKey, PaletteKind, TabInfo,
};

const PAGE: FocusContext = FocusContext::PAGE;

fn press(s: &mut ModalSession, keys: &str) -> Vec<Action> {
    KeySequence::parse(keys)
        .unwrap()
        .keys()
        .iter()
        .flat_map(|k| s.handle_key(*k, &PAGE).actions)
        .collect()
}

fn tab(id: i32, title: &str, url: &str, active: bool) -> TabInfo {
    TabInfo {
        id,
        title: title.into(),
        url: url.into(),
        active,
    }
}

fn three_tabs() -> Vec<TabInfo> {
    vec![
        tab(11, "GitHub", "https://github.com/", false),
        tab(12, "docs.rs", "https://docs.rs/", true),
        tab(13, "MDN Web Docs", "https://developer.mozilla.org/", false),
    ]
}

fn primaries(s: &ModalSession) -> Vec<String> {
    s.palette()
        .unwrap()
        .rows
        .iter()
        .map(|r| r.primary.clone())
        .collect()
}

// -- Command line ------------------------------------------------------------

#[test]
fn colon_opens_an_empty_command_line_listing_commands() {
    let mut s = ModalSession::new();
    let actions = press(&mut s, ":");
    assert_eq!(
        actions,
        vec![Action::OpenPalette {
            kind: PaletteKind::CommandLine,
            text: String::new()
        }]
    );
    assert_eq!(s.mode(), Mode::Command);
    let p = s.palette().unwrap();
    assert_eq!(p.kind, PaletteKind::CommandLine);
    assert!(p.rows.iter().any(|r| r.primary == "open"));
    assert_eq!(p.selected, None, "nothing selected until Tab");
}

#[test]
fn typing_updates_completions_with_marks() {
    let mut s = ModalSession::new();
    press(&mut s, ":");
    let o = s.palette_input("tabn");
    assert_eq!(o.actions, vec![Action::UpdatePalette]);
    let p = s.palette().unwrap();
    assert_eq!(p.rows[0].primary, "tabnew");
    assert_eq!(p.rows[0].primary_marks, vec![0, 1, 2, 3]);
    // Same text again changes nothing.
    assert!(s.palette_input("tabn").actions.is_empty());
}

#[test]
fn tab_cycles_completions_into_the_text_and_wraps() {
    let mut s = ModalSession::new();
    press(&mut s, ":");
    s.palette_input("scroll half");
    s.palette_key(PaletteKey::Next);
    assert_eq!(s.palette().unwrap().text, "scroll half-down");
    s.palette_key(PaletteKey::Next);
    assert_eq!(s.palette().unwrap().text, "scroll half-up");
    s.palette_key(PaletteKey::Next);
    assert_eq!(s.palette().unwrap().text, "scroll half-down");
    s.palette_key(PaletteKey::Previous);
    assert_eq!(s.palette().unwrap().text, "scroll half-up");
    // Enter runs what is in the field.
    let o = s.palette_key(PaletteKey::Accept);
    assert!(o.actions.iter().any(|a| matches!(a, Action::Scroll { .. })));
    assert_eq!(o.mode, Mode::Normal);
}

#[test]
fn up_and_down_browse_history_and_restore_the_draft() {
    let mut s = ModalSession::new();
    s.submit_command_line("tabnew");
    s.submit_command_line("open docs.rs");
    press(&mut s, ":");
    s.palette_input("dra");
    s.palette_key(PaletteKey::Up);
    assert_eq!(s.palette().unwrap().text, "open docs.rs");
    s.palette_key(PaletteKey::Up);
    assert_eq!(s.palette().unwrap().text, "tabnew");
    s.palette_key(PaletteKey::Up);
    assert_eq!(s.palette().unwrap().text, "tabnew", "stops at the oldest");
    s.palette_key(PaletteKey::Down);
    assert_eq!(s.palette().unwrap().text, "open docs.rs");
    s.palette_key(PaletteKey::Down);
    assert_eq!(s.palette().unwrap().text, "dra", "back to the draft");
}

#[test]
fn errors_stay_in_the_palette_until_the_text_changes() {
    let mut s = ModalSession::new();
    press(&mut s, ":");
    s.palette_input("open javascript:alert(1)");
    let o = s.palette_key(PaletteKey::Accept);
    assert!(o.error.unwrap().contains("javascript"));
    assert_eq!(s.mode(), Mode::Command);
    assert!(s.palette().unwrap().error.is_some());
    s.palette_input("open docs.rs");
    assert!(s.palette().unwrap().error.is_none());
}

#[test]
fn escape_closes() {
    let mut s = ModalSession::new();
    press(&mut s, ":");
    let o = s.palette_key(PaletteKey::Cancel);
    assert_eq!(o.actions, vec![Action::ClosePalette]);
    assert_eq!(o.mode, Mode::Normal);
    assert!(s.palette().is_none());
}

#[test]
fn buffer_argument_completes_with_tab_titles() {
    let mut s = ModalSession::new();
    s.set_tabs(three_tabs());
    press(&mut s, ":");
    s.palette_input("b mdn");
    let p = s.palette().unwrap();
    assert_eq!(p.rows[0].primary, "buffer 3");
    assert_eq!(p.rows[0].secondary, "MDN Web Docs");
}

// -- Tabs --------------------------------------------------------------------

#[test]
fn tab_switcher_lists_recent_first_and_current_last() {
    let mut s = ModalSession::new();
    s.set_tabs(three_tabs());
    s.on_tab_activated(13);
    s.on_tab_activated(12);
    let actions = press(&mut s, "b");
    assert_eq!(
        actions,
        vec![Action::OpenPalette {
            kind: PaletteKind::Tabs,
            text: String::new()
        }]
    );
    assert_eq!(primaries(&s), ["MDN Web Docs", "GitHub", "docs.rs"]);
    let p = s.palette().unwrap();
    assert!(p.rows[2].active);
    assert_eq!(p.rows[0].keys, "3", "strip position for :b 3");
    // Enter on the empty query goes back to the previous tab.
    let o = s.palette_key(PaletteKey::Accept);
    assert_eq!(
        o.actions,
        vec![Action::ClosePalette, Action::ActivateTab { id: 13 }]
    );
}

#[test]
fn tab_switcher_filters_by_title_or_url() {
    let mut s = ModalSession::new();
    s.set_tabs(three_tabs());
    press(&mut s, "T");
    s.palette_input("mozilla");
    assert_eq!(primaries(&s), ["MDN Web Docs"]);
    assert!(!s.palette().unwrap().rows[0].secondary_marks.is_empty());
    s.palette_input("zzzz");
    assert!(primaries(&s).is_empty());
    let o = s.palette_key(PaletteKey::Accept);
    assert_eq!(o.error.as_deref(), Some("Nothing matches"));
    assert_eq!(s.mode(), Mode::Command);
}

#[test]
fn tab_switcher_arrows_move_and_wrap() {
    let mut s = ModalSession::new();
    s.set_tabs(three_tabs());
    press(&mut s, "b");
    assert_eq!(s.palette().unwrap().selected, Some(0));
    s.palette_key(PaletteKey::Up);
    assert_eq!(s.palette().unwrap().selected, Some(2));
    s.palette_key(PaletteKey::Next);
    s.palette_key(PaletteKey::Down);
    assert_eq!(s.palette().unwrap().selected, Some(1));
}

#[test]
fn refreshing_tabs_keeps_the_selected_tab_selected() {
    let mut s = ModalSession::new();
    s.set_tabs(three_tabs());
    press(&mut s, "b");
    s.palette_key(PaletteKey::Down);
    let picked = s.palette().unwrap().selected_row().unwrap().tab_id;
    // The host pushes a fresh snapshot (as it does before Enter).
    s.set_tabs(three_tabs());
    assert_eq!(s.palette().unwrap().selected_row().unwrap().tab_id, picked);
}

#[test]
fn tab_switcher_follows_strip_changes() {
    let mut s = ModalSession::new();
    s.set_tabs(three_tabs());
    press(&mut s, "b");
    let mut tabs = three_tabs();
    tabs.pop();
    s.set_tabs(tabs);
    assert_eq!(s.palette().unwrap().rows.len(), 2);
}

#[test]
fn buffer_by_number_and_query() {
    let mut s = ModalSession::new();
    s.set_tabs(three_tabs());
    let o = s.run_command("buffer 1").unwrap();
    assert_eq!(o.actions, vec![Action::ActivateTab { id: 11 }]);
    let o = s.run_command("b mdn").unwrap();
    assert_eq!(o.actions, vec![Action::ActivateTab { id: 13 }]);
    assert!(s.run_command("b 9").is_err());
    assert!(s.run_command("b nothing-like-it").is_err());
    // A count prefix picks the tab: 2b.
    let actions = press(&mut s, "2b");
    assert_eq!(actions, vec![Action::ActivateTab { id: 12 }]);
}

#[test]
fn tab_text_is_bounded() {
    let mut s = ModalSession::new();
    s.set_tabs(vec![tab(1, &"x".repeat(5000), "https://a/", true)]);
    press(&mut s, "b");
    assert_eq!(s.palette().unwrap().rows[0].primary.chars().count(), 1024);
}

// -- Commands ----------------------------------------------------------------

#[test]
fn command_list_shows_bindings_with_keys() {
    let mut s = ModalSession::new();
    press(&mut s, "?");
    let p = s.palette().unwrap();
    assert_eq!(p.kind, PaletteKind::Commands);
    let next = p.rows.iter().find(|r| r.accept == "tabnext").unwrap();
    assert_eq!(next.primary, "Next tab");
    assert!(
        next.keys.contains('J') && next.keys.contains("gt"),
        "{}",
        next.keys
    );
    // Commands without a binding are listed too.
    assert!(p.rows.iter().any(|r| r.accept == "open"));
}

#[test]
fn command_list_runs_the_choice() {
    let mut s = ModalSession::new();
    press(&mut s, "?");
    s.palette_input("reopen");
    assert_eq!(s.palette().unwrap().rows[0].accept, "tabrestore");
    let o = s.palette_key(PaletteKey::Accept);
    assert_eq!(o.actions, vec![Action::ClosePalette, Action::RestoreTab]);
}

#[test]
fn command_needing_an_argument_opens_the_command_line_prefilled() {
    let mut s = ModalSession::new();
    press(&mut s, "?");
    s.palette_input("open a URL or search in this tab");
    assert_eq!(s.palette().unwrap().rows[0].accept, "open");
    let o = s.palette_key(PaletteKey::Accept);
    assert_eq!(
        o.actions,
        vec![Action::OpenPalette {
            kind: PaletteKind::CommandLine,
            text: "open ".into()
        }]
    );
    assert_eq!(s.palette().unwrap().kind, PaletteKind::CommandLine);
    assert_eq!(s.mode(), Mode::Command);
}

#[test]
fn clicking_back_into_the_page_closes_any_palette() {
    let mut s = ModalSession::new();
    press(&mut s, "?");
    let actions = press(&mut s, "j");
    assert_eq!(actions[0], Action::ClosePalette);
    assert!(s.palette().is_none());
    assert_eq!(s.mode(), Mode::Normal);
}

#[test]
fn clicking_rows() {
    let mut s = ModalSession::new();
    s.set_tabs(three_tabs());
    press(&mut s, "b");
    let o = s.palette_select(1);
    assert_eq!(o.actions, vec![Action::UpdatePalette]);
    assert_eq!(s.palette().unwrap().selected, Some(1));
    // Out of range: ignored.
    assert!(s.palette_select(99).actions.is_empty());

    // In the command line a click fills the field.
    s.palette_key(PaletteKey::Cancel);
    press(&mut s, ":");
    s.palette_input("tabn");
    s.palette_select(0);
    assert_eq!(s.palette().unwrap().text, "tabnew");
}

#[test]
fn pointer_activity_dismisses_hints_only() {
    let mut s = ModalSession::new();
    press(&mut s, "f");
    let o = s.on_pointer_activity();
    assert_eq!(o.actions, vec![Action::HideHints]);
    assert_eq!(o.mode, Mode::Normal);
    press(&mut s, "i");
    assert!(s.on_pointer_activity().actions.is_empty());
    assert_eq!(s.mode(), Mode::Insert);
}
