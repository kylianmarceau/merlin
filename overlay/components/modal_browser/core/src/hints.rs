//! Link hints: label generation and filtering.
//!
//! The host collects clickable targets from the page (in Chrome's isolated
//! world, so page scripts cannot see or alter the collection) and reports
//! only their kinds. The core decides which targets the requested hint
//! action applies to, gives each a label, filters as the user types, and
//! says which target to activate. The host keeps the geometry and performs
//! the activation, so no page data beyond a kind per target crosses into
//! Rust.

use std::fmt;

/// Default label characters: home row first, then nearby keys, as in
/// Vimium. Easy to reach without looking.
pub const DEFAULT_HINT_CHARS: &str = "sadfjklewcmpgh";

/// Most targets the core labels. Hosts should cap collection at the same
/// number; anything beyond is ignored.
pub const MAX_HINT_TARGETS: usize = 2000;

/// What kind of element a hint target is, as classified by the host.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HintKind {
    /// An element with a navigable `href` (`<a href>`, `<area href>`).
    Link,
    /// A text input, textarea or contenteditable element.
    Editable,
    /// Anything else clickable: buttons, form controls, ARIA widgets,
    /// elements with click handlers the host could detect.
    Other,
    /// A code block (`<pre>`), collected for [`HintTargets::Code`].
    Code,
    /// A block of text (paragraph, heading, list item, cell), collected
    /// for [`HintTargets::Text`].
    Block,
}

/// Which elements the host collects for a hint request.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HintTargets {
    /// Links, buttons, fields and other clickable elements.
    Clickable,
    /// Code blocks.
    Code,
    /// Blocks of readable text.
    Text,
}

/// What happens when a hint is chosen.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HintAction {
    /// Click the element, as the user would.
    Follow,
    /// Open the link in a new background tab. Links only.
    OpenInNewTab,
    /// Copy the link's URL. Links only.
    YankLink,
    /// Focus the field so typing goes into it. Editable elements only.
    FocusInput,
    /// Focus the field and open it in the external editor.
    EditInput,
    /// Copy a code block's text.
    YankCode,
    /// Select a block of text and enter Visual mode.
    Select,
    /// Show the link in a floating preview over the page (Peek). Links only.
    Peek,
}

impl HintAction {
    pub const ALL: [(HintAction, &'static str); 8] = [
        (HintAction::Follow, "follow"),
        (HintAction::OpenInNewTab, "tab"),
        (HintAction::YankLink, "yank"),
        (HintAction::FocusInput, "input"),
        (HintAction::EditInput, "edit"),
        (HintAction::YankCode, "code"),
        (HintAction::Select, "select"),
        (HintAction::Peek, "peek"),
    ];

    pub fn from_name(name: &str) -> Option<HintAction> {
        Self::ALL.iter().find(|(_, n)| *n == name).map(|(a, _)| *a)
    }

    pub fn name(self) -> &'static str {
        Self::ALL
            .iter()
            .find(|(a, _)| *a == self)
            .map(|(_, n)| *n)
            .unwrap_or("follow")
    }

    /// Whether a target of this kind can take this action.
    pub fn applies_to(self, kind: HintKind) -> bool {
        match self {
            HintAction::Follow => {
                matches!(kind, HintKind::Link | HintKind::Editable | HintKind::Other)
            }
            HintAction::OpenInNewTab | HintAction::YankLink | HintAction::Peek => {
                kind == HintKind::Link
            }
            HintAction::FocusInput | HintAction::EditInput => kind == HintKind::Editable,
            HintAction::YankCode => kind == HintKind::Code,
            HintAction::Select => matches!(kind, HintKind::Block | HintKind::Code),
        }
    }

    /// What the host should collect for this action.
    pub fn targets(self) -> HintTargets {
        match self {
            HintAction::YankCode => HintTargets::Code,
            HintAction::Select => HintTargets::Text,
            _ => HintTargets::Clickable,
        }
    }

    /// Whether a single matching target is acted on at once, without
    /// showing a label (`gi` with one field, `yc` with one code block).
    pub fn acts_on_single_target(self) -> bool {
        matches!(
            self,
            HintAction::FocusInput | HintAction::EditInput | HintAction::YankCode
        )
    }

    /// Short description for the status line.
    pub fn describe(self) -> &'static str {
        match self {
            HintAction::Follow => "follow",
            HintAction::OpenInNewTab => "open in new tab",
            HintAction::Peek => "peek at link",
            HintAction::YankLink => "copy link",
            HintAction::FocusInput => "focus field",
            HintAction::EditInput => "edit field in editor",
            HintAction::YankCode => "copy code block",
            HintAction::Select => "select text",
        }
    }
}

/// A validated set of label characters.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HintAlphabet(Vec<char>);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HintAlphabetError {
    TooShort,
    TooLong,
    Duplicate(char),
    Invalid(char),
}

impl fmt::Display for HintAlphabetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooShort => f.write_str("hint characters need at least 2 distinct characters"),
            Self::TooLong => f.write_str("hint characters are limited to 36"),
            Self::Duplicate(c) => write!(f, "hint character '{c}' appears twice"),
            Self::Invalid(c) => write!(
                f,
                "hint character {c:?} is not allowed (use lowercase letters, digits or punctuation)"
            ),
        }
    }
}

