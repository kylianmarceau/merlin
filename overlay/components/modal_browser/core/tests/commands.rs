use modal_browser_core::command::{CommandSpec, MAX_COMMAND_LINE_LEN, MAX_COUNT, RegistryError};
use modal_browser_core::{
    Action, CommandError, CommandRegistry, CommandStatus, Context, Disposition, Effects, Mode,
    OpenTarget, PaletteKind, Scroll, TargetError,
};

fn reg() -> CommandRegistry {
    CommandRegistry::with_builtins()
}

fn actions(line: &str) -> Vec<Action> {
    reg()
        .execute(line, None)
        .unwrap_or_else(|e| panic!("{line}: {e}"))
        .actions
}

fn err(line: &str) -> CommandError {
    reg().execute(line, None).expect_err(line)
}

#[test]
fn open_url_and_search() {
    assert_eq!(
        actions(":open https://example.com"),
        vec![Action::Open {
            target: OpenTarget::Url("https://example.com".into()),
            disposition: Disposition::CurrentTab,
        }]
    );
    assert_eq!(
        actions("open rust borrow checker"),
        vec![Action::Open {
            target: OpenTarget::Search("rust borrow checker".into()),
            disposition: Disposition::CurrentTab,
        }]
    );
    assert_eq!(actions("o docs.rs"), actions("open docs.rs"));
}

#[test]
fn tabnew_with_and_without_target() {
    assert_eq!(actions(":tabnew"), vec![Action::NewTab]);
    assert_eq!(
        actions(":tabnew https://docs.rs"),
        vec![Action::Open {
            target: OpenTarget::Url("https://docs.rs".into()),
            disposition: Disposition::NewForegroundTab,
        }]
    );
    assert_eq!(actions("tabopen docs.rs"), actions("tabnew docs.rs"));
}

#[test]
fn open_requires_a_target_and_rejects_script_urls() {
    assert!(matches!(
        err(":open"),
        CommandError::MissingArgument { name: "open", .. }
    ));
    assert_eq!(
        err(":open javascript:alert(1)"),
        CommandError::Target {
            name: "open",
            error: TargetError::BlockedScheme("javascript".into()),
        }
    );
    assert!(matches!(
        err(":tabnew data:text/html,x"),
        CommandError::Target { name: "tabnew", .. }
    ));
}

#[test]
fn colon_and_whitespace_are_optional() {
    assert_eq!(actions("   :  tabclose  "), vec![Action::CloseTab]);
    assert_eq!(actions("tabclose"), vec![Action::CloseTab]);
}

#[test]
fn counts_from_arguments_and_bindings() {
    assert_eq!(actions("tabnext"), vec![Action::NextTab { count: 1 }]);
    assert_eq!(actions("tabnext 3"), vec![Action::NextTab { count: 3 }]);
    assert_eq!(
        reg().execute("back", Some(4)).unwrap().actions,
        vec![Action::Back { count: 4 }]
    );
    // Count clamps instead of overflowing.
    assert_eq!(
        reg().execute("forward", Some(u32::MAX)).unwrap().actions,
        vec![Action::Forward { count: MAX_COUNT }]
    );
    assert!(matches!(
        err("tabnext 0"),
        CommandError::InvalidArgument { .. }
    ));
    assert!(matches!(
        err("tabnext x"),
        CommandError::InvalidArgument { .. }
    ));
    assert!(matches!(
        err("tabnext 1 2"),
        CommandError::TooManyArguments { .. }
    ));
    // A key count and an explicit count together is ambiguous.
    assert!(matches!(
        reg().execute("tabnext 2", Some(3)),
        Err(CommandError::TooManyArguments { .. })
    ));
}

#[test]
fn bang() {
    assert_eq!(
        actions("reload"),
        vec![Action::Reload {
            bypass_cache: false
        }]
    );
    assert_eq!(
        actions("reload!"),
        vec![Action::Reload { bypass_cache: true }]
    );
    assert_eq!(actions("r!"), vec![Action::Reload { bypass_cache: true }]);
    assert_eq!(
        err("tabclose!"),
        CommandError::BangNotSupported { name: "tabclose" }
    );
    assert_eq!(
        err("reload!x"),
        CommandError::InvalidName("reload!x".into())
    );
}

