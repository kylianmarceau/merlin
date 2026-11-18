//! Keys and key sequences.
//!
//! Notation follows Vim. Printable characters are written as themselves
//! (`j`, `G`, `:`). Special and modified keys use angle brackets:
//! `<Esc>`, `<CR>`, `<C-d>`, `<S-Esc>`, `<D-l>`. `D-` is the macOS Command
//! key, `A-`/`M-` is Option/Alt, `C-` is Control and `S-` is Shift.
//!
//! Normalisation rule: for a printable character pressed without Control or
//! Command, Shift is already part of the character (`G`, `:`), so the Shift
//! flag is dropped. With Control or Command held, an uppercase ASCII letter is
//! stored as its lowercase form plus Shift, so `<C-D>` and `<C-S-d>` are the
//! same key and `<C-d>` is a different one.

use std::fmt;

/// Modifier keys held during a key press.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Modifiers(u8);

impl Modifiers {
    pub const NONE: Self = Self(0);
    pub const SHIFT: Self = Self(1);
    pub const CTRL: Self = Self(1 << 1);
    pub const ALT: Self = Self(1 << 2);
    /// The Command key on macOS.
    pub const META: Self = Self(1 << 3);

    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    pub const fn union(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }

    pub const fn without(self, other: Self) -> Self {
        Self(self.0 & !other.0)
    }

    /// Builds modifiers from individual flags, the shape hosts usually have.
    pub const fn from_flags(shift: bool, ctrl: bool, alt: bool, meta: bool) -> Self {
        let mut m = 0;
        if shift {
            m |= Self::SHIFT.0;
        }
        if ctrl {
            m |= Self::CTRL.0;
        }
        if alt {
            m |= Self::ALT.0;
        }
        if meta {
            m |= Self::META.0;
        }
        Self(m)
    }
}

impl std::ops::BitOr for Modifiers {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self {
        self.union(rhs)
    }
}

/// The key itself, independent of modifiers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum KeyCode {
    /// A printable character as produced by the active keyboard layout.
    Char(char),
    Escape,
    Enter,
    Tab,
    Backspace,
    Delete,
    Up,
    Down,
    Left,
    Right,
    Home,
    End,
    PageUp,
    PageDown,
    Insert,
    /// Function key F1..=F24.
    F(u8),
}

/// A single key press: a key plus normalised modifiers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Key {
    code: KeyCode,
    mods: Modifiers,
}

impl Key {
    /// Creates a key, applying the normalisation rule described in the module
    /// docs.
    pub fn new(code: KeyCode, mods: Modifiers) -> Self {
        let mut code = code;
        let mut mods = mods;
        if let KeyCode::Char(c) = code {
            let chorded = mods.contains(Modifiers::CTRL) || mods.contains(Modifiers::META);
            if !chorded {
                if c != ' ' {
                    mods = mods.without(Modifiers::SHIFT);
                }
            } else if c.is_ascii_uppercase() {
                code = KeyCode::Char(c.to_ascii_lowercase());
                mods = mods.union(Modifiers::SHIFT);
            }
        }
        Self { code, mods }
    }

    /// A printable character with no modifiers.
    pub fn char(c: char) -> Self {
        Self::new(KeyCode::Char(c), Modifiers::NONE)
    }

    pub fn plain(code: KeyCode) -> Self {
        Self::new(code, Modifiers::NONE)
    }

    pub fn code(&self) -> KeyCode {
        self.code
    }

    pub fn mods(&self) -> Modifiers {
        self.mods
    }

    pub fn is_escape(&self) -> bool {
        self.code == KeyCode::Escape && self.mods.is_empty()
    }

    /// The decimal digit this key types, if it is an unmodified digit.
    pub fn digit(&self) -> Option<u32> {
        match self.code {
            KeyCode::Char(c) if self.mods.is_empty() => c.to_digit(10),
            _ => None,
        }
    }

    /// The character this key types without any chord modifier, used for
    /// free text entry such as hint labels.
    pub fn typed_char(&self) -> Option<char> {
        match self.code {
            KeyCode::Char(c)
                if !self.mods.contains(Modifiers::CTRL) && !self.mods.contains(Modifiers::META) =>
            {
                Some(c)
            }
            _ => None,
        }
    }

