//! A small, strict JSON reader and writer.
//!
//! Used for data the browser writes and reads back (workspace files) and for
//! the `browserctl` socket protocol. The core stays dependency-free (see
//! `docs/DECISIONS.md` #7), and these documents are small and simple, so a
//! bounded parser of our own is less to maintain than a vendored crate.
//!
//! Strict RFC 8259: no comments, no trailing commas, no NaN. Bounded in
//! size ([`MAX_INPUT_LEN`]) and nesting ([`MAX_DEPTH`]), so hostile input
//! from a socket peer or an edited file costs little.

use std::fmt;

/// Largest document accepted, in bytes.
pub const MAX_INPUT_LEN: usize = 4 * 1024 * 1024;
/// Deepest nesting of arrays and objects accepted.
pub const MAX_DEPTH: usize = 32;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    /// Keys in document order. Duplicate keys are rejected when parsing.
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(b) => Some(*b),
            _ => None,
        }
    }

    /// The number, if it is a whole number from 0 to 2^53.
    pub fn as_u64(&self) -> Option<u64> {
        match self {
            Value::Number(n) if *n >= 0.0 && n.fract() == 0.0 && *n <= 9_007_199_254_740_992.0 => {
                Some(*n as u64)
            }
            _ => None,
        }
    }

    /// The number, if it is a whole number within ±2^53.
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Value::Number(n) if n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_992.0 => {
                Some(*n as i64)
            }
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Value]> {
        match self {
            Value::Array(items) => Some(items),
            _ => None,
        }
    }

    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "boolean",
            Value::Number(_) => "number",
            Value::String(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    /// Builds an object from `(key, value)` pairs.
    pub fn object<K: Into<String>>(entries: impl IntoIterator<Item = (K, Value)>) -> Value {
        Value::Object(entries.into_iter().map(|(k, v)| (k.into(), v)).collect())
    }

    pub fn string(s: impl Into<String>) -> Value {
        Value::String(s.into())
    }

    /// Compact JSON on one line, which is what the socket protocol needs.
    pub fn to_json(&self) -> String {
        let mut out = String::new();
        write_value(self, &mut out, None, 0);
        out
    }

    /// Indented JSON for files people may read.
    pub fn to_json_pretty(&self) -> String {
        let mut out = String::new();
        write_value(self, &mut out, Some(2), 0);
        out.push('\n');
        out
    }
}

impl From<bool> for Value {
    fn from(b: bool) -> Self {
        Value::Bool(b)
    }
}

impl From<&str> for Value {
    fn from(s: &str) -> Self {
        Value::String(s.to_string())
    }
}

impl From<String> for Value {
    fn from(s: String) -> Self {
        Value::String(s)
    }
}

impl From<i64> for Value {
    fn from(n: i64) -> Self {
        Value::Number(n as f64)
    }
}

impl From<u32> for Value {
    fn from(n: u32) -> Self {
        Value::Number(f64::from(n))
    }
}

impl From<i32> for Value {
    fn from(n: i32) -> Self {
        Value::Number(f64::from(n))
    }
}

impl From<usize> for Value {
    fn from(n: usize) -> Self {
        Value::Number(n as f64)
    }
}

impl From<Vec<Value>> for Value {
    fn from(items: Vec<Value>) -> Self {
        Value::Array(items)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseError {
    /// Byte offset where the problem was found.
    pub offset: usize,
    pub message: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid JSON at byte {}: {}", self.offset, self.message)
    }
}

impl std::error::Error for ParseError {}

/// Parses one JSON document. Surrounding whitespace is allowed.
pub fn parse(text: &str) -> Result<Value, ParseError> {
    if text.len() > MAX_INPUT_LEN {
        return Err(ParseError {
            offset: 0,
            message: format!("document is larger than {MAX_INPUT_LEN} bytes"),
        });
    }
    let mut p = Parser {
        bytes: text.as_bytes(),
        text,
        pos: 0,
    };
    p.skip_ws();
    let value = p.value(0)?;
    p.skip_ws();
    if p.pos != p.bytes.len() {
        return Err(p.error("unexpected text after the document"));
    }
    Ok(value)
}

struct Parser<'a> {
    bytes: &'a [u8],
    text: &'a str,
    pos: usize,
}

