//! The parser properties the fuzz targets check: on any input, each parser
//! returns instead of panicking (a panic here runs in the browser process
//! and takes the whole browser down), and what it accepts survives being
//! written out and read again.
//!
//! Shared by `tests/parsers.rs`, which runs them on stable over seeds and
//! mutations in every `cargo test`, and by the `cargo-fuzz` targets in
//! `fuzz/` (included there with `#[path]`), which run them for longer.

use modal_browser_core::{OpenTarget, ipc, json, key::KeySequence, target, toml_lite};

/// `json::parse`; an accepted document reads back the same, compact or
/// indented.
pub fn json(text: &str) {
    let Ok(value) = json::parse(text) else { return };
    for written in [value.to_json(), value.to_json_pretty()] {
        if written.len() > json::MAX_INPUT_LEN {
            continue;
        }
        assert_eq!(
            json::parse(&written).as_ref(),
            Ok(&value),
            "{text:?} was written as {written:?}"
        );
    }
}

/// `toml_lite::parse`; an accepted file, written back as one dotted key per
/// line, means the same: the same values at the same paths.
pub fn toml(text: &str) {
    let Ok(entries) = toml_lite::parse(text) else {
        return;
    };
    let written: String = entries
        .iter()
        .map(|e| {
            let path: Vec<String> = e.path.iter().map(|k| toml_string(k)).collect();
            format!("{} = {}\n", path.join("."), toml_value(&e.value))
        })
        .collect();
    if written.len() > toml_lite::MAX_INPUT_LEN {
        return;
    }
    let again = toml_lite::parse(&written)
        .unwrap_or_else(|e| panic!("{text:?} was written as {written:?}, which fails: {e}"));
    let meaning = |entries: &[toml_lite::Entry]| {
        entries
            .iter()
            .map(|e| (e.path.clone(), e.value.clone()))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        meaning(&again),
        meaning(&entries),
        "{text:?} was written as {written:?}"
    );
}

fn toml_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if c.is_control() => out.push_str(&format!("\\U{:08X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn toml_value(v: &toml_lite::Value) -> String {
    match v {
        toml_lite::Value::String(s) => toml_string(s),
        toml_lite::Value::Integer(n) => n.to_string(),
        toml_lite::Value::Boolean(b) => b.to_string(),
        toml_lite::Value::Array(items) => {
            let items: Vec<String> = items.iter().map(toml_value).collect();
            format!("[{}]", items.join(", "))
        }
    }
}

/// `ipc::parse_request` and `ipc::parse_reply`; an accepted request, encoded
/// again, parses to the same request.
pub fn ipc(line: &str) {
    let _ = ipc::parse_reply(line);
    let Ok(envelope) = ipc::parse_request(line) else {
        return;
    };
    let id = envelope.id.unwrap_or(0);
    let written = ipc::encode_request(id, &envelope.request);
    if written.len() > ipc::MAX_REQUEST_LEN {
        return;
    }
    let again = ipc::parse_request(&written)
        .unwrap_or_else(|e| panic!("{line:?} was encoded as {written:?}, which fails: {e}"));
    assert_eq!(again.id, Some(id), "{line:?} was encoded as {written:?}");
    assert_eq!(
        again.request, envelope.request,
        "{line:?} was encoded as {written:?}"
    );
}

/// `KeySequence::parse`; an accepted sequence, written in key notation,
/// parses to the same keys.
pub fn keys(notation: &str) {
    let Ok(sequence) = KeySequence::parse(notation) else {
        return;
    };
    let written = sequence.to_string();
    assert_eq!(
        KeySequence::parse(&written).as_ref(),
        Ok(&sequence),
        "{notation:?} was written as {written:?}"
    );
}

/// `target::classify`; a URL it produces classifies as itself, and search
/// terms it produces, forced with `?`, search for the same terms.
pub fn target(input: &str) {
    match target::classify(input) {
        Ok(OpenTarget::Url(url)) => assert_eq!(
            target::classify(&url),
            Ok(OpenTarget::Url(url.clone())),
            "{input:?} became {url:?}"
        ),
        Ok(OpenTarget::Search(terms)) => assert_eq!(
            target::classify(&format!("? {terms}")),
            Ok(OpenTarget::Search(terms.clone())),
            "{input:?} searched for {terms:?}"
        ),
        Err(_) => {}
    }
}

/// Every property, for a fuzz target or test that has only bytes.
pub fn all(data: &[u8]) {
    let text = String::from_utf8_lossy(data);
    json(&text);
    toml(&text);
    ipc(&text);
    keys(&text);
    target(&text);
}
