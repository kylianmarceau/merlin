use modal_browser_core::keymap::{DEFAULT_NORMAL, MAX_SEQUENCE_LEN};
use modal_browser_core::{
    CommandError, CommandRegistry, Key, KeySequence, Keymap, KeymapError, Lookup, Mode,
};

fn keys(s: &str) -> Vec<Key> {
    KeySequence::parse(s).unwrap().keys().to_vec()
}

fn setup() -> (CommandRegistry, Keymap) {
    let registry = CommandRegistry::with_builtins();
    let keymap = Keymap::with_defaults(&registry);
    (registry, keymap)
}

#[test]
fn defaults_load_and_resolve() {
    let (_, keymap) = setup();
    assert_eq!(keymap.bindings(Mode::Normal).len(), DEFAULT_NORMAL.len());
    let Lookup::Exact(b) = keymap.lookup(Mode::Normal, &keys("j")) else {
        panic!()
    };
    assert_eq!(b.command, "scroll down");
    let Lookup::Exact(b) = keymap.lookup(Mode::Normal, &keys("<C-d>")) else {
        panic!()
    };
    assert_eq!(b.command, "scroll half-down");
}

#[test]
fn prefix_lookup() {
    let (_, keymap) = setup();
    assert_eq!(keymap.lookup(Mode::Normal, &keys("g")), Lookup::Prefix);
    assert!(matches!(
        keymap.lookup(Mode::Normal, &keys("gg")),
        Lookup::Exact(_)
    ));
    assert!(matches!(
        keymap.lookup(Mode::Normal, &keys("gt")),
        Lookup::Exact(_)
    ));
    assert_eq!(keymap.lookup(Mode::Normal, &keys("gx")), Lookup::NoMatch);
    assert_eq!(keymap.lookup(Mode::Normal, &keys("z")), Lookup::NoMatch);
    // Insert mode has no bindings at all.
    assert_eq!(keymap.lookup(Mode::Insert, &keys("j")), Lookup::NoMatch);
}

#[test]
fn exact_and_prefix() {
    let (registry, mut keymap) = setup();
    keymap.bind(Mode::Normal, "g", "tabnew", &registry).unwrap();
    assert!(matches!(
        keymap.lookup(Mode::Normal, &keys("g")),
        Lookup::ExactAndPrefix(_)
    ));
}

#[test]
fn prefix_detection_is_not_fooled_by_neighbours() {
    // "a" < "ab" < "b" in key order; make sure "a" does not see "b".
    let registry = CommandRegistry::with_builtins();
    let mut keymap = Keymap::new();
    keymap.bind(Mode::Normal, "a", "tabnew", &registry).unwrap();
    keymap.bind(Mode::Normal, "b", "tabnew", &registry).unwrap();
    assert!(matches!(
        keymap.lookup(Mode::Normal, &keys("a")),
        Lookup::Exact(_)
    ));
    keymap
        .bind(Mode::Normal, "ab", "tabnew", &registry)
        .unwrap();
    assert!(matches!(
        keymap.lookup(Mode::Normal, &keys("a")),
        Lookup::ExactAndPrefix(_)
    ));
}

#[test]
fn rebinding_returns_previous_and_unbind_removes() {
    let (registry, mut keymap) = setup();
    let old = keymap
        .bind(Mode::Normal, "j", "scroll up", &registry)
        .unwrap();
    assert_eq!(old.unwrap().command, "scroll down");
    assert_eq!(keymap.unbind(Mode::Normal, "j"), Ok(true));
    assert_eq!(keymap.unbind(Mode::Normal, "j"), Ok(false));
    assert_eq!(keymap.lookup(Mode::Normal, &keys("j")), Lookup::NoMatch);
}

#[test]
fn visual_mode_has_its_own_map() {
    let (registry, mut keymap) = setup();
    keymap
        .bind(Mode::Visual, "j", "scroll down", &registry)
        .unwrap();
    assert!(matches!(
        keymap.lookup(Mode::Visual, &keys("j")),
        Lookup::Exact(_)
    ));
    // Visual has its own defaults; Normal-only keys are absent.
    assert!(matches!(
        keymap.lookup(Mode::Visual, &keys("y")),
        Lookup::Exact(b) if b.command == "yank selection"
    ));
    assert_eq!(keymap.lookup(Mode::Visual, &keys("t")), Lookup::NoMatch);
}

#[test]
fn config_errors() {
    let (registry, mut keymap) = setup();
    let mut bind = |mode, k: &str, c: &str| keymap.bind(mode, k, c, &registry).unwrap_err();

    assert!(matches!(
        bind(Mode::Normal, "<Nope>", "tabnew"),
        KeymapError::InvalidKeys { .. }
    ));
    assert!(matches!(
        bind(Mode::Normal, "", "tabnew"),
        KeymapError::InvalidKeys { .. }
    ));
    assert_eq!(
        bind(Mode::Insert, "jj", "mode normal"),
        KeymapError::ModeNotBindable(Mode::Insert)
    );
    assert_eq!(
        bind(Mode::Passthrough, "x", "tabnew"),
        KeymapError::ModeNotBindable(Mode::Passthrough)
    );
    assert_eq!(
        bind(Mode::Command, "x", "tabnew"),
        KeymapError::ModeNotBindable(Mode::Command)
    );
    assert!(matches!(
        bind(Mode::Normal, "3x", "tabnew"),
        KeymapError::StartsWithCount { .. }
    ));
    assert!(matches!(
        bind(Mode::Normal, "<Esc>", "tabnew"),
        KeymapError::ReservedKey { .. }
    ));
    let too_long = "a".repeat(MAX_SEQUENCE_LEN + 1);
    assert!(matches!(
        bind(Mode::Normal, &too_long, "tabnew"),
        KeymapError::TooLong { .. }
    ));

    // Commands are validated by parsing and dry-running them.
    assert!(matches!(
        bind(Mode::Normal, "x", "tabnw"),
        KeymapError::InvalidCommand {
            error: CommandError::Unknown { .. },
            ..
        }
    ));
    assert!(matches!(
        bind(Mode::Normal, "x", "scroll sideways"),
        KeymapError::InvalidCommand {
            error: CommandError::InvalidArgument { .. },
            ..
        }
    ));
    assert!(matches!(
        bind(Mode::Normal, "x", "script x"),
        KeymapError::InvalidCommand {
            error: CommandError::NotImplemented { .. },
            ..
        }
    ));
    assert!(matches!(
        bind(Mode::Normal, "x", "open javascript:alert(1)"),
        KeymapError::InvalidCommand {
            error: CommandError::Target { .. },
            ..
        }
    ));
    // '0' alone is allowed (it is not a count start).
    assert!(
        keymap
            .bind(Mode::Normal, "0", "scroll left", &registry)
            .is_ok()
    );
    // Esc as part of a longer sequence is fine.
    assert!(
        keymap
            .bind(Mode::Normal, "g<Esc>", "tabnew", &registry)
            .is_ok()
    );
}

#[test]
fn error_messages_are_readable() {
    let (registry, mut keymap) = setup();
    let e = keymap
        .bind(Mode::Normal, "x", "tabnw", &registry)
        .unwrap_err();
    assert_eq!(
        e.to_string(),
        "binding for 'x': unknown command 'tabnw' (did you mean 'tabnew'?)"
    );
}