    /// Converts a DOM `KeyboardEvent.key` value (as Chromium reports it via
    /// `ui::KeycodeConverter::DomKeyToKeyString`) into a key.
    ///
    /// Returns `None` for keys the modal layer must never consume: lone
    /// modifiers, dead keys used to compose accented characters, IME
    /// `Process` events and anything unidentified. The host forwards those
    /// to the page untouched.
    pub fn from_dom_key(key: &str, mods: Modifiers) -> Option<Self> {
        let code = match key {
            "Escape" => KeyCode::Escape,
            "Enter" => KeyCode::Enter,
            "Tab" => KeyCode::Tab,
            "Backspace" => KeyCode::Backspace,
            "Delete" => KeyCode::Delete,
            "ArrowUp" => KeyCode::Up,
            "ArrowDown" => KeyCode::Down,
            "ArrowLeft" => KeyCode::Left,
            "ArrowRight" => KeyCode::Right,
            "Home" => KeyCode::Home,
            "End" => KeyCode::End,
            "PageUp" => KeyCode::PageUp,
            "PageDown" => KeyCode::PageDown,
            "Insert" => KeyCode::Insert,
            _ => {
                if let Some(n) = parse_function_key(key) {
                    KeyCode::F(n)
                } else {
                    let mut chars = key.chars();
                    match (chars.next(), chars.next()) {
                        // Exactly one character. Multi-character values are
                        // named keys we do not handle ("Shift", "Dead",
                        // "Process", "Unidentified", "AudioVolumeUp", ...).
                        (Some(c), None) if !c.is_control() => KeyCode::Char(c),
                        _ => return None,
                    }
                }
            }
        };
        Some(Self::new(code, mods))
    }
}

fn parse_function_key(name: &str) -> Option<u8> {
    let digits = name.strip_prefix('F').or_else(|| name.strip_prefix('f'))?;
    if digits.is_empty() || digits.len() > 2 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n: u8 = digits.parse().ok()?;
    (1..=24).contains(&n).then_some(n)
}

impl fmt::Display for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name: String = match self.code {
            KeyCode::Char(' ') => "Space".into(),
            KeyCode::Char('<') => "lt".into(),
            KeyCode::Char(c) => c.to_string(),
            KeyCode::Escape => "Esc".into(),
            KeyCode::Enter => "CR".into(),
            KeyCode::Tab => "Tab".into(),
            KeyCode::Backspace => "BS".into(),
            KeyCode::Delete => "Del".into(),
            KeyCode::Up => "Up".into(),
            KeyCode::Down => "Down".into(),
            KeyCode::Left => "Left".into(),
            KeyCode::Right => "Right".into(),
            KeyCode::Home => "Home".into(),
            KeyCode::End => "End".into(),
            KeyCode::PageUp => "PageUp".into(),
            KeyCode::PageDown => "PageDown".into(),
            KeyCode::Insert => "Insert".into(),
            KeyCode::F(n) => format!("F{n}"),
        };
        let bare_char = matches!(self.code, KeyCode::Char(c) if c != ' ' && c != '<');
        if bare_char && self.mods.is_empty() {
            return f.write_str(&name);
        }
        f.write_str("<")?;
        for (flag, prefix) in [
            (Modifiers::CTRL, "C-"),
            (Modifiers::ALT, "A-"),
            (Modifiers::META, "D-"),
            (Modifiers::SHIFT, "S-"),
        ] {
            if self.mods.contains(flag) {
                f.write_str(prefix)?;
            }
        }
        write!(f, "{name}>")
    }
}

/// Errors produced while parsing key notation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KeyParseError {
    Empty,
    /// A `<` with no matching `>`; holds the byte offset of the `<`.
    Unterminated(usize),
    UnknownKey(String),
    UnknownModifier(String),
    DuplicateModifier(String),
}

impl fmt::Display for KeyParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => f.write_str("empty key sequence"),
            Self::Unterminated(at) => write!(f, "unterminated '<' at offset {at}"),
            Self::UnknownKey(k) => write!(f, "unknown key name '{k}'"),
            Self::UnknownModifier(m) => write!(f, "unknown modifier '{m}-'"),
            Self::DuplicateModifier(m) => write!(f, "modifier '{m}-' given twice"),
        }
    }
}

impl std::error::Error for KeyParseError {}

/// An ordered sequence of keys, such as `gg` or `<C-w>v`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct KeySequence(Vec<Key>);

impl KeySequence {
    pub fn new(keys: Vec<Key>) -> Self {
        Self(keys)
    }

