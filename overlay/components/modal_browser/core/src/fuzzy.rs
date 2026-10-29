//! Fuzzy matching for the palette (tabs, commands, completions).
//!
//! The pattern's characters must appear in order in the text. Among all
//! alignments the best-scoring one is chosen with a small dynamic program,
//! in the spirit of fzf: matches at word starts and runs of consecutive
//! characters score higher, gaps cost a little. Smart case: an all-lowercase
//! pattern matches case-insensitively, any uppercase makes it exact.
//!
//! Inputs are bounded (pattern 64 chars, text 512 chars) so a hostile page
//! title cannot make ranking expensive.

/// Longest pattern considered, in characters.
pub const MAX_PATTERN_CHARS: usize = 64;
/// Longest text considered, in characters. The rest is ignored.
pub const MAX_TEXT_CHARS: usize = 512;

const SCORE_MATCH: i32 = 16;
const BONUS_START: i32 = 10;
const BONUS_BOUNDARY: i32 = 9;
const BONUS_CAMEL: i32 = 7;
const BONUS_CONSECUTIVE: i32 = 5;
const PENALTY_GAP_OPEN: i32 = 3;
const PENALTY_GAP_EXTEND: i32 = 1;
const NONE: i32 = i32::MIN / 2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FuzzyMatch {
    pub score: i32,
    /// Character indices (not bytes) of matched characters in the text.
    pub positions: Vec<usize>,
}

fn is_separator(c: char) -> bool {
    c.is_whitespace() || matches!(c, '/' | '-' | '_' | '.' | ':' | '#' | '?' | '&' | '=' | '|')
}

fn bonus(prev: Option<char>, cur: char) -> i32 {
    match prev {
        None => BONUS_START,
        Some(p) if is_separator(p) => BONUS_BOUNDARY,
        Some(p) if p.is_lowercase() && cur.is_uppercase() => BONUS_CAMEL,
        Some(p) if !p.is_alphanumeric() && cur.is_alphanumeric() => BONUS_BOUNDARY,
        _ => 0,
    }
}

fn fold(c: char, case_sensitive: bool) -> char {
    if case_sensitive {
        c
    } else {
        c.to_lowercase().next().unwrap_or(c)
    }
}

/// Matches one pattern (no whitespace handling) against `text`.
pub fn fuzzy_match(pattern: &str, text: &str) -> Option<FuzzyMatch> {
    let pattern: Vec<char> = pattern.chars().take(MAX_PATTERN_CHARS).collect();
    if pattern.is_empty() {
        return Some(FuzzyMatch {
            score: 0,
            positions: Vec::new(),
        });
    }
    let text: Vec<char> = text.chars().take(MAX_TEXT_CHARS).collect();
    let (m, n) = (pattern.len(), text.len());
    if m > n {
        return None;
    }
    let case_sensitive = pattern.iter().any(|c| c.is_uppercase());
    let p: Vec<char> = pattern.iter().map(|&c| fold(c, case_sensitive)).collect();
    let t: Vec<char> = text.iter().map(|&c| fold(c, case_sensitive)).collect();

    // Quick reject: the pattern must be a subsequence at all.
    {
        let mut it = t.iter();
        if !p.iter().all(|pc| it.any(|tc| tc == pc)) {
            return None;
        }
    }

    let bonuses: Vec<i32> = (0..n)
        .map(|j| bonus(j.checked_sub(1).map(|k| text[k]), text[j]))
        .collect();

    // score[i][j]: best score with p[i] matched at t[j]; back[i][j]: where
    // p[i-1] was matched.
    let mut score = vec![NONE; m * n];
    let mut back = vec![usize::MAX; m * n];
    // Bonus of the character that started the current run of consecutive
    // matches. As in fzf, every character of a run earns at least that, so
    // "docs" for "doc" beats "d-o-c" even though each of the latter's
    // characters starts a word.
    let mut run_bonus = vec![0; m * n];
    for j in 0..n {
        if t[j] == p[0] {
            score[j] = SCORE_MATCH + bonuses[j];
            run_bonus[j] = bonuses[j];
        }
    }
    for i in 1..m {
        // Best of row i-1 ending at least two columns back, with the gap
        // penalty already applied for the current column.
        let mut gap_best = NONE;
        let mut gap_from = usize::MAX;
        for j in 1..n {
            if j >= 2 {
                let entering = score[(i - 1) * n + j - 2];
                let extended = gap_best.saturating_sub(PENALTY_GAP_EXTEND);
                if entering != NONE && entering - PENALTY_GAP_OPEN >= extended {
                    gap_best = entering - PENALTY_GAP_OPEN;
                    gap_from = j - 2;
                } else {
                    gap_best = extended;
                }
            }
            if t[j] != p[i] {
                continue;
            }
            let adjacent = score[(i - 1) * n + j - 1];
            let mut best = NONE;
            let mut from = usize::MAX;
            let mut run = bonuses[j];
            if adjacent != NONE {
                let inherited = run_bonus[(i - 1) * n + j - 1];
                let char_bonus = bonuses[j].max(inherited).max(BONUS_CONSECUTIVE);
                best = adjacent + char_bonus;
                from = j - 1;
                run = inherited.max(bonuses[j]);
            }
            if gap_best > NONE / 2 && gap_best + bonuses[j] > best {
                best = gap_best + bonuses[j];
                from = gap_from;
                run = bonuses[j];
            }
            if from != usize::MAX {
                score[i * n + j] = best + SCORE_MATCH;
                back[i * n + j] = from;
                run_bonus[i * n + j] = run;
            }
        }
    }

    let last = (m - 1) * n;
    let (end, &best) = score[last..last + n]
        .iter()
        .enumerate()
        .filter(|(_, s)| **s != NONE)
        .max_by_key(|(j, s)| (**s, std::cmp::Reverse(*j)))?;
    let mut positions = vec![0; m];
    let mut j = end;
    for i in (0..m).rev() {
        positions[i] = j;
        if i > 0 {
            j = back[i * n + j];
        }
    }
    Some(FuzzyMatch {
        score: best,
        positions,
    })
}

/// Result of matching a whitespace-separated query against several fields
/// of one item (for a tab: title and URL).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FieldsMatch {
    pub score: i32,
    /// Matched character indices per field.
    pub positions: Vec<Vec<usize>>,
}

/// Every term of `query` must match at least one field; each term counts
/// toward the field where it scores best. Earlier fields win ties, so a
/// title match beats a URL match of the same quality.
pub fn match_fields(query: &str, fields: &[&str]) -> Option<FieldsMatch> {
    let mut positions = vec![Vec::new(); fields.len()];
    let mut score = 0;
    for term in query.split_whitespace() {
        let (field, m) = fields
            .iter()
            .enumerate()
            .filter_map(|(i, f)| fuzzy_match(term, f).map(|m| (i, m)))
            .max_by_key(|(i, m)| (m.score, std::cmp::Reverse(*i)))?;
        score += m.score;
        positions[field].extend(m.positions);
    }
    for p in &mut positions {
        p.sort_unstable();
        p.dedup();
    }
    Some(FieldsMatch { score, positions })
}
