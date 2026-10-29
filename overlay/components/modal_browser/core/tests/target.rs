use modal_browser_core::target::{MAX_TARGET_LEN, classify};
use modal_browser_core::{OpenTarget, TargetError};

fn url(s: &str) -> Result<OpenTarget, TargetError> {
    Ok(OpenTarget::Url(s.to_string()))
}

fn search(s: &str) -> Result<OpenTarget, TargetError> {
    Ok(OpenTarget::Search(s.to_string()))
}

#[test]
fn explicit_urls_pass_through() {
    assert_eq!(classify("https://docs.rs"), url("https://docs.rs"));
    assert_eq!(
        classify("  https://example.com/a?b#c  "),
        url("https://example.com/a?b#c")
    );
    assert_eq!(classify("HTTP://example.com"), url("http://example.com"));
    assert_eq!(classify("about:blank"), url("about:blank"));
    assert_eq!(classify("chrome://settings"), url("chrome://settings"));
    assert_eq!(
        classify("file:///Users/me/notes.html"),
        url("file:///Users/me/notes.html")
    );
    assert_eq!(
        classify("view-source:https://example.com"),
        url("view-source:https://example.com")
    );
}

#[test]
fn bare_hostnames_get_https() {
    assert_eq!(classify("docs.rs"), url("https://docs.rs"));
    assert_eq!(
        classify("github.com/rust-lang/rust"),
        url("https://github.com/rust-lang/rust")
    );
    assert_eq!(
        classify("developer.mozilla.org/en-US/"),
        url("https://developer.mozilla.org/en-US/")
    );
    assert_eq!(
        classify("example.com:8443/x"),
        url("https://example.com:8443/x")
    );
    assert_eq!(classify("example.com."), url("https://example.com."));
    assert_eq!(
        classify("xn--bcher-kva.example"),
        url("https://xn--bcher-kva.example")
    );
    assert_eq!(classify("例え.テスト"), url("https://例え.テスト"));
}

#[test]
fn local_hosts_get_http() {
    assert_eq!(classify("localhost"), url("http://localhost"));
    assert_eq!(classify("localhost:3000"), url("http://localhost:3000"));
    assert_eq!(
        classify("localhost:3000/api?x=1"),
        url("http://localhost:3000/api?x=1")
    );
    assert_eq!(
        classify("app.localhost:8080"),
        url("http://app.localhost:8080")
    );
    assert_eq!(classify("myproject.test"), url("http://myproject.test"));
    assert_eq!(classify("192.168.1.1"), url("http://192.168.1.1"));
    assert_eq!(classify("127.0.0.1:8000/"), url("http://127.0.0.1:8000/"));
    assert_eq!(classify("[::1]:8080"), url("http://[::1]:8080"));
}

#[test]
fn searches() {
    assert_eq!(classify("rust"), search("rust"));
    assert_eq!(classify("rust lifetimes"), search("rust lifetimes"));
    assert_eq!(classify("?docs.rs"), search("docs.rs"));
    assert_eq!(classify("? docs.rs  "), search("docs.rs"));
    assert_eq!(classify("1.5"), search("1.5"));
    assert_eq!(classify("256.1.1.1"), search("256.1.1.1"));
    assert_eq!(classify("a..b"), search("a..b"));
    assert_eq!(classify("foo_bar.com"), search("foo_bar.com"));
    assert_eq!(classify("me@example.com"), search("me@example.com"));
    assert_eq!(
        classify("what is c++: a guide"),
        search("what is c++: a guide")
    );
}

#[test]
fn dangerous_schemes_are_refused() {
    for s in [
        "javascript:alert(1)",
        "JavaScript:alert(1)",
        "data:text/html,hi",
        "vbscript:x",
        "blob:https://a/b",
        "filesystem:https://a/b",
    ] {
        assert!(
            matches!(classify(s), Err(TargetError::BlockedScheme(_))),
            "{s}"
        );
    }
}

#[test]
fn unknown_schemes_are_errors_not_guesses() {
    assert_eq!(
        classify("foo:bar"),
        Err(TargetError::UnsupportedScheme("foo".into()))
    );
    assert_eq!(
        classify("ftp://old.example"),
        Err(TargetError::UnsupportedScheme("ftp".into()))
    );
}

#[test]
fn bad_input() {
    assert_eq!(classify(""), Err(TargetError::Empty));
    assert_eq!(classify("   "), Err(TargetError::Empty));
    assert_eq!(classify("?"), Err(TargetError::Empty));
    assert_eq!(
        classify("localhost:99999"),
        Err(TargetError::InvalidPort("99999".into()))
    );
    assert_eq!(
        classify("example.com:"),
        Err(TargetError::InvalidPort(String::new()))
    );
    let long = "a".repeat(MAX_TARGET_LEN + 1);
    assert!(matches!(classify(&long), Err(TargetError::TooLong { .. })));
}

#[test]
fn merlin_pages_open_their_chrome_urls() {
    assert_eq!(classify("merlin://settings"), url("chrome://settings"));
    assert_eq!(
        classify("MERLIN://settings/passwords"),
        url("chrome://settings/passwords")
    );
    assert_eq!(classify("merlin://start"), url("chrome://merlin-start"));
    assert_eq!(classify("merlin://start/"), url("chrome://merlin-start/"));
    assert_eq!(classify("merlin://startup"), url("chrome://startup"));
    assert_eq!(classify("merlin://version"), url("chrome://version"));
}
