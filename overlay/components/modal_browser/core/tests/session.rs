//! State-machine tests: modes, focus policy, sequences, counts, Escape and
//! the command line, driven the way the browser host drives the session.

use modal_browser_core::{
    Action, Disposition, Editable, FocusContext, FocusTarget, HintAction, HintKind, Key, KeyCode,
    KeyDisposition, KeySequence, MessageLevel, ModalSession, Mode, Modifiers, OpenTarget, Outcome,
    PaletteKind, Scroll, SelectUnit, Switch, TabEdge, YankKind,
};

const PAGE: FocusContext = FocusContext::PAGE;
const EDITABLE: FocusContext = FocusContext::EDITABLE;
const BROWSER_UI: FocusContext = FocusContext::BROWSER_UI;

/// Feeds each key of a notation string and returns every outcome.
fn press(s: &mut ModalSession, notation: &str, focus: FocusContext) -> Vec<Outcome> {
    KeySequence::parse(notation)
        .unwrap()
        .keys()
        .iter()
        .map(|&k| s.handle_key(k, &focus))
        .collect()
}

/// Feeds keys and returns the last outcome.
fn last(s: &mut ModalSession, notation: &str, focus: FocusContext) -> Outcome {
    press(s, notation, focus).pop().unwrap()
}

fn esc() -> Key {
    Key::plain(KeyCode::Escape)
}

fn all_actions(outcomes: &[Outcome]) -> Vec<Action> {
    outcomes.iter().flat_map(|o| o.actions.clone()).collect()
}

// -- Normal mode ------------------------------------------------------------

#[test]
fn starts_in_normal() {
    assert_eq!(ModalSession::new().mode(), Mode::Normal);
}

#[test]
fn single_key_binding() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "j", PAGE);
    assert_eq!(o.disposition, KeyDisposition::Consumed);
    assert_eq!(
        o.actions,
        vec![Action::Scroll {
            scroll: Scroll::Down,
            count: 1,
            step: 60,
            smooth: true
        }]
    );
    assert_eq!(o.mode, Mode::Normal);
    assert!(!o.mode_changed);
    assert_eq!(o.timeout_ms, None);
}

#[test]
fn history_and_tab_keys() {
    let mut s = ModalSession::new();
    assert_eq!(
        last(&mut s, "H", PAGE).actions,
        vec![Action::Back { count: 1 }]
    );
    assert_eq!(
        last(&mut s, "L", PAGE).actions,
        vec![Action::Forward { count: 1 }]
    );
    assert_eq!(last(&mut s, "t", PAGE).actions, vec![Action::NewTab]);
    assert_eq!(last(&mut s, "d", PAGE).actions, vec![Action::CloseTab]);
    assert_eq!(last(&mut s, "u", PAGE).actions, vec![Action::RestoreTab]);
    assert_eq!(
        last(&mut s, "J", PAGE).actions,
        vec![Action::NextTab { count: 1 }]
    );
    assert_eq!(
        last(&mut s, "K", PAGE).actions,
        vec![Action::PreviousTab { count: 1 }]
    );
    assert_eq!(
        last(&mut s, "<C-l>", PAGE).actions,
        vec![Action::FocusAddressBar]
    );
    assert_eq!(last(&mut s, "/", PAGE).actions, vec![Action::FindInPage]);
}

#[test]
fn unbound_keys_reach_the_page() {
    let mut s = ModalSession::new();
    for k in ["z", "x", "<C-q>", "<D-t>", "<Down>", "<Space>"] {
        let o = last(&mut s, k, PAGE);
        assert_eq!(o.disposition, KeyDisposition::Forward, "{k}");
        assert!(o.actions.is_empty(), "{k}");
    }
}

#[test]
fn two_key_sequence() {
    let mut s = ModalSession::new();
    let first = last(&mut s, "g", PAGE);
    assert_eq!(first.disposition, KeyDisposition::Consumed);
    assert!(first.actions.is_empty());
    assert_eq!(first.pending, "g");
    assert_eq!(first.timeout_ms, Some(1000));

    let second = last(&mut s, "g", PAGE);
    assert_eq!(
        second.actions,
        vec![Action::Scroll {
            scroll: Scroll::Top,
            count: 1,
            step: 60,
            smooth: true
        }]
    );
    assert_eq!(second.pending, "");
    assert_eq!(second.timeout_ms, None);

    assert_eq!(
        last(&mut s, "gT", PAGE).actions,
        vec![Action::PreviousTab { count: 1 }]
    );
}