    /// Parses Vim-style key notation.
    pub fn parse(notation: &str) -> Result<Self, KeyParseError> {
        if notation.is_empty() {
            return Err(KeyParseError::Empty);
        }
        let mut keys = Vec::new();
        let mut rest = notation;
        let mut offset = 0;
        while let Some(c) = rest.chars().next() {
            if c == '<' {
                // A lone '<' with no closing bracket is an error rather than a
                // literal; write `<lt>` for the character.
                let close = rest.find('>').ok_or(KeyParseError::Unterminated(offset))?;
                // `<C->>` style: the key name itself is '>'. Only when the
                // brackets so far hold nothing but modifiers: `<C-->>` is
                // Control-minus, then '>'.
                let close = if rest[close + 1..].starts_with('>') && only_modifiers(&rest[1..close])
                {
                    close + 1
                } else {
                    close
                };
                keys.push(parse_bracketed(&rest[1..close])?);
                offset += close + 1;
                rest = &rest[close + 1..];
            } else {
                keys.push(Key::char(c));
                offset += c.len_utf8();
                rest = &rest[c.len_utf8()..];
            }
        }
        Ok(Self(keys))
    }

    pub fn keys(&self) -> &[Key] {
        &self.0
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl From<Vec<Key>> for KeySequence {
    fn from(keys: Vec<Key>) -> Self {
        Self(keys)
    }
}

impl fmt::Display for KeySequence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for key in &self.0 {
            write!(f, "{key}")?;
        }
        Ok(())
    }
}

/// `C-`, `C-S-` and so on: modifier prefixes with no key after them.
fn only_modifiers(text: &str) -> bool {
    let bytes = text.as_bytes();
    !bytes.is_empty()
        && bytes.len().is_multiple_of(2)
        && bytes.chunks(2).all(|pair| {
            matches!(
                pair[0].to_ascii_uppercase(),
                b'C' | b'S' | b'A' | b'M' | b'D'
            ) && pair[1] == b'-'
        })
}

fn parse_bracketed(inner: &str) -> Result<Key, KeyParseError> {
    if inner.is_empty() {
        return Err(KeyParseError::UnknownKey(String::new()));
    }
    let mut mods = Modifiers::NONE;
    let mut rest = inner;
    // Consume `X-` prefixes while something remains after the dash.
    loop {
        let mut chars = rest.chars();
        let (Some(m), Some('-')) = (chars.next(), chars.next()) else {
            break;
        };
        let after = &rest[m.len_utf8() + 1..];
        if after.is_empty() {
            break; // `<C-->` style: the key is '-' handled below.
        }
        let flag = match m.to_ascii_uppercase() {
            'C' => Modifiers::CTRL,
            'S' => Modifiers::SHIFT,
            'A' | 'M' => Modifiers::ALT,
            'D' => Modifiers::META,
            _ => return Err(KeyParseError::UnknownModifier(m.to_string())),
        };
        if mods.contains(flag) {
            return Err(KeyParseError::DuplicateModifier(m.to_string()));
        }
        mods = mods.union(flag);
        rest = after;
    }

    let code = named_key(rest)
        .or_else(|| {
            let mut chars = rest.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Some(KeyCode::Char(c)),
                _ => None,
            }
        })
        .ok_or_else(|| KeyParseError::UnknownKey(rest.to_string()))?;

    // `<S-a>` means `A`: apply Shift to the character when it is the only
    // modifier, so the result matches what the host reports for that press.
    let code = match code {
        KeyCode::Char(c)
            if mods.contains(Modifiers::SHIFT)
                && !mods.contains(Modifiers::CTRL)
                && !mods.contains(Modifiers::META) =>
        {
            KeyCode::Char(c.to_uppercase().next().unwrap_or(c))
        }
        other => other,
    };
    Ok(Key::new(code, mods))
}

fn named_key(name: &str) -> Option<KeyCode> {
    let lower = name.to_ascii_lowercase();
    Some(match lower.as_str() {
        "esc" | "escape" => KeyCode::Escape,
        "cr" | "enter" | "return" => KeyCode::Enter,
        "tab" => KeyCode::Tab,
        "bs" | "backspace" => KeyCode::Backspace,
        "del" | "delete" => KeyCode::Delete,
        "space" => KeyCode::Char(' '),
        "lt" => KeyCode::Char('<'),
        "gt" => KeyCode::Char('>'),
        "bar" => KeyCode::Char('|'),
        "bslash" => KeyCode::Char('\\'),
        "up" => KeyCode::Up,
        "down" => KeyCode::Down,
        "left" => KeyCode::Left,
        "right" => KeyCode::Right,
        "home" => KeyCode::Home,
        "end" => KeyCode::End,
        "pageup" => KeyCode::PageUp,
        "pagedown" => KeyCode::PageDown,
        "insert" => KeyCode::Insert,
        _ => return parse_function_key(name).map(KeyCode::F),
    })
}