impl Parser<'_> {
    fn error(&self, message: &str) -> ParseError {
        ParseError {
            offset: self.pos,
            message: message.to_string(),
        }
    }

    fn skip_ws(&mut self) {
        while let Some(b' ' | b'\t' | b'\n' | b'\r') = self.bytes.get(self.pos) {
            self.pos += 1;
        }
    }

    fn eat(&mut self, literal: &str) -> bool {
        if self.text[self.pos..].starts_with(literal) {
            self.pos += literal.len();
            true
        } else {
            false
        }
    }

    fn value(&mut self, depth: usize) -> Result<Value, ParseError> {
        if depth > MAX_DEPTH {
            return Err(self.error("nested too deeply"));
        }
        match self.bytes.get(self.pos) {
            None => Err(self.error("unexpected end of input")),
            Some(b'n') if self.eat("null") => Ok(Value::Null),
            Some(b't') if self.eat("true") => Ok(Value::Bool(true)),
            Some(b'f') if self.eat("false") => Ok(Value::Bool(false)),
            Some(b'"') => self.string().map(Value::String),
            Some(b'[') => self.array(depth),
            Some(b'{') => self.object(depth),
            Some(b'-' | b'0'..=b'9') => self.number(),
            Some(_) => Err(self.error("expected a value")),
        }
    }

    fn array(&mut self, depth: usize) -> Result<Value, ParseError> {
        self.pos += 1;
        let mut items = Vec::new();
        self.skip_ws();
        if self.bytes.get(self.pos) == Some(&b']') {
            self.pos += 1;
            return Ok(Value::Array(items));
        }
        loop {
            self.skip_ws();
            items.push(self.value(depth + 1)?);
            self.skip_ws();
            match self.bytes.get(self.pos) {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(Value::Array(items));
                }
                _ => return Err(self.error("expected ',' or ']'")),
            }
        }
    }

    fn object(&mut self, depth: usize) -> Result<Value, ParseError> {
        self.pos += 1;
        let mut entries: Vec<(String, Value)> = Vec::new();
        self.skip_ws();
        if self.bytes.get(self.pos) == Some(&b'}') {
            self.pos += 1;
            return Ok(Value::Object(entries));
        }
        loop {
            self.skip_ws();
            if self.bytes.get(self.pos) != Some(&b'"') {
                return Err(self.error("expected a string key"));
            }
            let key_pos = self.pos;
            let key = self.string()?;
            if entries.iter().any(|(k, _)| *k == key) {
                return Err(ParseError {
                    offset: key_pos,
                    message: format!("duplicate key '{key}'"),
                });
            }
            self.skip_ws();
            if self.bytes.get(self.pos) != Some(&b':') {
                return Err(self.error("expected ':'"));
            }
            self.pos += 1;
            self.skip_ws();
            let value = self.value(depth + 1)?;
            entries.push((key, value));
            self.skip_ws();
            match self.bytes.get(self.pos) {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(Value::Object(entries));
                }
                _ => return Err(self.error("expected ',' or '}'")),
            }
        }
    }

    fn number(&mut self) -> Result<Value, ParseError> {
        let start = self.pos;
        if self.bytes.get(self.pos) == Some(&b'-') {
            self.pos += 1;
        }
        match self.bytes.get(self.pos) {
            Some(b'0') => self.pos += 1,
            Some(b'1'..=b'9') => {
                while let Some(b'0'..=b'9') = self.bytes.get(self.pos) {
                    self.pos += 1;
                }
            }
            _ => return Err(self.error("expected a digit")),
        }
        if self.bytes.get(self.pos) == Some(&b'.') {
            self.pos += 1;
            if !matches!(self.bytes.get(self.pos), Some(b'0'..=b'9')) {
                return Err(self.error("expected a digit after '.'"));
            }
            while let Some(b'0'..=b'9') = self.bytes.get(self.pos) {
                self.pos += 1;
            }
        }
        if let Some(b'e' | b'E') = self.bytes.get(self.pos) {
            self.pos += 1;
            if let Some(b'+' | b'-') = self.bytes.get(self.pos) {
                self.pos += 1;
            }
            if !matches!(self.bytes.get(self.pos), Some(b'0'..=b'9')) {
                return Err(self.error("expected a digit in the exponent"));
            }
            while let Some(b'0'..=b'9') = self.bytes.get(self.pos) {
                self.pos += 1;
            }
        }
        let n: f64 = self.text[start..self.pos]
            .parse()
            .map_err(|_| self.error("invalid number"))?;
        if !n.is_finite() {
            return Err(self.error("number out of range"));
        }
        Ok(Value::Number(n))
    }

    fn hex4(&mut self) -> Result<u32, ParseError> {
        let digits = self
            .text
            .get(self.pos..self.pos + 4)
            .ok_or_else(|| self.error("short \\u escape"))?;
        let v = u32::from_str_radix(digits, 16).map_err(|_| self.error("invalid \\u escape"))?;
        self.pos += 4;
        Ok(v)
    }

    fn string(&mut self) -> Result<String, ParseError> {
        self.pos += 1; // opening quote
        let mut out = String::new();
        loop {
            // Copy the run up to the next quote, backslash or control char.
            let run_start = self.pos;
            while let Some(&b) = self.bytes.get(self.pos) {
                if b == b'"' || b == b'\\' || b < 0x20 {
                    break;
                }
                self.pos += 1;
            }
            out.push_str(&self.text[run_start..self.pos]);
            match self.bytes.get(self.pos) {
                None => return Err(self.error("unterminated string")),
                Some(b'"') => {
                    self.pos += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.pos += 1;
                    let Some(&esc) = self.bytes.get(self.pos) else {
                        return Err(self.error("unterminated escape"));
                    };
                    self.pos += 1;
                    match esc {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let hi = self.hex4()?;
                            let c = if (0xD800..0xDC00).contains(&hi) {
                                if !self.eat("\\u") {
                                    return Err(self.error("lone surrogate"));
                                }
                                let lo = self.hex4()?;
                                if !(0xDC00..0xE000).contains(&lo) {
                                    return Err(self.error("invalid surrogate pair"));
                                }
                                char::from_u32(0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00))
                            } else {
                                char::from_u32(hi)
                            };
                            out.push(c.ok_or_else(|| self.error("invalid code point"))?);
                        }
                        _ => return Err(self.error("invalid escape")),
                    }
                }
                Some(_) => return Err(self.error("control character in string")),
            }
        }
    }
}