#[test]
fn broken_sequence_is_dropped() {
    let mut s = ModalSession::new();
    let o = press(&mut s, "gx", PAGE);
    assert_eq!(o[1].disposition, KeyDisposition::Consumed);
    assert!(all_actions(&o).is_empty());
    assert_eq!(s.pending_display(), "");
    // The session is clean afterwards.
    assert_eq!(last(&mut s, "j", PAGE).actions.len(), 1);
}

#[test]
fn command_key_chords_survive_a_broken_sequence() {
    let mut s = ModalSession::new();
    press(&mut s, "g", PAGE);
    let o = last(&mut s, "<D-t>", PAGE);
    assert_eq!(o.disposition, KeyDisposition::Forward);
    assert_eq!(o.pending, "");
}

#[test]
fn ambiguous_sequence_waits_then_runs_on_timeout() {
    let mut s = ModalSession::new();
    s.bind(Mode::Normal, "g", "tabnew").unwrap();
    let o = last(&mut s, "g", PAGE);
    assert!(o.actions.is_empty());
    assert_eq!(o.timeout_ms, Some(1000));
    let t = s.on_timeout();
    assert_eq!(t.actions, vec![Action::NewTab]);
    assert_eq!(t.pending, "");
    assert_eq!(t.timeout_ms, None);
}

#[test]
fn ambiguous_sequence_runs_shorter_binding_when_next_key_diverges() {
    let mut s = ModalSession::new();
    s.bind(Mode::Normal, "g", "tabnew").unwrap();
    let o = press(&mut s, "gj", PAGE);
    assert_eq!(
        all_actions(&o),
        vec![
            Action::NewTab,
            Action::Scroll {
                scroll: Scroll::Down,
                count: 1,
                step: 60,
                smooth: true
            }
        ]
    );
}

#[test]
fn ambiguous_sequence_completes_longer_binding() {
    let mut s = ModalSession::new();
    s.bind(Mode::Normal, "g", "tabnew").unwrap();
    assert_eq!(
        all_actions(&press(&mut s, "gg", PAGE)),
        vec![Action::Scroll {
            scroll: Scroll::Top,
            count: 1,
            step: 60,
            smooth: true
        }]
    );
}

#[test]
fn timeout_on_prefix_only_clears() {
    let mut s = ModalSession::new();
    press(&mut s, "g", PAGE);
    let t = s.on_timeout();
    assert!(t.actions.is_empty());
    assert_eq!(t.pending, "");
}

#[test]
fn spurious_timeout_is_harmless() {
    let mut s = ModalSession::new();
    let t = s.on_timeout();
    assert!(t.actions.is_empty());
    assert_eq!(t.mode, Mode::Normal);
}

// -- Counts -----------------------------------------------------------------

#[test]
fn counts_prefix_bindings() {
    let mut s = ModalSession::new();
    let o = press(&mut s, "3j", PAGE);
    assert_eq!(o[0].pending, "3");
    assert_eq!(o[0].disposition, KeyDisposition::Consumed);
    assert_eq!(
        o[1].actions,
        vec![Action::Scroll {
            scroll: Scroll::Down,
            count: 3,
            step: 60,
            smooth: true
        }]
    );

    assert_eq!(
        last(&mut s, "12J", PAGE).actions,
        vec![Action::NextTab { count: 12 }]
    );
    assert_eq!(
        last(&mut s, "2gg", PAGE).actions,
        vec![Action::Scroll {
            scroll: Scroll::Top,
            count: 2,
            step: 60,
            smooth: true
        }]
    );
}

#[test]
fn zero_only_continues_a_count() {
    let mut s = ModalSession::new();
    // '0' alone is not a count and is unbound by default.
    assert_eq!(last(&mut s, "0", PAGE).disposition, KeyDisposition::Forward);
    assert_eq!(
        last(&mut s, "10H", PAGE).actions,
        vec![Action::Back { count: 10 }]
    );
}

#[test]
fn huge_counts_saturate() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "99999999999j", PAGE);
    assert_eq!(
        o.actions,
        vec![Action::Scroll {
            scroll: Scroll::Down,
            count: 9999,
            step: 60,
            smooth: true
        }]
    );
}