#[test]
fn scroll() {
    assert_eq!(
        actions("scroll down"),
        vec![Action::Scroll {
            scroll: Scroll::Down,
            count: 1,
            step: 60,
            smooth: true
        }]
    );
    assert_eq!(
        actions("scroll half-up 2"),
        vec![Action::Scroll {
            scroll: Scroll::HalfPageUp,
            count: 2,
            step: 60,
            smooth: true
        }]
    );
    assert_eq!(
        reg().execute("scroll top", Some(5)).unwrap().actions,
        vec![Action::Scroll {
            scroll: Scroll::Top,
            count: 5,
            step: 60,
            smooth: true
        }]
    );
    assert!(matches!(
        err("scroll"),
        CommandError::MissingArgument { .. }
    ));
    assert!(matches!(
        err("scroll sideways"),
        CommandError::InvalidArgument { .. }
    ));
    for (scroll, name) in Scroll::ALL {
        assert_eq!(Scroll::from_name(name), Some(scroll));
        assert_eq!(scroll.name(), name);
    }
}

#[test]
fn mode_command() {
    let r = reg();
    assert_eq!(
        r.execute("mode passthrough", None).unwrap().enter_mode,
        Some(Mode::Passthrough)
    );
    assert_eq!(
        r.execute("mode insert", None).unwrap().enter_mode,
        Some(Mode::Insert)
    );
    assert!(matches!(err("mode"), CommandError::MissingArgument { .. }));
    assert!(matches!(
        err("mode hint"),
        CommandError::InvalidArgument { .. }
    ));
    assert!(matches!(
        err("mode command"),
        CommandError::InvalidArgument { .. }
    ));
    assert!(matches!(
        err("mode sideways"),
        CommandError::InvalidArgument { .. }
    ));
}

#[test]
fn cmdline_prefill() {
    let r = reg();
    assert_eq!(
        r.execute("cmdline", None).unwrap(),
        Effects {
            actions: vec![Action::OpenPalette {
                kind: PaletteKind::CommandLine,
                text: String::new()
            }],
            enter_mode: Some(Mode::Command),
            ..Effects::default()
        }
    );
    assert_eq!(
        r.execute("cmdline open", None).unwrap().actions,
        vec![Action::OpenPalette {
            kind: PaletteKind::CommandLine,
            text: "open ".into()
        }]
    );
}

