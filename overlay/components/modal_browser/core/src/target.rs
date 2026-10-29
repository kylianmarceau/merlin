//! Deciding whether `:open` input is a URL or a search.
//!
//! This is a first pass. The C++ host still canonicalises URLs with
//! `url_formatter::FixupURL` and `GURL`, re-checks the scheme, and resolves
//! searches with the omnibox's `AutocompleteClassifier`, so the user's default
//! search engine applies. Rust decides intent and rejects dangerous input
//! early; Chromium stays the authority on what a URL is.
//!
//! The same command registry will serve `browserctl` and plugins, so script
//! URLs are refused here and not only in the address bar.

use std::fmt;

/// Upper bound on accepted input, so later IPC callers cannot hand us
/// unbounded strings.
pub const MAX_TARGET_LEN: usize = 8 * 1024;

/// Schemes that run code or embed content and are never opened from a
/// command.
const BLOCKED_SCHEMES: &[&str] = &["javascript", "data", "vbscript", "blob", "filesystem"];

/// Schemes opened as given.
const ALLOWED_SCHEMES: &[&str] = &[
    "http",
    "https",
    "file",
    "about",
    "chrome",
    "chrome-extension",
    "view-source",
    "mailto",
];

/// Merlin's name for the browser's own pages. `merlin://x` is what the
/// bar and palette show for `chrome://x`; typed, it opens `chrome://x`.
pub const MERLIN_SCHEME: &str = "merlin";

/// `merlin://start` is the start page, registered as `chrome://merlin-start`.
const START_ALIAS: (&str, &str) = ("//start", "//merlin-start");

/// The real URL for what follows `merlin:`.
fn internal_url(after: &str) -> String {
    let (alias, real) = START_ALIAS;
    let start = after
        .strip_prefix(alias)
        .filter(|rest| rest.is_empty() || rest.starts_with(['/', '?', '#']));
    if let Some(rest) = start {
        return format!("chrome:{real}{rest}");
    }
    format!("chrome:{after}")
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpenTarget {
    /// Something to navigate to. Has an explicit scheme.
    Url(String),
    /// Search terms for the default search engine.
    Search(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TargetError {
    Empty,
    TooLong { len: usize },
    BlockedScheme(String),
    UnsupportedScheme(String),
    InvalidPort(String),
}

impl fmt::Display for TargetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => f.write_str("nothing to open"),
            Self::TooLong { len } => {
                write!(f, "input is {len} bytes; the limit is {MAX_TARGET_LEN}")
            }
            Self::BlockedScheme(s) => write!(f, "'{s}:' URLs cannot be opened from commands"),
            Self::UnsupportedScheme(s) => {
                write!(
                    f,
                    "unsupported scheme '{s}:' (start with '?' to search instead)"
                )
            }
            Self::InvalidPort(p) => write!(f, "invalid port '{p}'"),
        }
    }
}

impl std::error::Error for TargetError {}

