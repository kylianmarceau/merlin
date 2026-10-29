use modal_browser_core::json::{self, MAX_DEPTH, Value};

#[test]
fn parses_every_value_kind() {
    let v = json::parse(r#" {"a": [1, -2.5, 3e2, true, false, null], "b": {"c": "d"}} "#).unwrap();
    let a = v.get("a").and_then(Value::as_array).unwrap();
    assert_eq!(a[0].as_u64(), Some(1));
    assert_eq!(a[1], Value::Number(-2.5));
    assert_eq!(a[2].as_u64(), Some(300));
    assert_eq!(a[3], Value::Bool(true));
    assert_eq!(a[5], Value::Null);
    assert_eq!(
        v.get("b").and_then(|b| b.get("c")).and_then(Value::as_str),
        Some("d")
    );
}

#[test]
fn string_escapes_round_trip() {
    let original = "quote \" backslash \\ newline \n tab \t nul \u{0} line-sep \u{2028} emoji 🦀";
    let encoded = Value::string(original).to_json();
    assert!(!encoded.contains('\n'), "one line: {encoded}");
    assert!(encoded.contains("\\u2028"));
    assert_eq!(json::parse(&encoded).unwrap().as_str(), Some(original));
    // Surrogate pairs from other encoders.
    assert_eq!(
        json::parse(r#""\ud83e\udd80""#).unwrap().as_str(),
        Some("🦀")
    );
}

#[test]
fn rejects_malformed_and_hostile_input() {
    for bad in [
        "",
        "{",
        "[1,]",
        "{\"a\":1,}",
        "{'a':1}",
        "01",
        "1.",
        "NaN",
        "\"\\x\"",
        "\"\\ud800\"",
        "\"tab\tinside\"",
        "{\"a\":1,\"a\":2}",
        "[] []",
        "1e999",
    ] {
        assert!(json::parse(bad).is_err(), "accepted {bad:?}");
    }
    let deep = "[".repeat(MAX_DEPTH + 2) + &"]".repeat(MAX_DEPTH + 2);
    assert!(json::parse(&deep).unwrap_err().message.contains("deeply"));
    let ok = "[".repeat(MAX_DEPTH) + &"]".repeat(MAX_DEPTH);
    assert!(json::parse(&ok).is_ok());
}

#[test]
fn numbers_are_written_as_integers_when_whole() {
    let v = Value::object([("n", Value::from(42u32)), ("f", Value::Number(0.5))]);
    assert_eq!(v.to_json(), r#"{"n":42,"f":0.5}"#);
    assert_eq!(Value::Number(-3.0).as_u64(), None);
    assert_eq!(Value::Number(-3.0).as_i64(), Some(-3));
    assert_eq!(Value::Number(1.5).as_i64(), None);
}

#[test]
fn pretty_output_parses_back() {
    let v = Value::object([
        (
            "list",
            Value::Array(vec![Value::from(1u32), Value::string("x")]),
        ),
        ("empty", Value::Array(vec![])),
        ("obj", Value::object([("k", Value::Bool(false))])),
    ]);
    let pretty = v.to_json_pretty();
    assert!(pretty.contains("\n  \"list\": [\n    1,"));
    assert_eq!(json::parse(&pretty).unwrap(), v);
}