#[test]
fn quoting() {
    assert_eq!(
        actions(r#"open "rust \"async\" book""#),
        vec![Action::Open {
            target: OpenTarget::Search(r#"rust "async" book"#.into()),
            disposition: Disposition::CurrentTab,
        }]
    );
    assert_eq!(
        actions("open 'a  b'"),
        vec![Action::Open {
            target: OpenTarget::Search("a  b".into()),
            disposition: Disposition::CurrentTab,
        }]
    );
    assert_eq!(err("open \"unterminated"), CommandError::UnterminatedQuote);
    assert_eq!(err("open 'unterminated"), CommandError::UnterminatedQuote);
}

#[test]
fn unknown_commands_suggest_close_names() {
    assert_eq!(
        err("tabnw"),
        CommandError::Unknown {
            name: "tabnw".into(),
            suggestion: Some("tabnew"),
        }
    );
    assert_eq!(
        err("zzzzzzzz"),
        CommandError::Unknown {
            name: "zzzzzzzz".into(),
            suggestion: None,
        }
    );
    assert_eq!(
        err("tabnw").to_string(),
        "unknown command 'tabnw' (did you mean 'tabnew'?)"
    );
}

#[test]
fn planned_commands_say_so() {
    assert_eq!(
        err("script x"),
        CommandError::NotImplemented { name: "script" }
    );
    assert_eq!(
        err("script x").to_string(),
        "':script' is planned but not built yet"
    );
}

#[test]
fn every_vision_command_is_registered() {
    let r = reg();
    for name in [
        "open",
        "tabnew",
        "tabs",
        "b",
        "history",
        "bookmark",
        "read",
        "extract",
        "split",
        "vsplit",
        "pin",
        "profile",
        "workspace",
        "help",
    ] {
        assert!(r.get(name).is_some(), "{name}");
    }
}

#[test]
fn malformed_lines() {
    assert_eq!(err(""), CommandError::Empty);
    assert_eq!(err(":"), CommandError::Empty);
    assert_eq!(err(":  "), CommandError::Empty);
    assert_eq!(err("9lives"), CommandError::InvalidName("9lives".into()));
    assert_eq!(err("ta$b"), CommandError::InvalidName("ta$b".into()));
    let long = format!("open {}", "a".repeat(MAX_COMMAND_LINE_LEN));
    assert!(matches!(err(&long), CommandError::TooLong { .. }));
}

#[test]
fn no_argument_commands_reject_arguments() {
    for line in [
        "tabclose now",
        "tabrestore 1",
        "tabs x",
        "focus-address x",
        "root x",
        "config-reload now",
    ] {
        assert!(
            matches!(err(line), CommandError::TooManyArguments { .. }),
            "{line}"
        );
    }
}

#[test]
fn help_overview_and_topics() {
    // The overview is the searchable command palette.
    assert_eq!(
        actions("help"),
        vec![Action::OpenPalette {
            kind: PaletteKind::Commands,
            text: String::new()
        }]
    );
    let overview = reg().help(None).unwrap();
    assert!(overview.contains(":open"));
    assert!(overview.contains("vsplit"));

    let topic = actions("help tabnew");
    let [Action::ShowMessage { text, .. }] = topic.as_slice() else {
        panic!("{topic:?}");
    };
    assert!(text.starts_with(":tabnew [url | search terms]"));
    assert!(text.contains(":tabopen"));

    let planned = actions("help :script");
    let [Action::ShowMessage { text, .. }] = planned.as_slice() else {
        panic!("{planned:?}");
    };
    assert!(text.contains("planned"));

    assert!(matches!(err("help nosuch"), CommandError::Unknown { .. }));
}

#[test]
fn completion_of_names() {
    let r = reg();
    let names: Vec<String> = r.complete("tab").into_iter().map(|c| c.text).collect();
    // Canonical names first, aliases after; planned commands excluded.
    assert_eq!(
        names,
        vec![
            "tabclose",
            "tabfirst",
            "tablast",
            "tabnew",
            "tabnext",
            "tabprevious",
            "tabrestore",
            "tabs",
            "tabN",
            "tabc",
            "tabe",
            "tabedit",
            "tabfir",
            "tabl",
            "tabn",
            "tabopen",
            "tabp",
            "tabprev",
        ]
    );
    assert!(r.complete(":he").iter().any(|c| c.text == "help"));
    assert!(r.complete("vspl").iter().any(|c| c.text == "vsplit"));
    // Planned commands are not offered.
    assert!(r.complete("scri").is_empty());
    assert!(r.complete("zz").is_empty());
}

#[test]
fn completion_of_arguments() {
    let r = reg();
    let scroll: Vec<String> = r
        .complete("scroll half")
        .into_iter()
        .map(|c| c.text)
        .collect();
    assert_eq!(scroll, vec!["scroll half-down", "scroll half-up"]);
    let mode: Vec<String> = r.complete("mode p").into_iter().map(|c| c.text).collect();
    assert_eq!(mode, vec!["mode passthrough"]);
    assert!(
        r.complete("help tabn")
            .iter()
            .any(|c| c.text == "help tabnew")
    );
    assert!(r.complete("open docs").is_empty());
    assert!(r.complete("nosuch x").is_empty());
}

fn noop(_: &modal_browser_core::Invocation, _: &Context) -> Result<Effects, CommandError> {
    Ok(Effects::default())
}

fn spec(name: &'static str, aliases: &'static [&'static str]) -> CommandSpec {
    CommandSpec {
        name,
        aliases,
        usage: "",
        summary: "",
        status: CommandStatus::Available,
        accepts_bang: false,
        handler: Some(noop),
    }
}

#[test]
fn registry_rejects_conflicts_and_bad_specs() {
    let mut r = reg();
    assert_eq!(
        r.register(spec("open", &[])),
        Err(RegistryError::DuplicateName("open"))
    );
    assert_eq!(
        r.register(spec("mine", &["o"])),
        Err(RegistryError::DuplicateName("o"))
    );
    assert_eq!(
        r.register(spec("bad name", &[])),
        Err(RegistryError::InvalidName("bad name"))
    );
    assert_eq!(
        r.register(CommandSpec {
            handler: None,
            ..spec("nohandler", &[])
        }),
        Err(RegistryError::MissingHandler("nohandler"))
    );
    assert_eq!(r.register(spec("mine", &["mi"])), Ok(()));
    assert_eq!(r.execute("mi", None), Ok(Effects::default()));
}
