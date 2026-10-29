use modal_browser_core::editor::{self, FILE_PLACEHOLDER};
use modal_browser_core::{EditDecision, FieldInfo, FieldKind};

fn field(kind: FieldKind) -> FieldInfo {
    FieldInfo {
        kind,
        input_type: String::new(),
        autocomplete: String::new(),
        label: "comment".into(),
        length: 10,
        read_only: false,
    }
}

fn refused(info: &FieldInfo, force: bool) -> String {
    match editor::decide(info, force) {
        EditDecision::Refused(why) => why,
        EditDecision::Allowed => panic!("allowed {info:?}"),
    }
}

#[test]
fn text_fields_are_allowed() {
    assert_eq!(
        editor::decide(&field(FieldKind::TextArea), false),
        EditDecision::Allowed
    );
    assert_eq!(
        editor::decide(&field(FieldKind::ContentEditable), false),
        EditDecision::Allowed
    );
    for t in ["", "text", "search", "url", "email", "tel"] {
        let info = FieldInfo {
            input_type: t.into(),
            ..field(FieldKind::Input)
        };
        assert_eq!(editor::decide(&info, false), EditDecision::Allowed, "{t}");
    }
}

#[test]
fn secrets_never_leave_even_with_force() {
    let password = FieldInfo {
        input_type: "password".into(),
        ..field(FieldKind::Input)
    };
    assert!(refused(&password, true).contains("Password"));
    for ac in [
        "cc-number",
        "current-password",
        "one-time-code",
        "billing cc-csc",
    ] {
        let info = FieldInfo {
            autocomplete: ac.into(),
            ..field(FieldKind::TextArea)
        };
        assert!(refused(&info, true).contains("password or payment"), "{ac}");
    }
    let number = FieldInfo {
        input_type: "number".into(),
        ..field(FieldKind::Input)
    };
    assert!(refused(&number, true).contains("does not hold text"));
    let ro = FieldInfo {
        read_only: true,
        ..field(FieldKind::TextArea)
    };
    assert!(refused(&ro, true).contains("read-only"));
    assert!(refused(&field(FieldKind::None), true).contains("No text field"));
    let big = FieldInfo {
        length: editor::MAX_FIELD_LEN + 1,
        ..field(FieldKind::TextArea)
    };
    assert!(refused(&big, true).contains("1 MiB"));
}

#[test]
fn sensitive_looking_names_need_a_bang() {
    for label in [
        "card-number",
        "cvv",
        "api_token",
        "Secret key",
        "user PIN",
        "cardholder",
    ] {
        let info = FieldInfo {
            label: label.into(),
            ..field(FieldKind::Input)
        };
        assert!(refused(&info, false).contains(":edit!"), "{label}");
        assert_eq!(
            editor::decide(&info, true),
            EditDecision::Allowed,
            "{label}"
        );
    }
    // Ordinary words that merely contain those letters are fine.
    for label in ["pinned-note", "description", "spinner", "postcard_text"] {
        let info = FieldInfo {
            label: label.into(),
            ..field(FieldKind::Input)
        };
        assert_eq!(
            editor::decide(&info, false),
            EditDecision::Allowed,
            "{label}"
        );
    }
}

#[test]
fn editor_command_resolution() {
    let configured = vec![
        "ghostty".to_string(),
        "-e".into(),
        "nvim".into(),
        "{file}".into(),
    ];
    assert_eq!(
        editor::command(&configured, "code -w", "vi"),
        Ok(configured.clone())
    );
    assert_eq!(
        editor::command(&[], "  zed --wait ", "vi"),
        Ok(vec![
            "zed".to_string(),
            "--wait".into(),
            FILE_PLACEHOLDER.into()
        ])
    );
    assert_eq!(
        editor::command(&[], "", "nvim-qt --nofork"),
        Ok(vec![
            "nvim-qt".to_string(),
            "--nofork".into(),
            FILE_PLACEHOLDER.into()
        ])
    );
    assert!(
        editor::command(&[], " ", "")
            .unwrap_err()
            .contains("No editor configured")
    );
    assert_eq!(
        editor::substitute(
            &["nvim".into(), "+set ft=markdown".into(), "{file}".into()],
            "/tmp/x y.md"
        ),
        vec!["nvim", "+set ft=markdown", "/tmp/x y.md"]
    );
    let too_many: Vec<String> = (0..40).map(|i| i.to_string()).collect();
    assert!(editor::command(&too_many, "", "").is_err());
}