#[test]
fn count_then_unbound_key_is_dropped() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "3z", PAGE);
    assert_eq!(o.disposition, KeyDisposition::Consumed);
    assert!(o.actions.is_empty());
    assert_eq!(o.pending, "");
}

#[test]
fn escape_cancels_count_and_sequence_without_reaching_page() {
    let mut s = ModalSession::new();
    press(&mut s, "3g", PAGE);
    assert_eq!(s.pending_display(), "3g");
    let o = s.handle_key(esc(), &PAGE);
    assert_eq!(o.disposition, KeyDisposition::Consumed);
    assert_eq!(o.pending, "");
    assert_eq!(
        last(&mut s, "j", PAGE).actions,
        vec![Action::Scroll {
            scroll: Scroll::Down,
            count: 1,
            step: 60,
            smooth: true
        }]
    );
}

#[test]
fn bare_escape_in_normal_reaches_the_page() {
    let mut s = ModalSession::new();
    let o = s.handle_key(esc(), &PAGE);
    assert_eq!(o.disposition, KeyDisposition::Forward);
    assert_eq!(o.mode, Mode::Normal);
}

// -- Focus policy -----------------------------------------------------------

#[test]
fn typing_in_a_text_field_is_never_hijacked() {
    let mut s = ModalSession::new();
    // No focus notification arrived; the key itself carries editable focus.
    for o in press(&mut s, "jjkdgg:", EDITABLE) {
        assert_eq!(o.disposition, KeyDisposition::Forward);
        assert!(o.actions.is_empty());
        assert_eq!(o.mode, Mode::Insert);
    }
}

#[test]
fn rich_text_editors_count_as_editable() {
    let mut s = ModalSession::new();
    let rich = FocusContext {
        target: FocusTarget::PageEditable(Editable::RichText),
        ime_composing: false,
    };
    assert_eq!(last(&mut s, "d", rich).disposition, KeyDisposition::Forward);
    assert_eq!(s.mode(), Mode::Insert);
}

#[test]
fn focus_change_enters_and_leaves_insert() {
    let mut s = ModalSession::new();
    let o = s.on_focus_changed(&EDITABLE);
    assert_eq!(o.mode, Mode::Insert);
    assert!(o.mode_changed);
    let o = s.on_focus_changed(&PAGE);
    assert_eq!(o.mode, Mode::Normal);
    assert!(o.mode_changed);
}

#[test]
fn focus_change_clears_pending_keys() {
    let mut s = ModalSession::new();
    press(&mut s, "3g", PAGE);
    s.on_focus_changed(&EDITABLE);
    s.on_focus_changed(&PAGE);
    assert_eq!(s.pending_display(), "");
}

#[test]
fn auto_insert_can_be_disabled_but_typing_is_still_safe() {
    use modal_browser_core::{CommandRegistry, Keymap, SessionConfig};
    let registry = CommandRegistry::with_builtins();
    let keymap = Keymap::with_defaults(&registry);
    let config = SessionConfig {
        auto_insert: false,
        ..SessionConfig::default()
    };
    let mut s = ModalSession::with_parts(registry, keymap, config);
    assert_eq!(s.on_focus_changed(&EDITABLE).mode, Mode::Normal);
    // The dispatch policy still refuses to treat typing as commands.
    assert_eq!(
        last(&mut s, "j", EDITABLE).disposition,
        KeyDisposition::Forward
    );
}

#[test]
fn escape_in_insert_returns_to_normal_and_blurs() {
    let mut s = ModalSession::new();
    s.on_focus_changed(&EDITABLE);
    let o = s.handle_key(esc(), &EDITABLE);
    assert_eq!(o.disposition, KeyDisposition::Consumed);
    assert_eq!(o.mode, Mode::Normal);
    assert_eq!(o.actions, vec![Action::BlurFocusedElement]);
    // After the host blurs the field, keys are commands again.
    assert_eq!(
        last(&mut s, "j", PAGE).disposition,
        KeyDisposition::Consumed
    );
}

#[test]
fn manual_insert_survives_focus_changes() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "i", PAGE);
    assert_eq!(o.mode, Mode::Insert);
    assert_eq!(o.disposition, KeyDisposition::Consumed);
    assert_eq!(last(&mut s, "j", PAGE).disposition, KeyDisposition::Forward);
    s.on_focus_changed(&EDITABLE);
    s.on_focus_changed(&PAGE);
    assert_eq!(s.mode(), Mode::Insert);
    let o = s.handle_key(esc(), &PAGE);
    assert_eq!(o.mode, Mode::Normal);
    assert!(
        o.actions.is_empty(),
        "nothing to blur when the page itself has focus"
    );
}

