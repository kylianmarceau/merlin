//! Configuration: the TOML subset, the schema, and applying it to a session.

use modal_browser_core::toml_lite::{self, Value};
use modal_browser_core::{
    Action, ConfigFile, FocusContext, Key, KeyCode, KeyDisposition, KeySequence, ModalSession,
    Mode, Modifiers, SitePattern,
};

const PAGE: FocusContext = FocusContext::PAGE;

fn press(s: &mut ModalSession, keys: &str) -> (KeyDisposition, Vec<Action>) {
    let mut actions = Vec::new();
    let mut last = KeyDisposition::Forward;
    for k in KeySequence::parse(keys).unwrap().keys() {
        let o = s.handle_key(*k, &PAGE);
        last = o.disposition;
        actions.extend(o.actions);
    }
    (last, actions)
}

// -- TOML subset ---------------------------------------------------------------

#[test]
fn toml_values_tables_and_comments() {
    let entries = toml_lite::parse(
        r#"
# comment
top = 1
[options]   # trailing comment
name = "a \"quoted\" \u00e9 string"
lit = 'C:\path'
yes = true
n = -1_000
list = [
  "a", # inside
  "b",
]
[keys.normal]
"<C-n>" = "tabnext"
dotted.key = 'x'
"#,
    )
    .unwrap();
    let get = |path: &[&str]| {
        entries
            .iter()
            .find(|e| e.path.iter().map(String::as_str).eq(path.iter().copied()))
            .map(|e| e.value.clone())
            .unwrap_or_else(|| panic!("{path:?}"))
    };
    assert_eq!(get(&["top"]), Value::Integer(1));
    assert_eq!(
        get(&["options", "name"]),
        Value::String("a \"quoted\" é string".into())
    );
    assert_eq!(get(&["options", "lit"]), Value::String("C:\\path".into()));
    assert_eq!(get(&["options", "yes"]), Value::Boolean(true));
    assert_eq!(get(&["options", "n"]), Value::Integer(-1000));
    assert_eq!(
        get(&["options", "list"]),
        Value::Array(vec![Value::String("a".into()), Value::String("b".into())])
    );
    assert_eq!(
        get(&["keys", "normal", "<C-n>"]),
        Value::String("tabnext".into())
    );
    assert_eq!(
        get(&["keys", "normal", "dotted", "key"]),
        Value::String("x".into())
    );
    assert_eq!(entries[1].line, 5, "lines are 1-based");
}

#[test]
fn toml_unsupported_features_fail_with_line_numbers() {
    let cases = [
        ("a = 1.5", "floats"),
        ("a = 1979-05-27", "dates"),
        ("a = { b = 1 }", "inline tables"),
        ("[[a]]", "arrays of tables"),
        ("a = \"\"\"x\"\"\"", "multi-line"),
        ("a = bare", "quotes"),
        ("a = \"open", "unterminated"),
        ("a = 1\na = 2", "twice"),
        ("[a]\n[a]", "twice"),
        ("a = 1 b = 2", "after value"),
        ("a = 01", "invalid integer"),
        ("a = [1 2]", "expected ','"),
        ("a = \"\\q\"", "escape"),
        ("a = +-5", "invalid integer"),
        ("a = -+5", "invalid integer"),
        ("a = 9223372036854775808", "out of range"),
        ("a = -9223372036854775809", "out of range"),
    ];
    for (text, needle) in cases {
        let err = toml_lite::parse(text).expect_err(text);
        assert!(
            err.message.contains(needle),
            "{text:?}: {} (wanted {needle})",
            err.message
        );
    }
    let err = toml_lite::parse("ok = 1\n\nbad = ?").unwrap_err();
    assert_eq!(err.line, 3);
}

#[test]
fn toml_integers_cover_the_whole_i64_range() {
    for (text, value) in [
        ("a = -9223372036854775808", i64::MIN),
        ("a = 9223372036854775807", i64::MAX),
        ("a = +1_000", 1000),
        ("a = -0", 0),
    ] {
        let entries = toml_lite::parse(text).expect(text);
        assert_eq!(entries[0].value, Value::Integer(value), "{text}");
    }
}

#[test]
fn toml_input_is_bounded() {
    let big = "# x\n".repeat(100_000);
    assert!(toml_lite::parse(&big).is_err());
}

// -- Schema --------------------------------------------------------------------