fn write_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            // Line and paragraph separators are valid JSON but break
            // line-oriented readers and old JavaScript parsers.
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write_number(n: f64, out: &mut String) {
    if !n.is_finite() {
        out.push_str("null");
    } else if n.fract() == 0.0 && n.abs() < 1e15 {
        out.push_str(&format!("{}", n as i64));
    } else {
        out.push_str(&format!("{n}"));
    }
}

fn newline(out: &mut String, indent: Option<usize>, level: usize) {
    if let Some(width) = indent {
        out.push('\n');
        out.extend(std::iter::repeat_n(' ', width * level));
    }
}

fn write_value(v: &Value, out: &mut String, indent: Option<usize>, level: usize) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => write_number(*n, out),
        Value::String(s) => write_string(s, out),
        Value::Array(items) if items.is_empty() => out.push_str("[]"),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                newline(out, indent, level + 1);
                write_value(item, out, indent, level + 1);
            }
            newline(out, indent, level);
            out.push(']');
        }
        Value::Object(entries) if entries.is_empty() => out.push_str("{}"),
        Value::Object(entries) => {
            out.push('{');
            for (i, (k, item)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                newline(out, indent, level + 1);
                write_string(k, out);
                out.push(':');
                if indent.is_some() {
                    out.push(' ');
                }
                write_value(item, out, indent, level + 1);
            }
            newline(out, indent, level);
            out.push('}');
        }
    }
}