#[test]
fn browser_ui_and_ime_keys_are_untouchable_in_every_mode() {
    let composing = FocusContext {
        target: FocusTarget::Page,
        ime_composing: true,
    };
    for setup in ["", "<C-v>", "f", "v"] {
        for focus in [BROWSER_UI, composing] {
            let mut s = ModalSession::new();
            if !setup.is_empty() {
                press(&mut s, setup, PAGE);
            }
            let mode = s.mode();
            for k in ["j", ":", "<Esc>", "<S-Esc>", "g"] {
                let o = last(&mut s, k, focus);
                assert_eq!(
                    o.disposition,
                    KeyDisposition::Forward,
                    "{setup} {k} {focus:?}"
                );
                assert!(o.actions.is_empty());
                assert_eq!(o.mode, mode);
            }
        }
    }
}

#[test]
fn focus_moving_to_browser_ui_keeps_auto_insert() {
    // Clicking the omnibox from a text field must not flip modes.
    let mut s = ModalSession::new();
    s.on_focus_changed(&EDITABLE);
    assert_eq!(s.on_focus_changed(&BROWSER_UI).mode, Mode::Insert);
}

// -- Passthrough --------------------------------------------------------------

#[test]
fn passthrough_forwards_everything_including_escape() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "<C-v>", PAGE);
    assert_eq!(o.mode, Mode::Passthrough);
    for k in ["j", ":", "<Esc>", "gg", "<C-d>", "i"] {
        for o in press(&mut s, k, PAGE) {
            assert_eq!(o.disposition, KeyDisposition::Forward, "{k}");
            assert_eq!(o.mode, Mode::Passthrough);
        }
    }
    let o = last(&mut s, "<S-Esc>", PAGE);
    assert_eq!(o.disposition, KeyDisposition::Consumed);
    assert_eq!(o.mode, Mode::Normal);
}

#[test]
fn passthrough_exit_key_is_configurable() {
    use modal_browser_core::{CommandRegistry, Keymap, SessionConfig};
    let registry = CommandRegistry::with_builtins();
    let keymap = Keymap::with_defaults(&registry);
    let config = SessionConfig {
        passthrough_exit: Key::new(KeyCode::Char(']'), Modifiers::CTRL),
        ..SessionConfig::default()
    };
    let mut s = ModalSession::with_parts(registry, keymap, config);
    s.run_command("mode passthrough").unwrap();
    assert_eq!(last(&mut s, "<S-Esc>", PAGE).mode, Mode::Passthrough);
    assert_eq!(last(&mut s, "<C-]>", PAGE).mode, Mode::Normal);
}

// -- Hint and Visual --------------------------------------------------------

fn link_kinds(n: usize) -> Vec<HintKind> {
    vec![HintKind::Link; n]
}

/// Presses `f` and answers the collection request with `kinds`.
fn show_hints(s: &mut ModalSession, keys: &str, kinds: &[HintKind]) -> Outcome {
    let o = last(s, keys, PAGE);
    assert_eq!(o.mode, Mode::Hint);
    let [Action::CollectHints { generation, .. }] = o.actions[..] else {
        panic!("{:?}", o.actions);
    };
    s.hints_collected(generation, kinds)
}

#[test]
fn hint_flow_collects_labels_filters_and_activates() {
    let mut s = ModalSession::new();
    let o = show_hints(&mut s, "f", &link_kinds(20));
    let [Action::ShowHints { hints, action }] = &o.actions[..] else {
        panic!("{:?}", o.actions);
    };
    assert_eq!(*action, HintAction::Follow);
    assert_eq!(hints.len(), 20);
    // 20 targets with 14 characters: some one-key labels, some two-key.
    let label = hints[0].label.clone();
    assert_eq!(label.chars().count(), 2, "{hints:?}");

    let first: String = label.chars().take(1).collect();
    assert_eq!(
        last(&mut s, &first, PAGE).actions,
        vec![Action::FilterHints {
            typed: first.clone()
        }]
    );
    assert_eq!(
        last(&mut s, "<BS>", PAGE).actions,
        vec![Action::FilterHints {
            typed: String::new()
        }]
    );
    // Chords and named keys are swallowed, not sent to the covered page.
    let o = last(&mut s, "<C-d>", PAGE);
    assert_eq!(o.disposition, KeyDisposition::Consumed);
    assert!(o.actions.is_empty());

    let o = last(&mut s, &label, PAGE);
    assert_eq!(o.mode, Mode::Normal);
    assert_eq!(
        o.actions,
        vec![
            Action::HideHints,
            Action::ActivateHint {
                target: hints[0].target,
                action: HintAction::Follow
            }
        ]
    );
}