#[test]
fn schema_collects_every_error_and_keeps_the_rest() {
    let (file, errors) = ConfigFile::parse(
        r#"
[options]
hint_chars = "asdf"
scroll_step = 5
smoth_scroll = true
passthrough_exit = "<Esc>"
passthrough_sites = ["mail.google.com", "https://bad/"]

[keys.insert]
x = "tabclose"

[keys.normal]
x = "tabclose"

[unmap]
normal = ["d"]

[colors]
a = 1
"#,
    );
    let messages: Vec<String> = errors.iter().map(|e| e.to_string()).collect();
    assert_eq!(errors.len(), 6, "{messages:#?}");
    assert!(messages[0].starts_with("line 4: 'scroll_step' must be from 10"));
    assert!(messages[1].contains("did you mean 'smooth_scroll'"));
    assert!(messages[2].contains("cannot be plain <Esc>"));
    assert!(messages[3].contains("not a host pattern"));
    assert!(messages[4].contains("only normal and visual"));
    assert!(messages[5].contains("unknown table 'colors'"));
    assert_eq!(file.hint_chars.unwrap().to_string(), "asdf");
    assert_eq!(file.maps.len(), 1);
    assert_eq!(file.unmaps.len(), 1);
    assert_eq!(file.scroll_step, None);
}

#[test]
fn site_patterns() {
    let exact = SitePattern::parse("mail.google.com").unwrap();
    assert!(exact.matches("mail.google.com"));
    assert!(exact.matches("MAIL.google.com."));
    assert!(!exact.matches("google.com"));
    assert!(!exact.matches("evilmail.google.com"));

    let wild = SitePattern::parse("*.figma.com").unwrap();
    assert!(wild.matches("figma.com"));
    assert!(wild.matches("www.figma.com"));
    assert!(!wild.matches("notfigma.com"));

    for bad in [
        "",
        "*.",
        "https://x.com",
        "x.com/path",
        "a..b",
        "*x.com",
        "a b",
    ] {
        assert!(SitePattern::parse(bad).is_err(), "{bad}");
    }
}

// -- Applying to a session -----------------------------------------------------

#[test]
fn load_config_applies_options_maps_and_unmaps() {
    let mut s = ModalSession::new();
    let report = s.load_config(
        r#"
[options]
scroll_step = 120
smooth_scroll = false
sequence_timeout_ms = 400
passthrough_exit = "<C-Esc>"

[keys.normal]
x = "tabclose"
"<C-n>" = "tabnext"

[unmap]
normal = ["d"]
"#,
    );
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!(report.bindings, 2);
    assert_eq!(press(&mut s, "x").1, vec![Action::CloseTab]);
    assert_eq!(press(&mut s, "<C-n>").1, vec![Action::NextTab { count: 1 }]);
    // Unmapped keys go back to the page.
    assert_eq!(press(&mut s, "d"), (KeyDisposition::Forward, vec![]));
    assert_eq!(
        press(&mut s, "j").1,
        vec![Action::Scroll {
            scroll: modal_browser_core::Scroll::Down,
            count: 1,
            step: 120,
            smooth: false
        }]
    );
    assert_eq!(press(&mut s, "g").0, KeyDisposition::Consumed);
    assert_eq!(s.config().sequence_timeout_ms, 400);
    assert_eq!(
        s.config().passthrough_exit,
        Key::new(KeyCode::Escape, Modifiers::CTRL)
    );
}

#[test]
fn reloading_starts_from_defaults() {
    let mut s = ModalSession::new();
    s.load_config("[keys.normal]\nx = \"tabclose\"\n[unmap]\nnormal = [\"d\"]");
    let report = s.load_config("");
    assert!(report.errors.is_empty());
    assert_eq!(press(&mut s, "x").0, KeyDisposition::Forward);
    assert_eq!(press(&mut s, "d").1, vec![Action::CloseTab]);
}

#[test]
fn bad_bindings_report_lines_and_good_ones_apply() {
    let mut s = ModalSession::new();
    let report = s.load_config(
        "[keys.normal]\n\
         a = \"tabnw\"\n\
         b = \"tabclose\"\n\
         \"<Esc>\" = \"tabnext\"\n\
         \"<C-\" = \"tabnext\"\n\
         [unmap]\n\
         normal = [\"zz\"]\n",
    );
    let lines: Vec<usize> = report.errors.iter().map(|e| e.line).collect();
    assert_eq!(lines, [2, 4, 5, 7], "{:?}", report.errors);
    assert!(report.errors[0].message.contains("did you mean 'tabnew'"));
    assert_eq!(report.bindings, 1);
    assert_eq!(press(&mut s, "b").1, vec![Action::CloseTab]);
}

#[test]
fn syntax_error_keeps_defaults() {
    let mut s = ModalSession::new();
    let report = s.load_config("[keys.normal\nx = 1");
    assert_eq!(report.errors.len(), 1);
    assert_eq!(press(&mut s, "t").1, vec![Action::NewTab]);
}

