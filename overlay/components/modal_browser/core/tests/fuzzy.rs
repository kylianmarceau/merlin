//! Fuzzy ranking used by the palette.

use modal_browser_core::fuzzy::{MAX_TEXT_CHARS, fuzzy_match, match_fields};

fn score(p: &str, t: &str) -> i32 {
    fuzzy_match(p, t)
        .unwrap_or_else(|| panic!("{p} in {t}"))
        .score
}

#[test]
fn subsequence_required() {
    assert!(fuzzy_match("gh", "GitHub").is_some());
    assert!(fuzzy_match("hg", "GitHub").is_none());
    assert!(fuzzy_match("xyz", "docs.rs").is_none());
    assert!(fuzzy_match("toolong", "short").is_none());
}

#[test]
fn empty_pattern_matches_everything() {
    let m = fuzzy_match("", "anything").unwrap();
    assert_eq!(m.score, 0);
    assert!(m.positions.is_empty());
}

#[test]
fn positions_point_at_matched_characters() {
    let m = fuzzy_match("drs", "docs.rs").unwrap();
    let text: Vec<char> = "docs.rs".chars().collect();
    let got: String = m.positions.iter().map(|&i| text[i]).collect();
    assert_eq!(got, "drs");
    // Word-start alignment wins: 'r' and 's' of ".rs", not "docs".
    assert_eq!(m.positions, vec![0, 5, 6]);
}

#[test]
fn word_starts_and_runs_rank_higher() {
    // Consecutive beats scattered.
    assert!(score("doc", "docs.rs") > score("doc", "d-o-c"));
    // A word start beats the middle of a word.
    assert!(score("rs", "docs.rs") > score("rs", "doors"));
    // Prefix of the text beats a later match.
    assert!(score("git", "github.com") > score("git", "my-digit"));
}

#[test]
fn smart_case() {
    assert!(fuzzy_match("mdn", "MDN Web Docs").is_some());
    assert!(fuzzy_match("MDN", "mdn web docs").is_none());
    assert!(fuzzy_match("MDN", "MDN Web Docs").is_some());
}

#[test]
fn unicode_is_matched_by_character() {
    let m = fuzzy_match("öf", "Größe förmlich").unwrap();
    assert_eq!(m.positions.len(), 2);
}

#[test]
fn long_text_is_bounded() {
    let text = "a".repeat(MAX_TEXT_CHARS * 4) + "z";
    // The 'z' lies beyond the bound, so it cannot match.
    assert!(fuzzy_match("z", &text).is_none());
}

#[test]
fn fields_every_term_must_match_somewhere() {
    let fields = ["Rust std docs", "https://doc.rust-lang.org/std/"];
    let m = match_fields("std lang", &fields).unwrap();
    assert!(!m.positions[0].is_empty(), "'std' in the title");
    assert!(!m.positions[1].is_empty(), "'lang' in the URL");
    assert!(match_fields("std python", &fields).is_none());
    assert!(match_fields("", &fields).is_some());
}