#[test]
fn hint_rejects_characters_no_label_starts_with() {
    let mut s = ModalSession::new();
    show_hints(&mut s, "f", &link_kinds(3));
    // Three labels: s, a, d. 'z' is not a hint character at all.
    let o = last(&mut s, "z", PAGE);
    assert!(o.actions.is_empty());
    assert_eq!(o.mode, Mode::Hint);
    assert_eq!(s.hints().unwrap().typed(), "");
}

#[test]
fn hint_escape_cancels_and_state_does_not_leak() {
    let mut s = ModalSession::new();
    show_hints(&mut s, "f", &link_kinds(30));
    last(&mut s, "s", PAGE);
    let o = s.handle_key(esc(), &PAGE);
    assert_eq!(o.actions, vec![Action::HideHints]);
    assert_eq!(o.mode, Mode::Normal);
    assert!(s.hints().is_none());

    show_hints(&mut s, "f", &link_kinds(30));
    assert_eq!(s.hints().unwrap().typed(), "");
}

#[test]
fn late_or_stale_hint_results_are_ignored() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "f", PAGE);
    let [Action::CollectHints { generation, .. }] = o.actions[..] else {
        panic!();
    };
    // Escape before the page answered.
    s.handle_key(esc(), &PAGE);
    let o = s.hints_collected(generation, &link_kinds(5));
    assert!(o.actions.is_empty());
    assert_eq!(o.mode, Mode::Normal);

    // A new request makes the old generation stale.
    last(&mut s, "f", PAGE);
    let o = s.hints_collected(generation, &link_kinds(5));
    assert!(o.actions.is_empty());
    assert_eq!(o.mode, Mode::Hint);
}

#[test]
fn hint_actions_filter_target_kinds() {
    let kinds = [
        HintKind::Other,
        HintKind::Link,
        HintKind::Editable,
        HintKind::Link,
    ];
    let mut s = ModalSession::new();
    let o = show_hints(&mut s, "F", &kinds);
    let [Action::ShowHints { hints, action }] = &o.actions[..] else {
        panic!("{:?}", o.actions);
    };
    assert_eq!(*action, HintAction::OpenInNewTab);
    let targets: Vec<u32> = hints.iter().map(|h| h.target).collect();
    assert_eq!(targets, vec![1, 3], "links only");

    let mut s = ModalSession::new();
    let o = show_hints(&mut s, "yf", &kinds);
    let [Action::ShowHints { action, .. }] = &o.actions[..] else {
        panic!()
    };
    assert_eq!(*action, HintAction::YankLink);
}

#[test]
fn gi_with_one_field_focuses_it_directly() {
    let mut s = ModalSession::new();
    let o = show_hints(&mut s, "gi", &[HintKind::Link, HintKind::Editable]);
    assert_eq!(o.mode, Mode::Normal);
    assert_eq!(
        o.actions,
        vec![Action::ActivateHint {
            target: 1,
            action: HintAction::FocusInput
        }]
    );
}

#[test]
fn no_targets_says_so_and_returns_to_normal() {
    let mut s = ModalSession::new();
    let o = show_hints(&mut s, "F", &[HintKind::Other]);
    assert_eq!(o.mode, Mode::Normal);
    assert!(matches!(
        &o.actions[..],
        [Action::ShowMessage { text, .. }] if text.contains("No links")
    ));
}

#[test]
fn command_key_in_hint_mode_cancels_and_forwards() {
    let mut s = ModalSession::new();
    show_hints(&mut s, "f", &link_kinds(3));
    let o = last(&mut s, "<D-t>", PAGE);
    assert_eq!(o.disposition, KeyDisposition::Forward);
    assert_eq!(o.mode, Mode::Normal);
    assert_eq!(o.actions, vec![Action::HideHints]);
}

