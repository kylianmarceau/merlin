//! Hint labels: shape, uniqueness, prefix-freedom and filtering.

use modal_browser_core::hints::{HintStep, MAX_HINT_TARGETS, generate_labels};
use modal_browser_core::{HintAction, HintAlphabet, HintKind, HintSet};

fn prefix_free(labels: &[String]) -> bool {
    labels.iter().enumerate().all(|(i, a)| {
        labels
            .iter()
            .enumerate()
            .all(|(j, b)| i == j || !b.starts_with(a.as_str()))
    })
}

#[test]
fn labels_are_unique_prefix_free_and_short() {
    let alphabet = HintAlphabet::default();
    for n in [0, 1, 2, 13, 14, 15, 20, 100, 196, 197, 500, 2000] {
        let labels = generate_labels(n, &alphabet);
        assert_eq!(labels.len(), n);
        assert!(prefix_free(&labels), "n={n}");
        let mut sorted = labels.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), n, "unique, n={n}");
        let longest = labels.iter().map(|l| l.chars().count()).max().unwrap_or(0);
        // 14 characters: one key up to 14 targets, two up to 196, three
        // up to 2744.
        let expected = match n {
            0 => 0,
            1..=14 => 1,
            15..=196 => 2,
            _ => 3,
        };
        assert_eq!(longest, expected, "n={n}");
        assert!(
            labels
                .iter()
                .all(|l| l.chars().all(|c| alphabet.contains(c)))
        );
    }
}

#[test]
fn few_targets_get_home_row_keys_in_order() {
    let labels = generate_labels(4, &HintAlphabet::default());
    assert_eq!(labels, ["s", "a", "d", "f"]);
}

#[test]
fn custom_alphabet() {
    let alphabet = HintAlphabet::new("ab").unwrap();
    let labels = generate_labels(5, &alphabet);
    assert!(prefix_free(&labels));
    assert!(
        labels
            .iter()
            .all(|l| l.chars().all(|c| c == 'a' || c == 'b'))
    );
}

#[test]
fn alphabet_validation() {
    assert!(HintAlphabet::new("a").is_err());
    assert!(HintAlphabet::new("").is_err());
    assert!(HintAlphabet::new("aba").is_err());
    assert!(HintAlphabet::new("a b").is_err());
    assert!(HintAlphabet::new("aB").is_err());
    assert!(HintAlphabet::new("asdfghjkl;").is_ok());
}

#[test]
fn set_filters_by_kind_and_caps_targets() {
    let kinds = vec![HintKind::Link; MAX_HINT_TARGETS + 50];
    let set = HintSet::new(HintAction::Follow, &kinds, &HintAlphabet::default());
    assert_eq!(set.hints.len(), MAX_HINT_TARGETS);

    let mixed = [HintKind::Editable, HintKind::Other, HintKind::Editable];
    let set = HintSet::new(HintAction::FocusInput, &mixed, &HintAlphabet::default());
    let targets: Vec<u32> = set.hints.iter().map(|h| h.target).collect();
    assert_eq!(targets, [0, 2]);
}

#[test]
fn typing_narrows_then_chooses() {
    let kinds = vec![HintKind::Link; 30];
    let mut set = HintSet::new(HintAction::Follow, &kinds, &HintAlphabet::default());
    let target = set.hints[5].clone();
    let mut chars = target.label.chars();
    let first = chars.next().unwrap();
    assert_eq!(set.push(first), HintStep::Narrowed);
    assert!(set.visible().all(|h| h.label.starts_with(first)));
    assert!(set.visible().count() < 30);
    assert_eq!(set.push(chars.next().unwrap()), HintStep::Chosen(target));
}

#[test]
fn uppercase_typing_matches_lowercase_labels() {
    let mut set = HintSet::new(
        HintAction::Follow,
        &[HintKind::Link; 3],
        &HintAlphabet::default(),
    );
    let label = set.hints[1].label.clone();
    let upper = label.to_uppercase().chars().next().unwrap();
    assert!(matches!(set.push(upper), HintStep::Chosen(h) if h.label == label));
}

#[test]
fn rejected_and_backspace() {
    let mut set = HintSet::new(
        HintAction::Follow,
        &[HintKind::Link; 3],
        &HintAlphabet::default(),
    );
    assert_eq!(set.push('z'), HintStep::Rejected);
    assert_eq!(set.typed(), "");
    assert!(!set.pop());
}

#[test]
fn action_names_round_trip() {
    for (action, name) in HintAction::ALL {
        assert_eq!(HintAction::from_name(name), Some(action));
        assert_eq!(action.name(), name);
    }
    assert_eq!(HintAction::from_name("nope"), None);
}
