//! Tests of the Rust side of the bridge mapping. The C++ side is covered by
//! tools/host_harness.

use modal_browser_ffi::testing;
use modal_browser_ffi::{
    ActionKind, FocusKind, FocusState, HintAction, HintKind, KeyDisposition, Mode, Modifiers,
    OpenDisposition, PaletteKey, PaletteKind, ScrollKind, Switch, TabInfo, new_session,
};

const NONE: Modifiers = Modifiers {
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
};

#[test]
fn address_alias_translation_reuses_command_policy() {
    use modal_browser_ffi::merlin_internal_url;
    assert_eq!(
        merlin_internal_url(" merlin://version "),
        "chrome://version"
    );
    assert_eq!(
        merlin_internal_url("MERLIN://start/?q=a#b"),
        "chrome://merlin-start/?q=a#b"
    );
    assert_eq!(merlin_internal_url("merlin://startup"), "chrome://startup");
    assert_eq!(
        merlin_internal_url("merlin://settings/keys"),
        "chrome://settings/keys"
    );
    for text in [
        "https://example.com/merlin://start",
        "javascript:alert(1)",
        "data:text/plain,hello",
        "?merlin://start",
        "merlin://settings search",
    ] {
        assert_eq!(merlin_internal_url(text), "", "{text}");
    }
    assert_eq!(
        merlin_internal_url(&format!("merlin://{}", "a".repeat(8192))),
        ""
    );
}

fn page() -> FocusState {
    FocusState {
        kind: FocusKind::Page,
        ime_composing: false,
    }
}

#[test]
fn key_maps_to_flat_action() {
    let mut s = new_session();
    let o = testing::handle_key(&mut s, "j", NONE, page());
    assert_eq!(o.disposition, KeyDisposition::Consumed);
    assert_eq!(o.actions.len(), 1);
    assert_eq!(o.actions[0].kind, ActionKind::Scroll);
    assert_eq!(o.actions[0].scroll, ScrollKind::Down);
    assert_eq!(o.actions[0].count, 1);
    assert_eq!(o.mode, Mode::Normal);
    assert_eq!(o.timeout_ms, 0);
}

#[test]
fn tabnew_url_flattens_with_disposition() {
    let mut s = new_session();
    testing::handle_key(&mut s, ":", NONE, page());
    let o = testing::submit_command_line(&mut s, "tabnew https://docs.rs");
    assert_eq!(o.error, "");
    assert_eq!(o.actions[0].kind, ActionKind::ClosePalette);
    assert_eq!(o.actions[1].kind, ActionKind::OpenUrl);
    assert_eq!(o.actions[1].text, "https://docs.rs");
    assert_eq!(o.actions[1].disposition, OpenDisposition::NewForegroundTab);
}

#[test]
fn search_is_a_separate_kind() {
    let mut s = new_session();
    testing::handle_key(&mut s, ":", NONE, page());
    let o = testing::submit_command_line(&mut s, "open rust book");
    assert_eq!(o.actions[1].kind, ActionKind::OpenSearch);
    assert_eq!(o.actions[1].text, "rust book");
}

#[test]
fn pending_sequence_reports_timeout() {
    let mut s = new_session();
    let o = testing::handle_key(&mut s, "g", NONE, page());
    assert_eq!(o.pending, "g");
    assert_eq!(o.timeout_ms, 1000);
}

#[test]
fn unknown_dom_keys_are_forwarded_untouched() {
    let mut s = new_session();
    testing::handle_key(&mut s, "g", NONE, page());
    let o = testing::handle_key(&mut s, "Shift", NONE, page());
    assert_eq!(o.disposition, KeyDisposition::Forward);
    // The pending `g` survives a bare modifier press (Shift before `G`).
    assert_eq!(o.pending, "g");
}

#[test]
fn out_of_range_focus_from_cpp_is_treated_as_browser_ui() {
    let mut s = new_session();
    let bogus = FocusState {
        kind: FocusKind { repr: 200 },
        ime_composing: false,
    };
    let o = testing::handle_key(&mut s, "d", NONE, bogus);
    assert_eq!(o.disposition, KeyDisposition::Forward);
    assert!(o.actions.is_empty());
}

#[test]
fn out_of_range_mode_from_cpp_is_rejected() {
    let mut s = new_session();
    assert_eq!(
        testing::bind(&mut s, Mode { repr: 99 }, "x", "tabnew"),
        "invalid mode value"
    );
    assert_eq!(testing::bind(&mut s, Mode::Normal, "x", "tabnew"), "");
}

#[test]
fn errors_are_strings() {
    let mut s = new_session();
    let o = testing::submit_command_line(&mut s, "nosuchcommand");
    assert!(o.error.starts_with("unknown command 'nosuchcommand'"));
    assert_eq!(o.mode, Mode::Normal);
    let o = testing::on_focus_changed(
        &mut s,
        FocusState {
            kind: FocusKind::PlainTextField,
            ime_composing: false,
        },
    );
    assert_eq!(o.mode, Mode::Insert);
}