#[test]
fn hint_chars_from_config_label_hints() {
    let mut s = ModalSession::new();
    s.load_config("[options]\nhint_chars = \"jk\"");
    let o = s.handle_key(Key::char('f'), &PAGE);
    let [Action::CollectHints { generation, .. }] = o.actions[..] else {
        panic!()
    };
    let o = s.hints_collected(generation, &[modal_browser_core::HintKind::Link; 2]);
    let [Action::ShowHints { hints, .. }] = &o.actions[..] else {
        panic!()
    };
    let labels: Vec<&str> = hints.iter().map(|h| h.label.as_str()).collect();
    assert_eq!(labels, ["j", "k"]);
}

// -- Site passthrough ----------------------------------------------------------

#[test]
fn passthrough_sites_start_and_end_passthrough() {
    let mut s = ModalSession::new();
    s.load_config("[options]\npassthrough_sites = [\"mail.google.com\", \"*.figma.com\"]");
    let o = s.on_page_changed("mail.google.com");
    assert_eq!(o.mode, Mode::Passthrough);
    assert!(
        matches!(&o.actions[..], [Action::ShowMessage { text, .. }] if text.contains("<S-Esc>"))
    );
    // Keys go to Gmail.
    assert_eq!(press(&mut s, "j"), (KeyDisposition::Forward, vec![]));
    // Same site again: stays, no repeated message.
    assert!(s.on_page_changed("mail.google.com").actions.is_empty());
    // Leaving the site ends automatic passthrough.
    assert_eq!(s.on_page_changed("docs.rs").mode, Mode::Normal);
    assert_eq!(s.on_page_changed("www.figma.com").mode, Mode::Passthrough);
}

#[test]
fn manual_passthrough_survives_navigation_and_exit_sticks_on_the_site() {
    let mut s = ModalSession::new();
    s.load_config("[options]\npassthrough_sites = [\"mail.google.com\"]");
    press(&mut s, "<C-v>");
    assert_eq!(s.on_page_changed("docs.rs").mode, Mode::Passthrough);

    let mut s = ModalSession::new();
    s.load_config("[options]\npassthrough_sites = [\"mail.google.com\"]");
    s.on_page_changed("mail.google.com");
    press(&mut s, "<S-Esc>");
    assert_eq!(s.mode(), Mode::Normal, "the user left on purpose");
    assert_eq!(press(&mut s, "j").0, KeyDisposition::Consumed);
}

#[test]
fn page_change_ends_insert_and_hints() {
    let mut s = ModalSession::new();
    press(&mut s, "i");
    assert_eq!(s.on_page_changed("docs.rs").mode, Mode::Normal);
    press(&mut s, "f");
    let o = s.on_page_changed("docs.rs");
    assert_eq!(o.mode, Mode::Normal);
    assert_eq!(o.actions, vec![Action::HideHints]);
}

#[test]
fn modal_browsing_off_gives_every_key_to_the_page() {
    let mut s = ModalSession::new();
    assert!(s.config().modal_browsing);
    assert_eq!(s.mode_indicator(), "NORMAL");

    let report = s.load_config("[options]\nmodal_browsing = false");
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert!(!s.config().modal_browsing);
    assert_eq!(s.mode_indicator(), "");
    for keys in ["f", "j", ":", "gg", "i", "<Esc>", "<S-Esc>", "<C-S-e>"] {
        let (disposition, actions) = press(&mut s, keys);
        assert_eq!(disposition, KeyDisposition::Forward, "{keys}");
        assert!(actions.is_empty(), "{keys}: {actions:?}");
        assert_eq!(s.mode(), Mode::Normal, "{keys}");
    }
    // No mode follows focus or the site.
    assert_eq!(
        s.on_focus_changed(&FocusContext::EDITABLE).mode,
        Mode::Normal
    );
    s.load_config("[options]\nmodal_browsing = false\npassthrough_sites = [\"mail.google.com\"]");
    let o = s.on_page_changed("mail.google.com");
    assert_eq!(o.mode, Mode::Normal);
    assert!(o.actions.is_empty());
}

#[test]
fn turning_modal_browsing_off_leaves_the_current_mode_and_on_restores_keys() {
    let mut s = ModalSession::new();
    press(&mut s, "f");
    assert_eq!(s.mode(), Mode::Hint);
    s.load_config("[options]\nmodal_browsing = false");
    assert_eq!(s.mode(), Mode::Normal);
    assert!(s.hints().is_none());

    s.load_config("[options]\nmodal_browsing = true");
    assert_eq!(s.mode_indicator(), "NORMAL");
    assert_eq!(press(&mut s, "j").0, KeyDisposition::Consumed);
    // A missing option means on.
    s.load_config("");
    assert!(s.config().modal_browsing);
}

#[test]
fn modal_browsing_must_be_a_boolean() {
    let (file, errors) = ConfigFile::parse("[options]\nmodal_browsing = \"no\"");
    assert_eq!(file.modal_browsing, None);
    assert_eq!(errors.len(), 1);
    assert!(errors[0].message.contains("true or false"), "{}", errors[0]);
}