/// Classifies user input as a URL or a search.
///
/// * `?terms` always searches.
/// * Input containing whitespace searches.
/// * `scheme:...` opens if the scheme is allowed, fails if blocked or unknown.
/// * `localhost`, `*.localhost`, `*.test`, IPv4 and `[IPv6]` hosts get
///   `http://`.
/// * Other dotted hostnames with a plausible top-level label get `https://`.
/// * Anything else searches.
pub fn classify(input: &str) -> Result<OpenTarget, TargetError> {
    let text = input.trim();
    if text.is_empty() {
        return Err(TargetError::Empty);
    }
    if text.len() > MAX_TARGET_LEN {
        return Err(TargetError::TooLong { len: text.len() });
    }
    if let Some(query) = text.strip_prefix('?') {
        let query = query.trim();
        if query.is_empty() {
            return Err(TargetError::Empty);
        }
        return Ok(OpenTarget::Search(query.to_string()));
    }
    if text.chars().any(char::is_whitespace) {
        return Ok(OpenTarget::Search(text.to_string()));
    }

    if let Some((scheme, after)) = split_scheme(text) {
        // `host:port` looks like a scheme to a naive parser. Real schemes in
        // use here never contain dots, so `example.com:...` is a host.
        if !port_follows(after) && !scheme.contains('.') {
            let lower = scheme.to_ascii_lowercase();
            if lower == MERLIN_SCHEME {
                return Ok(OpenTarget::Url(internal_url(after)));
            }
            if BLOCKED_SCHEMES.contains(&lower.as_str()) {
                return Err(TargetError::BlockedScheme(lower));
            }
            if ALLOWED_SCHEMES.contains(&lower.as_str()) {
                return Ok(OpenTarget::Url(format!("{lower}:{after}")));
            }
            return Err(TargetError::UnsupportedScheme(lower));
        }
    }

    let authority_end = text.find(['/', '?', '#']).unwrap_or(text.len());
    let authority = &text[..authority_end];
    if authority.contains('@') {
        // Probably an e-mail address; let the search engine handle it.
        return Ok(OpenTarget::Search(text.to_string()));
    }
    let (host, port) = split_port(authority);
    if let Some(port) = port {
        let valid = !port.is_empty()
            && port.len() <= 5
            && port.bytes().all(|b| b.is_ascii_digit())
            && port.parse::<u32>().is_ok_and(|p| p <= 65535);
        if !valid {
            return Err(TargetError::InvalidPort(port.to_string()));
        }
    }

    if is_local_host(host) || is_ipv4(host) || is_bracketed_ipv6(host) {
        return Ok(OpenTarget::Url(format!("http://{text}")));
    }
    if is_public_hostname(host) {
        return Ok(OpenTarget::Url(format!("https://{text}")));
    }
    Ok(OpenTarget::Search(text.to_string()))
}

fn split_scheme(text: &str) -> Option<(&str, &str)> {
    let colon = text.find(':')?;
    let scheme = &text[..colon];
    let mut chars = scheme.chars();
    let first = chars.next()?;
    if !first.is_ascii_alphabetic()
        || !chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return None;
    }
    Some((scheme, &text[colon + 1..]))
}

/// True if `after` (the text after the first colon) starts with a port
/// number, as in `localhost:3000/path`.
fn port_follows(after: &str) -> bool {
    let end = after.find(['/', '?', '#']).unwrap_or(after.len());
    let port = &after[..end];
    !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit())
}

fn split_port(authority: &str) -> (&str, Option<&str>) {
    if authority.starts_with('[') {
        // [::1]:8080
        if let Some(close) = authority.find(']') {
            let rest = &authority[close + 1..];
            return match rest.strip_prefix(':') {
                Some(port) => (&authority[..=close], Some(port)),
                None => (authority, None),
            };
        }
        return (authority, None);
    }
    match authority.rfind(':') {
        Some(i) => (&authority[..i], Some(&authority[i + 1..])),
        None => (authority, None),
    }
}

fn is_local_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "localhost" || host.ends_with(".localhost") || host.ends_with(".test")
}

fn is_ipv4(host: &str) -> bool {
    let parts: Vec<&str> = host.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.len() <= 3
                && p.bytes().all(|b| b.is_ascii_digit())
                && p.parse::<u16>().is_ok_and(|n| n <= 255)
        })
}

fn is_bracketed_ipv6(host: &str) -> bool {
    host.len() > 2
        && host.starts_with('[')
        && host.ends_with(']')
        && host[1..host.len() - 1]
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.')
        && host.contains(':')
}

fn is_public_hostname(host: &str) -> bool {
    let host = host.strip_suffix('.').unwrap_or(host);
    if host.len() > 253 || !host.contains('.') {
        return false;
    }
    let labels: Vec<&str> = host.split('.').collect();
    let valid_labels = labels.iter().all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.chars().all(|c| c.is_alphanumeric() || c == '-')
    });
    let tld = labels.last().copied().unwrap_or_default();
    let plausible_tld = tld.starts_with("xn--")
        || (tld.chars().count() >= 2 && tld.chars().all(char::is_alphabetic));
    valid_labels && plausible_tld
}