#[test]
fn hint_flow_crosses_the_bridge() {
    let mut s = new_session();
    let o = testing::handle_key(&mut s, "F", NONE, page());
    assert_eq!(o.actions[0].kind, ActionKind::CollectHints);
    assert_eq!(o.actions[0].hint_action, HintAction::OpenInNewTab);
    let generation = o.actions[0].index;
    let kinds = [HintKind::Link, HintKind::Other, HintKind::Link];
    let o = testing::hints_collected(&mut s, generation, &kinds);
    assert_eq!(o.actions[0].kind, ActionKind::ShowHints);
    let targets: Vec<u32> = o.actions[0].hints.iter().map(|h| h.target).collect();
    assert_eq!(targets, vec![0, 2]);
    let label = o.actions[0].hints[1].label.clone();
    let o = testing::handle_key(&mut s, &label, NONE, page());
    assert_eq!(o.actions[1].kind, ActionKind::ActivateHint);
    assert_eq!(o.actions[1].index, 2);
}

#[test]
fn out_of_range_hint_kinds_are_treated_as_plain_clickables() {
    let mut s = new_session();
    let o = testing::handle_key(&mut s, "F", NONE, page());
    let bogus = [HintKind { repr: 77 }];
    let o = testing::hints_collected(&mut s, o.actions[0].index, &bogus);
    // Not a link, so nothing to open in a new tab.
    assert_eq!(o.actions[0].kind, ActionKind::ShowMessage);
    assert_eq!(o.mode, Mode::Normal);
}

#[test]
fn palette_state_with_utf16_marks() {
    let mut s = new_session();
    testing::set_tabs(
        &mut s,
        vec![
            TabInfo {
                id: 7,
                title: "😀 Émoji docs".into(),
                url: "https://e.example/".into(),
                active: false,
            },
            TabInfo {
                id: 8,
                title: "Other".into(),
                url: "https://o.example/".into(),
                active: true,
            },
        ],
    );
    assert!(!testing::palette_state(&s).visible);
    let o = testing::handle_key(&mut s, "b", NONE, page());
    assert_eq!(o.actions[0].kind, ActionKind::OpenPalette);
    assert_eq!(o.actions[0].palette, PaletteKind::Tabs);
    testing::palette_input(&mut s, "docs");
    let state = testing::palette_state(&s);
    assert!(state.visible);
    assert_eq!(state.kind, PaletteKind::Tabs);
    assert_eq!(state.selected, 0);
    assert_eq!(state.rows[0].tab_id, 7);
    // "😀 Émoji docs": the emoji is two UTF-16 units, so "docs" starts at 9.
    assert_eq!(state.rows[0].primary_marks, vec![9, 10, 11, 12]);
    let o = testing::palette_key(&mut s, PaletteKey::Accept);
    assert_eq!(o.actions[1].kind, ActionKind::ActivateTab);
    assert_eq!(o.actions[1].id, 7);
}

#[test]
fn out_of_range_palette_key_cancels() {
    let mut s = new_session();
    testing::handle_key(&mut s, ":", NONE, page());
    let o = testing::palette_key(&mut s, PaletteKey { repr: 99 });
    assert_eq!(o.actions[0].kind, ActionKind::ClosePalette);
    assert_eq!(o.mode, Mode::Normal);
}

#[test]
fn utf16_offsets_skip_missing_indices() {
    assert_eq!(testing::utf16_offsets("a😀b", &[0, 2]), vec![0, 3]);
    assert_eq!(testing::utf16_offsets("abc", &[5]), Vec::<u32>::new());
}

#[test]
fn config_errors_cross_as_lines() {
    let mut s = new_session();
    let r = testing::load_config(
        &mut s,
        "[options]\nscroll_step = 1\n[keys.normal]\nx = \"tabclose\"",
    );
    assert_eq!(r.bindings, 1);
    assert_eq!(r.errors.len(), 1);
    assert!(r.errors[0].starts_with("line 2:"));
}

#[test]
fn which_key_crosses_the_bridge() {
    let mut s = new_session();
    let o = testing::handle_key(&mut s, "y", NONE, page());
    let keys: Vec<&str> = o.which_key.iter().map(|h| h.keys.as_str()).collect();
    assert!(keys.contains(&"y") && keys.contains(&"f"), "{keys:?}");
}

#[test]
fn shell_actions_cross_the_bridge() {
    let mut s = new_session();
    let o = testing::handle_key(&mut s, "g", NONE, page());
    assert!(o.which_key.iter().any(|h| h.keys == "s"));
    let o = testing::handle_key(&mut s, "s", NONE, page());
    assert_eq!(o.actions[0].kind, ActionKind::TabSidebar);
    assert_eq!(o.actions[0].setting, Switch::Toggle);
    let o = testing::submit_command_line(&mut s, "vertical-tabs off");
    assert_eq!(o.actions[0].kind, ActionKind::VerticalTabs);
    assert_eq!(o.actions[0].setting, Switch::Off);
}