#[test]
fn selecting_a_text_field_hint_starts_insert() {
    let mut s = ModalSession::new();
    show_hints(&mut s, "f", &link_kinds(3));
    let o = s.on_focus_changed(&EDITABLE);
    assert_eq!(o.mode, Mode::Insert);
    assert_eq!(o.actions, vec![Action::HideHints]);
}

#[test]
fn visual_enter_and_escape() {
    let mut s = ModalSession::new();
    assert_eq!(s.run_command("mode visual").unwrap().mode, Mode::Visual);
    // Motions extend the selection; unbound keys still pass through.
    let o = last(&mut s, "j", PAGE);
    assert_eq!(o.disposition, KeyDisposition::Consumed);
    assert_eq!(
        o.actions,
        vec![Action::ExtendSelection {
            forward: true,
            unit: SelectUnit::Line,
            count: 1
        }]
    );
    assert_eq!(last(&mut s, "t", PAGE).disposition, KeyDisposition::Forward);
    let o = s.handle_key(esc(), &PAGE);
    assert_eq!(o.mode, Mode::Normal);
    assert_eq!(o.disposition, KeyDisposition::Consumed);
    assert_eq!(o.actions, vec![Action::ClearSelection]);
}

// -- Command line -----------------------------------------------------------

#[test]
fn colon_opens_command_line_and_tabnew_submits() {
    // The flow from the plan: ':' -> 'tabnew https://docs.rs' -> real tab.
    let mut s = ModalSession::new();
    let o = last(&mut s, ":", PAGE);
    assert_eq!(o.mode, Mode::Command);
    assert!(o.mode_changed);
    assert_eq!(
        o.actions,
        vec![Action::OpenPalette {
            kind: PaletteKind::CommandLine,
            text: String::new()
        }]
    );

    let o = s.submit_command_line("tabnew https://docs.rs");
    assert_eq!(o.error, None);
    assert_eq!(o.mode, Mode::Normal);
    assert_eq!(
        o.actions,
        vec![
            Action::ClosePalette,
            Action::Open {
                target: OpenTarget::Url("https://docs.rs".into()),
                disposition: Disposition::NewForegroundTab,
            },
        ]
    );
    assert_eq!(s.history(), ["tabnew https://docs.rs"]);
}

#[test]
fn o_prefills_open() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "o", PAGE);
    assert_eq!(
        o.actions,
        vec![Action::OpenPalette {
            kind: PaletteKind::CommandLine,
            text: "open ".into()
        }]
    );
    let o = s.submit_command_line("open docs.rs");
    assert_eq!(
        o.actions[1],
        Action::Open {
            target: OpenTarget::Url("https://docs.rs".into()),
            disposition: Disposition::CurrentTab,
        }
    );
}

#[test]
fn failed_command_keeps_command_line_open() {
    let mut s = ModalSession::new();
    last(&mut s, ":", PAGE);
    let o = s.submit_command_line("tabnw docs.rs");
    assert_eq!(o.mode, Mode::Command);
    // The palette re-renders with the error under the input.
    assert_eq!(o.actions, vec![Action::UpdatePalette]);
    assert_eq!(
        s.palette().unwrap().error.as_deref(),
        Some("unknown command 'tabnw' (did you mean 'tabnew'?)")
    );
    assert_eq!(
        o.error.as_deref(),
        Some("unknown command 'tabnw' (did you mean 'tabnew'?)")
    );
    // Fixing the typo works.
    assert_eq!(s.submit_command_line("tabnew docs.rs").mode, Mode::Normal);
}

#[test]
fn cancel_command_line() {
    let mut s = ModalSession::new();
    last(&mut s, ":", PAGE);
    let o = s.cancel_command_line();
    assert_eq!(o.mode, Mode::Normal);
    assert_eq!(o.actions, vec![Action::ClosePalette]);
    // Cancelling when closed is a no-op.
    assert!(s.cancel_command_line().actions.is_empty());
}

#[test]
fn command_can_switch_mode() {
    let mut s = ModalSession::new();
    last(&mut s, ":", PAGE);
    let o = s.submit_command_line("mode passthrough");
    assert_eq!(o.mode, Mode::Passthrough);
    assert_eq!(o.actions, vec![Action::ClosePalette]);
}