impl std::error::Error for HintAlphabetError {}

impl HintAlphabet {
    pub fn new(chars: &str) -> Result<Self, HintAlphabetError> {
        let mut out: Vec<char> = Vec::new();
        for c in chars.chars() {
            // Uppercase is reserved (Shift may mean something later) and
            // whitespace or control characters cannot be typed as labels.
            if c.is_whitespace() || c.is_control() || c.is_uppercase() {
                return Err(HintAlphabetError::Invalid(c));
            }
            if out.contains(&c) {
                return Err(HintAlphabetError::Duplicate(c));
            }
            out.push(c);
        }
        match out.len() {
            0 | 1 => Err(HintAlphabetError::TooShort),
            n if n > 36 => Err(HintAlphabetError::TooLong),
            _ => Ok(Self(out)),
        }
    }

    pub fn chars(&self) -> &[char] {
        &self.0
    }

    pub fn contains(&self, c: char) -> bool {
        self.0.contains(&c)
    }
}

impl Default for HintAlphabet {
    fn default() -> Self {
        Self::new(DEFAULT_HINT_CHARS).expect("default hint characters are valid")
    }
}

impl fmt::Display for HintAlphabet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for c in &self.0 {
            write!(f, "{c}")?;
        }
        Ok(())
    }
}

/// Generates `count` labels, none a prefix of another, as short as
/// possible. Uses Vimium's construction: grow a tree breadth-first by
/// prepending characters until enough leaves exist, then reverse each leaf
/// so the first typed character spreads targets evenly.
pub fn generate_labels(count: usize, alphabet: &HintAlphabet) -> Vec<String> {
    if count == 0 {
        return Vec::new();
    }
    let chars = alphabet.chars();
    let mut nodes: Vec<String> = vec![String::new()];
    let mut offset = 0;
    while nodes.len() - offset < count || nodes.len() == 1 {
        let node = nodes[offset].clone();
        offset += 1;
        for c in chars {
            let mut child = String::with_capacity(node.len() + c.len_utf8());
            child.push(*c);
            child.push_str(&node);
            nodes.push(child);
        }
    }
    let mut labels: Vec<String> = nodes[offset..offset + count].to_vec();
    // Sort by position in the alphabet (not code point) so the first targets
    // get the easiest characters, while labels sharing a first typed
    // character stay spread across the page.
    let rank = |c: char| chars.iter().position(|&x| x == c).unwrap_or(usize::MAX);
    labels.sort_by_cached_key(|l| l.chars().map(rank).collect::<Vec<_>>());
    labels
        .into_iter()
        .map(|l| l.chars().rev().collect())
        .collect()
}

/// One labelled target. `target` indexes the host's collected list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hint {
    pub target: u32,
    pub label: String,
}

/// Result of typing a character in Hint mode.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HintStep {
    /// Some labels still match; show only those.
    Narrowed,
    /// Exactly one label matches what was typed in full.
    Chosen(Hint),
    /// No label starts with that; the character was not accepted.
    Rejected,
}

/// Hints currently shown for one request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HintSet {
    pub action: HintAction,
    pub hints: Vec<Hint>,
    typed: String,
}

impl HintSet {
    /// Labels the targets the action applies to, in the host's order.
    pub fn new(action: HintAction, kinds: &[HintKind], alphabet: &HintAlphabet) -> Self {
        let targets: Vec<u32> = kinds
            .iter()
            .take(MAX_HINT_TARGETS)
            .enumerate()
            .filter(|(_, k)| action.applies_to(**k))
            .map(|(i, _)| i as u32)
            .collect();
        let labels = generate_labels(targets.len(), alphabet);
        Self {
            action,
            hints: targets
                .into_iter()
                .zip(labels)
                .map(|(target, label)| Hint { target, label })
                .collect(),
            typed: String::new(),
        }
    }

    pub fn typed(&self) -> &str {
        &self.typed
    }

    pub fn is_empty(&self) -> bool {
        self.hints.is_empty()
    }

    /// Hints whose label starts with what has been typed.
    pub fn visible(&self) -> impl Iterator<Item = &Hint> {
        self.hints
            .iter()
            .filter(|h| h.label.starts_with(self.typed.as_str()))
    }

    pub fn push(&mut self, c: char) -> HintStep {
        let c = c.to_lowercase().next().unwrap_or(c);
        let mut candidate = self.typed.clone();
        candidate.push(c);
        let mut matching = self
            .hints
            .iter()
            .filter(|h| h.label.starts_with(candidate.as_str()));
        let Some(first) = matching.next() else {
            return HintStep::Rejected;
        };
        // Labels are prefix-free, so a full match is the only match.
        if first.label == candidate {
            let chosen = first.clone();
            self.typed = candidate;
            return HintStep::Chosen(chosen);
        }
        self.typed = candidate;
        HintStep::Narrowed
    }

    /// Removes the last typed character. Returns false if nothing was typed.
    pub fn pop(&mut self) -> bool {
        self.typed.pop().is_some()
    }
}
