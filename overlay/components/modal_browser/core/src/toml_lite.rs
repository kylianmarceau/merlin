//! A strict parser for the subset of TOML the configuration file uses.
//!
//! No TOML crate is vendored in Chromium at our pinned version, and the core
//! has no third-party dependencies (each `//third_party` import is more
//! patch to carry on every rebase).
//! This parser accepts a well-defined subset and rejects everything else
//! with a line number, so any file it accepts means the same thing to a
//! full TOML parser. Moving to the real `toml` crate later is therefore not
//! a breaking change for users.
//!
//! Supported: comments, `[table]` and `[dotted.table]` headers, bare,
//! quoted and dotted keys, basic strings (with escapes) and literal
//! strings, integers (with `_` separators), booleans, and arrays of those
//! (spanning lines, trailing comma allowed). Duplicate keys and tables are
//! errors, as in TOML.
//!
//! Not supported (clear error): multi-line strings, floats, dates, inline
//! tables, arrays of tables.

use std::collections::BTreeSet;
use std::fmt;

/// Upper bound on input size. Configuration files are small; this keeps a
/// mistaken path (a log file, a binary) from costing much.
pub const MAX_INPUT_LEN: usize = 256 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    String(String),
    Integer(i64),
    Boolean(bool),
    Array(Vec<Value>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::String(_) => "string",
            Value::Integer(_) => "integer",
            Value::Boolean(_) => "boolean",
            Value::Array(_) => "array",
        }
    }
}

/// One `key = value` with its full path (table path + key path).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub path: Vec<String>,
    pub value: Value,
    /// 1-based line of the key.
    pub line: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseError {
    pub line: usize,
    pub message: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "line {}: {}", self.line, self.message)
    }
}

impl std::error::Error for ParseError {}

struct Parser<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
    line: usize,
}

type Result<T> = std::result::Result<T, ParseError>;