#[test]
fn clicking_back_into_page_closes_command_line() {
    let mut s = ModalSession::new();
    last(&mut s, ":", PAGE);
    let o = last(&mut s, "j", PAGE);
    assert_eq!(o.mode, Mode::Normal);
    assert_eq!(
        o.actions,
        vec![
            Action::ClosePalette,
            Action::Scroll {
                scroll: Scroll::Down,
                count: 1,
                step: 60,
                smooth: true
            }
        ]
    );
}

#[test]
fn clicking_into_a_text_field_closes_command_line_without_hijacking() {
    let mut s = ModalSession::new();
    last(&mut s, ":", PAGE);
    let o = last(&mut s, "j", EDITABLE);
    assert_eq!(o.disposition, KeyDisposition::Forward);
    assert_eq!(o.mode, Mode::Insert);
    assert_eq!(o.actions, vec![Action::ClosePalette]);
}

#[test]
fn history_dedupes_and_is_bounded() {
    let mut s = ModalSession::new();
    s.submit_command_line("tabnew");
    s.submit_command_line("tabnew");
    s.submit_command_line("  ");
    assert_eq!(s.history(), ["tabnew"]);
    for i in 0..150 {
        s.submit_command_line(&format!("open site{i}.com"));
    }
    assert_eq!(s.history().len(), 100);
    assert_eq!(s.history().last().unwrap(), "open site149.com");
}

#[test]
fn help_from_command_line() {
    let mut s = ModalSession::new();
    let o = s.submit_command_line("help open");
    let Action::ShowMessage { level, text } = &o.actions[0] else {
        panic!("{:?}", o.actions);
    };
    assert_eq!(*level, MessageLevel::Info);
    assert!(text.starts_with(":open"));
}

#[test]
fn completion_passthrough() {
    let s = ModalSession::new();
    assert!(s.complete("tabn").iter().any(|c| c.text == "tabnew"));
}

#[test]
fn user_binding_errors_surface_as_messages_at_runtime() {
    // A binding that becomes invalid at runtime (here: an explicit count
    // plus a key count) reports an error instead of failing silently.
    let mut s = ModalSession::new();
    s.bind(Mode::Normal, "x", "tabnext 2").unwrap();
    let o = last(&mut s, "3x", PAGE);
    assert!(matches!(
        &o.actions[..],
        [Action::ShowMessage {
            level: MessageLevel::Error,
            ..
        }]
    ));
}

// -- Phase 2: which-key, motions, :map, clipboard --------------------------

#[test]
fn which_key_lists_continuations_after_a_prefix() {
    let mut s = ModalSession::new();
    let o = last(&mut s, "g", PAGE);
    let keys: Vec<&str> = o.which_key.iter().map(|h| h.keys.as_str()).collect();
    for k in ["g", "t", "T", "i", "u", "U", "0", "$"] {
        assert!(keys.contains(&k), "{k} in {keys:?}");
    }
    // Case-insensitive order keeps t/T and u/U together.
    assert_eq!(
        keys,
        [
            "$", "0", "B", "b", "e", "g", "h", "i", "l", "O", "p", "s", "T", "t", "U", "u"
        ]
    );
    let top = o.which_key.iter().find(|h| h.keys == "g").unwrap();
    assert_eq!(top.desc, "Top of page");
    // Nothing pending, nothing listed.
    assert!(last(&mut s, "g", PAGE).which_key.is_empty());
    assert!(last(&mut s, "j", PAGE).which_key.is_empty());
}

#[test]
fn new_default_motions() {
    let mut s = ModalSession::new();
    assert_eq!(
        last(&mut s, "yy", PAGE).actions,
        vec![Action::Yank(YankKind::Url)]
    );
    assert_eq!(
        last(&mut s, "ym", PAGE).actions,
        vec![Action::Yank(YankKind::Markdown)]
    );
    assert_eq!(
        last(&mut s, "P", PAGE).actions,
        vec![Action::OpenClipboard {
            disposition: Disposition::NewForegroundTab
        }]
    );
    assert_eq!(
        last(&mut s, "2gu", PAGE).actions,
        vec![Action::NavigateUp { count: 2 }]
    );
    assert_eq!(last(&mut s, "gU", PAGE).actions, vec![Action::NavigateRoot]);
    assert_eq!(
        last(&mut s, "g$", PAGE).actions,
        vec![Action::SelectTabEdge(TabEdge::Last)]
    );
    assert_eq!(last(&mut s, "n", PAGE).actions, vec![Action::FindNext]);
    assert_eq!(last(&mut s, "N", PAGE).actions, vec![Action::FindPrevious]);
}

