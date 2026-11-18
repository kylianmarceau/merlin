use modal_browser_core::{Key, KeyCode, KeyParseError, KeySequence, Modifiers};

fn seq(s: &str) -> Vec<Key> {
    KeySequence::parse(s).unwrap().keys().to_vec()
}

#[test]
fn plain_characters() {
    assert_eq!(seq("gg"), vec![Key::char('g'), Key::char('g')]);
    assert_eq!(seq("G"), vec![Key::char('G')]);
    assert_eq!(seq(":"), vec![Key::char(':')]);
}

#[test]
fn named_keys_are_case_insensitive() {
    for s in ["<Esc>", "<esc>", "<ESCAPE>"] {
        assert_eq!(seq(s), vec![Key::plain(KeyCode::Escape)], "{s}");
    }
    assert_eq!(seq("<CR>"), vec![Key::plain(KeyCode::Enter)]);
    assert_eq!(seq("<Space>"), vec![Key::char(' ')]);
    assert_eq!(seq("<lt>"), vec![Key::char('<')]);
    assert_eq!(seq("<F12>"), vec![Key::plain(KeyCode::F(12))]);
}

#[test]
fn modifiers() {
    assert_eq!(
        seq("<C-d>"),
        vec![Key::new(KeyCode::Char('d'), Modifiers::CTRL)]
    );
    assert_eq!(
        seq("<D-l>"),
        vec![Key::new(KeyCode::Char('l'), Modifiers::META)]
    );
    assert_eq!(
        seq("<C-A-x>"),
        vec![Key::new(
            KeyCode::Char('x'),
            Modifiers::CTRL | Modifiers::ALT
        )]
    );
    assert_eq!(seq("<M-x>"), seq("<A-x>"));
    assert_eq!(
        seq("<S-Esc>"),
        vec![Key::new(KeyCode::Escape, Modifiers::SHIFT)]
    );
}

#[test]
fn shift_normalisation() {
    // Shift is part of the character for unchorded keys.
    assert_eq!(
        Key::new(KeyCode::Char('G'), Modifiers::SHIFT),
        Key::char('G')
    );
    assert_eq!(seq("<S-g>"), seq("G"));
    // With Ctrl, uppercase means lowercase + Shift.
    assert_eq!(seq("<C-D>"), seq("<C-S-d>"));
    assert_ne!(seq("<C-D>"), seq("<C-d>"));
    // Space keeps Shift so <S-Space> stays distinct.
    assert_ne!(seq("<S-Space>"), seq("<Space>"));
}

#[test]
fn dash_and_bracket_keys() {
    assert_eq!(
        seq("<C-->"),
        vec![Key::new(KeyCode::Char('-'), Modifiers::CTRL)]
    );
    assert_eq!(
        seq("<C->>"),
        vec![Key::new(KeyCode::Char('>'), Modifiers::CTRL)]
    );
    assert_eq!(seq("-"), vec![Key::char('-')]);
    // Control-minus, then '>' (found by the fuzz target): not `<C-->` plus
    // a key named "->".
    assert_eq!(
        seq("<C-->>"),
        vec![
            Key::new(KeyCode::Char('-'), Modifiers::CTRL),
            Key::char('>')
        ]
    );
    assert_eq!(
        seq("<C-S->>"),
        vec![Key::new(
            KeyCode::Char('>'),
            Modifiers::CTRL.union(Modifiers::SHIFT)
        )]
    );
}

#[test]
fn mixed_sequence() {
    assert_eq!(
        seq("<C-w>v"),
        vec![
            Key::new(KeyCode::Char('w'), Modifiers::CTRL),
            Key::char('v')
        ]
    );
}

#[test]
fn parse_errors() {
    assert_eq!(KeySequence::parse(""), Err(KeyParseError::Empty));
    assert_eq!(
        KeySequence::parse("g<C-d"),
        Err(KeyParseError::Unterminated(1))
    );
    assert_eq!(
        KeySequence::parse("<Bogus>"),
        Err(KeyParseError::UnknownKey("Bogus".into()))
    );
    assert_eq!(
        KeySequence::parse("<X-a>"),
        Err(KeyParseError::UnknownModifier("X".into()))
    );
    assert_eq!(
        KeySequence::parse("<C-C-a>"),
        Err(KeyParseError::DuplicateModifier("C".into()))
    );
    assert_eq!(
        KeySequence::parse("<>"),
        Err(KeyParseError::UnknownKey(String::new()))
    );
}

#[test]
fn display_round_trips() {
    for s in [
        "gg", "G", "<C-d>", "<Esc>", "<S-Esc>", "<lt>", "<Space>", "<C-S-d>", "<D-l>", "<F5>",
        "<C-w>v",
    ] {
        let parsed = KeySequence::parse(s).unwrap();
        let shown = parsed.to_string();
        assert_eq!(
            KeySequence::parse(&shown).unwrap(),
            parsed,
            "{s} -> {shown}"
        );
    }
    assert_eq!(KeySequence::parse("<esc>").unwrap().to_string(), "<Esc>");
    assert_eq!(KeySequence::parse("<C-D>").unwrap().to_string(), "<C-S-d>");
}

#[test]
fn from_dom_key_values() {
    let none = Modifiers::NONE;
    assert_eq!(Key::from_dom_key("j", none), Some(Key::char('j')));
    assert_eq!(
        Key::from_dom_key(":", Modifiers::SHIFT),
        Some(Key::char(':'))
    );
    assert_eq!(
        Key::from_dom_key("Escape", none),
        Some(Key::plain(KeyCode::Escape))
    );
    assert_eq!(
        Key::from_dom_key("ArrowDown", none),
        Some(Key::plain(KeyCode::Down))
    );
    assert_eq!(
        Key::from_dom_key("F5", none),
        Some(Key::plain(KeyCode::F(5)))
    );
    assert_eq!(Key::from_dom_key(" ", none), Some(Key::char(' ')));
    assert_eq!(Key::from_dom_key("é", none), Some(Key::char('é')));
    assert_eq!(
        Key::from_dom_key("D", Modifiers::CTRL | Modifiers::SHIFT),
        KeySequence::parse("<C-S-d>")
            .unwrap()
            .keys()
            .first()
            .copied()
    );
}

#[test]
fn from_dom_key_refuses_keys_that_must_reach_the_page() {
    for k in [
        "Shift",
        "Control",
        "Meta",
        "Alt",
        "CapsLock",
        "Dead",
        "Process",
        "Unidentified",
        "",
        "AudioVolumeUp",
        "F25",
    ] {
        assert_eq!(Key::from_dom_key(k, Modifiers::NONE), None, "{k:?}");
    }
}

#[test]
fn digits() {
    assert_eq!(Key::char('7').digit(), Some(7));
    assert_eq!(Key::new(KeyCode::Char('7'), Modifiers::CTRL).digit(), None);
    assert_eq!(Key::char('x').digit(), None);
}