impl Parser<'_> {
    fn error<T>(&self, message: impl Into<String>) -> Result<T> {
        Err(ParseError {
            line: self.line,
            message: message.into(),
        })
    }

    fn peek(&mut self) -> Option<char> {
        self.chars.peek().copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.chars.next();
        if c == Some('\n') {
            self.line += 1;
        }
        c
    }

    fn eat(&mut self, c: char) -> bool {
        if self.peek() == Some(c) {
            self.bump();
            true
        } else {
            false
        }
    }

    /// Spaces and tabs only.
    fn skip_inline_ws(&mut self) {
        while matches!(self.peek(), Some(' ' | '\t')) {
            self.bump();
        }
    }

    fn skip_comment(&mut self) {
        if self.peek() == Some('#') {
            while !matches!(self.peek(), None | Some('\n')) {
                self.bump();
            }
        }
    }

    /// Whitespace, newlines and comments (inside arrays and between lines).
    fn skip_ws_newlines_comments(&mut self) {
        loop {
            match self.peek() {
                Some(' ' | '\t' | '\n' | '\r') => {
                    self.bump();
                }
                Some('#') => self.skip_comment(),
                _ => return,
            }
        }
    }

    /// After a value or header: optional spaces, optional comment, then a
    /// newline or the end.
    fn end_of_line(&mut self) -> Result<()> {
        self.skip_inline_ws();
        self.skip_comment();
        match self.peek() {
            None => Ok(()),
            Some('\n') => {
                self.bump();
                Ok(())
            }
            Some('\r') => {
                self.bump();
                if self.eat('\n') {
                    Ok(())
                } else {
                    self.error("stray carriage return")
                }
            }
            Some(c) => self.error(format!("unexpected {c:?} after value")),
        }
    }

    fn key_part(&mut self) -> Result<String> {
        match self.peek() {
            Some('"') => {
                self.bump();
                self.basic_string_body()
            }
            Some('\'') => {
                self.bump();
                self.literal_string_body()
            }
            Some(c) if is_bare_key_char(c) => {
                let mut key = String::new();
                while let Some(c) = self.peek().filter(|c| is_bare_key_char(*c)) {
                    key.push(c);
                    self.bump();
                }
                Ok(key)
            }
            Some(c) => self.error(format!("expected a key, found {c:?}")),
            None => self.error("expected a key, found end of file"),
        }
    }

    /// `a`, `"a b"`, `a.b."c"`.
    fn dotted_key(&mut self) -> Result<Vec<String>> {
        let mut parts = vec![self.key_part()?];
        loop {
            self.skip_inline_ws();
            if !self.eat('.') {
                return Ok(parts);
            }
            self.skip_inline_ws();
            parts.push(self.key_part()?);
        }
    }

    fn basic_string_body(&mut self) -> Result<String> {
        let mut out = String::new();
        loop {
            match self.bump() {
                None | Some('\n') => return self.error("unterminated string"),
                Some('"') => return Ok(out),
                Some('\\') => {
                    let c = match self.bump() {
                        Some('b') => '\u{8}',
                        Some('t') => '\t',
                        Some('n') => '\n',
                        Some('f') => '\u{c}',
                        Some('r') => '\r',
                        Some('"') => '"',
                        Some('\\') => '\\',
                        Some('u') => self.unicode_escape(4)?,
                        Some('U') => self.unicode_escape(8)?,
                        Some(c) => return self.error(format!("unknown escape '\\{c}'")),
                        None => return self.error("unterminated string"),
                    };
                    out.push(c);
                }
                Some(c) if c.is_control() && c != '\t' => {
                    return self.error("control characters must be escaped in strings");
                }
                Some(c) => out.push(c),
            }
        }
    }

    fn unicode_escape(&mut self, digits: usize) -> Result<char> {
        let mut value = 0u32;
        for _ in 0..digits {
            let Some(d) = self.bump().and_then(|c| c.to_digit(16)) else {
                return self.error("invalid unicode escape");
            };
            value = value * 16 + d;
        }
        match char::from_u32(value) {
            Some(c) => Ok(c),
            None => self.error("unicode escape is not a valid character"),
        }
    }

    fn literal_string_body(&mut self) -> Result<String> {
        let mut out = String::new();
        loop {
            match self.bump() {
                None | Some('\n') => return self.error("unterminated string"),
                Some('\'') => return Ok(out),
                Some(c) => out.push(c),
            }
        }
    }

    fn value(&mut self) -> Result<Value> {
        match self.peek() {
            Some('"') => {
                self.bump();
                if self.eat('"') {
                    if self.peek() == Some('"') {
                        return self.error("multi-line strings are not supported");
                    }
                    return Ok(Value::String(String::new()));
                }
                Ok(Value::String(self.basic_string_body()?))
            }
            Some('\'') => {
                self.bump();
                if self.eat('\'') {
                    if self.peek() == Some('\'') {
                        return self.error("multi-line strings are not supported");
                    }
                    return Ok(Value::String(String::new()));
                }
                Ok(Value::String(self.literal_string_body()?))
            }
            Some('[') => {
                self.bump();
                self.array()
            }
            Some('{') => self.error("inline tables are not supported; use a [table] header"),
            Some('t' | 'f') => {
                let word = self.word();
                match word.as_str() {
                    "true" => Ok(Value::Boolean(true)),
                    "false" => Ok(Value::Boolean(false)),
                    _ => self.error(format!("unexpected '{word}' (strings need quotes)")),
                }
            }
            Some(c) if c.is_ascii_digit() || c == '+' || c == '-' => self.integer(),
            Some(c) if c.is_alphabetic() => {
                let word = self.word();
                self.error(format!("unexpected '{word}' (strings need quotes)"))
            }
            Some(c) => self.error(format!(
                "unexpected {c:?}: expected a string, integer, boolean or array"
            )),
            None => self.error("expected a value, found end of file"),
        }
    }

    fn word(&mut self) -> String {
        let mut w = String::new();
        while let Some(c) = self
            .peek()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        {
            w.push(c);
            self.bump();
        }
        w
    }

    fn integer(&mut self) -> Result<Value> {
        let mut raw = String::new();
        while let Some(c) = self
            .peek()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '_' | '.' | ':'))
        {
            raw.push(c);
            self.bump();
        }
        if raw.contains(['.', 'e', 'E']) && !raw.contains(':') {
            return self.error("floats are not supported");
        }
        if raw.contains(':') || raw.matches('-').count() > 1 {
            return self.error("dates and times are not supported");
        }
        let digits = raw.strip_prefix('+').unwrap_or(&raw);
        let (negative, digits) = match digits.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, digits),
        };
        let valid = !digits.is_empty()
            && !digits.starts_with('_')
            && !digits.ends_with('_')
            && !digits.contains("__")
            && digits.chars().all(|c| c.is_ascii_digit() || c == '_')
            && !(digits.len() > 1 && digits.starts_with('0'));
        if !valid {
            return self.error(format!("invalid integer '{raw}'"));
        }
        let cleaned: String = digits.chars().filter(|c| *c != '_').collect();
        match cleaned.parse::<i64>() {
            Ok(v) => Ok(Value::Integer(if negative { -v } else { v })),
            Err(_) => self.error(format!("integer '{raw}' is out of range")),
        }
    }

    fn array(&mut self) -> Result<Value> {
        let mut items = Vec::new();
        loop {
            self.skip_ws_newlines_comments();
            if self.eat(']') {
                return Ok(Value::Array(items));
            }
            items.push(self.value()?);
            self.skip_ws_newlines_comments();
            if self.eat(',') {
                continue;
            }
            if self.eat(']') {
                return Ok(Value::Array(items));
            }
            return match self.peek() {
                Some(c) => self.error(format!("expected ',' or ']' in array, found {c:?}")),
                None => self.error("unterminated array"),
            };
        }
    }
}