#[test]
fn map_and_unmap_at_runtime() {
    let mut s = ModalSession::new();
    let o = s.submit_command_line("map x tabclose");
    assert!(matches!(
        &o.actions[..],
        [Action::ShowMessage { level: MessageLevel::Info, text }]
            if text == "Mapped x to :tabclose"
    ));
    assert_eq!(last(&mut s, "x", PAGE).actions, vec![Action::CloseTab]);

    s.submit_command_line("unmap x");
    assert_eq!(last(&mut s, "x", PAGE).disposition, KeyDisposition::Forward);

    // Invalid commands and keys fail before anything changes.
    assert!(s.submit_command_line("map x tabnw").error.is_some());
    assert!(s.submit_command_line("map x map y tabnew").error.is_some());
    let o = s.submit_command_line("map <Esc> tabnew");
    assert!(matches!(
        &o.actions[..],
        [Action::ShowMessage {
            level: MessageLevel::Error,
            ..
        }]
    ));
    // From the visible command line, the palette closes first.
    last(&mut s, ":", PAGE);
    let o = s.submit_command_line("map z tabnew");
    assert_eq!(o.actions[0], Action::ClosePalette);
}

#[test]
fn clipboard_text_is_classified_like_the_command_line() {
    let mut s = ModalSession::new();
    assert_eq!(
        s.open_text("docs.rs", Disposition::CurrentTab).actions,
        vec![Action::Open {
            target: OpenTarget::Url("https://docs.rs".into()),
            disposition: Disposition::CurrentTab
        }]
    );
    assert!(matches!(
        &s.open_text("javascript:alert(1)", Disposition::CurrentTab).actions[..],
        [Action::ShowMessage { level: MessageLevel::Error, text }] if text.starts_with("Clipboard:")
    ));
    assert!(matches!(
        &s.open_text("   ", Disposition::CurrentTab).actions[..],
        [Action::ShowMessage {
            level: MessageLevel::Error,
            ..
        }]
    ));
}

#[test]
fn shell_commands() {
    let mut s = ModalSession::new();
    assert_eq!(
        s.run_command("vertical-tabs").unwrap().actions,
        vec![Action::VerticalTabs(Switch::Toggle)]
    );
    assert_eq!(
        s.run_command("vtabs off").unwrap().actions,
        vec![Action::VerticalTabs(Switch::Off)]
    );
    assert_eq!(
        s.run_command("sidebar on").unwrap().actions,
        vec![Action::TabSidebar(Switch::On)]
    );
    assert!(s.run_command("sidebar maybe").is_err());
    assert_eq!(
        last(&mut s, "gs", PAGE).actions,
        vec![Action::TabSidebar(Switch::Toggle)]
    );
    assert!(
        s.complete("vertical-tabs o")
            .iter()
            .any(|c| c.text == "vertical-tabs on")
    );
}

#[test]
fn vertical_tabs_default_comes_from_config() {
    let mut s = ModalSession::new();
    assert!(s.config().vertical_tabs, "sidebar tabs by default");
    assert!(
        s.load_config("[options]\nvertical_tabs = false")
            .errors
            .is_empty()
    );
    assert!(!s.config().vertical_tabs);
    assert!(s.load_config("").errors.is_empty());
    assert!(s.config().vertical_tabs);
}

#[test]
fn tabs_layout_setting() {
    let mut s = ModalSession::new();
    assert!(s.load_config("[options]\ntabs = \"top\"").errors.is_empty());
    assert!(!s.config().vertical_tabs);
    assert!(
        s.load_config("[options]\ntabs = \"side\"")
            .errors
            .is_empty()
    );
    assert!(s.config().vertical_tabs);
    assert_eq!(s.load_config("[options]\ntabs = \"left\"").errors.len(), 1);

    assert_eq!(
        s.run_command("set tabs=side").unwrap().actions,
        vec![Action::VerticalTabs(Switch::On)]
    );
    assert_eq!(
        s.run_command("set tabs=top").unwrap().actions,
        vec![Action::VerticalTabs(Switch::Off)]
    );
    assert!(s.run_command("set tabs=left").is_err());
    assert!(s.run_command("set zoom=2").is_err());
    assert!(s.run_command("set").is_err());
    assert!(
        s.complete("set tabs=s")
            .iter()
            .any(|c| c.text == "set tabs=side")
    );
}