fn is_bare_key_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

/// Parses the whole document. Stops at the first syntax error.
pub fn parse(text: &str) -> std::result::Result<Vec<Entry>, ParseError> {
    if text.len() > MAX_INPUT_LEN {
        return Err(ParseError {
            line: 1,
            message: format!("file is larger than {} KiB", MAX_INPUT_LEN / 1024),
        });
    }
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut p = Parser {
        chars: text.chars().peekable(),
        line: 1,
    };
    let mut entries = Vec::new();
    let mut table: Vec<String> = Vec::new();
    let mut seen_tables: BTreeSet<Vec<String>> = BTreeSet::new();
    let mut seen_keys: BTreeSet<Vec<String>> = BTreeSet::new();
    loop {
        p.skip_ws_newlines_comments();
        let Some(c) = p.peek() else {
            return Ok(entries);
        };
        let line = p.line;
        if c == '[' {
            p.bump();
            if p.peek() == Some('[') {
                return p.error("arrays of tables ([[...]]) are not supported");
            }
            p.skip_inline_ws();
            let path = p.dotted_key()?;
            p.skip_inline_ws();
            if !p.eat(']') {
                return p.error("expected ']' to close the table header");
            }
            p.end_of_line()?;
            if !seen_tables.insert(path.clone()) || seen_keys.contains(&path) {
                return Err(ParseError {
                    line,
                    message: format!("table [{}] is defined twice", path.join(".")),
                });
            }
            table = path;
            continue;
        }
        let key = p.dotted_key()?;
        p.skip_inline_ws();
        if !p.eat('=') {
            return p.error("expected '=' after the key");
        }
        p.skip_inline_ws();
        let value = p.value()?;
        p.end_of_line()?;
        let mut path = table.clone();
        path.extend(key);
        // A key may not repeat, and may not also be used as a table.
        let clashes_with_table = seen_tables.contains(&path);
        let is_prefix_of_existing = seen_keys
            .iter()
            .any(|k| k.len() > path.len() && k.starts_with(&path))
            || seen_keys
                .iter()
                .any(|k| path.len() > k.len() && path.starts_with(k));
        if clashes_with_table || is_prefix_of_existing || !seen_keys.insert(path.clone()) {
            return Err(ParseError {
                line,
                message: format!("key '{}' is defined twice", path.join(".")),
            });
        }
        entries.push(Entry { path, value, line });
    }
}
