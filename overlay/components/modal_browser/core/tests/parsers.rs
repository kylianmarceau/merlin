//! The fuzz targets' properties (`roundtrip`), run on stable in every
//! `cargo test`: over hand-picked seeds, then over a few thousand
//! deterministic mutations of them. The fuzz targets in `fuzz/` explore far
//! more; this keeps the properties themselves from going stale.

mod roundtrip;

const JSON: &[&str] = &[
    r#"{"a":[1,2.5,-3e2,true,false,null],"b":{"c":"dé\n"}}"#,
    r#"[[[[]]],{},"",0,-0,1E+300,"😀"]"#,
    r#"  "\"\\\/\b\f\n\r\t"  "#,
    "123456789012345678901234567890",
];

const TOML: &[&str] = &[
    "[options]\nscroll_step = 60\nhint_chars = \"asdf\"\nsmooth = true\n",
    "[keys.normal]\n\"<C-d>\" = \"scroll page-down\"\nj = 'scroll down'\n",
    "a.b.\"c d\" = [1, -2, [\"x\", 'y'], []]\n# comment\n[t]\nk = \"\\u00e9\\t\\U0001F600\"\n",
    "\u{feff}x = +7\ny = -9223372036854775808\n",
];

const IPC: &[&str] = &[
    r#"{"v":1,"id":7,"cmd":"open","url":"example.com","where":"tab"}"#,
    r#"{"id":1,"cmd":"workspace","action":"here","dir":"/tmp/project"}"#,
    r#"{"cmd":"workspace","action":"save","name":"work"}"#,
    r#"{"v":1,"id":2,"cmd":"shell-call","method":"settings.get","args":{"a":[1,{"b":null}]}}"#,
    r#"{"cmd":"focus","tab":3}"#,
    r#"{"cmd":"command","line":"tabnew https://docs.rs"}"#,
    r#"{"v":1,"id":3,"ok":true,"result":{"tabs":[]}}"#,
];

const KEYS: &[&str] = &[
    "gg",
    "<C-w>v",
    "<C-S-Tab><lt><Esc>",
    "<C->>",
    "<M-<>x<Space><CR><BS><Up><F12>",
    "é漢<S-Esc>",
    // Found by the keys fuzz target: Control-minus, then '>'.
    "<C-->>",
];

const TARGETS: &[&str] = &[
    "docs.rs",
    "https://example.com/a?b#c",
    "localhost:3000/x",
    "[::1]:8080",
    "192.168.0.1",
    "? rust lifetimes",
    "rust lifetimes",
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "file:///etc/hosts",
    "about:blank",
    "example.test",
    "chrome://settings",
];

/// Bytes that matter to one parser or another.
const SPICE: &[u8] = b"<>-[]{}\"'\\\n\t =.,:#?/@0123456789eE+-truefalsenullCSMD\x00\xff";

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

fn mutate(rng: &mut Rng, seed: &[u8], seeds: &[&str]) -> Vec<u8> {
    let mut data = seed.to_vec();
    for _ in 0..=rng.below(4) {
        let at = rng.below(data.len() + 1);
        match rng.below(5) {
            0 if at < data.len() => {
                data.remove(at);
            }
            1 => data.insert(at, SPICE[rng.below(SPICE.len())]),
            2 if at < data.len() => data[at] = SPICE[rng.below(SPICE.len())],
            3 => {
                let other = seeds[rng.below(seeds.len())].as_bytes();
                let from = rng.below(other.len());
                let to = from + rng.below(other.len() - from + 1);
                data.splice(at..at, other[from..to].iter().copied());
            }
            _ => {
                let end = (at + rng.below(8)).min(data.len());
                data.drain(at.min(end)..end);
            }
        }
    }
    data
}

fn explore(seeds: &[&str], property: fn(&str)) {
    for seed in seeds {
        property(seed);
    }
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    for _ in 0..4000 {
        let seed = seeds[rng.below(seeds.len())];
        let data = mutate(&mut rng, seed.as_bytes(), seeds);
        property(&String::from_utf8_lossy(&data));
    }
}

#[test]
fn json_never_panics_and_round_trips() {
    explore(JSON, roundtrip::json);
}

#[test]
fn toml_never_panics_and_round_trips() {
    explore(TOML, roundtrip::toml);
}

#[test]
fn ipc_never_panics_and_round_trips() {
    explore(IPC, roundtrip::ipc);
}

#[test]
fn keys_never_panic_and_round_trip() {
    explore(KEYS, roundtrip::keys);
}

#[test]
fn targets_never_panic_and_classify_as_themselves() {
    explore(TARGETS, roundtrip::target);
}

#[test]
fn every_property_takes_any_bytes() {
    let mut rng = Rng(1);
    let all: Vec<&str> = [JSON, TOML, IPC, KEYS, TARGETS].concat();
    for _ in 0..500 {
        let seed = all[rng.below(all.len())];
        roundtrip::all(&mutate(&mut rng, seed.as_bytes(), &all));
    }
}

/// The seeds parse, so the round trips above run on real documents rather
/// than only on rejections.
#[test]
fn seeds_are_accepted() {
    use modal_browser_core::{ipc, json, key::KeySequence, target, toml_lite};
    for seed in JSON {
        assert!(json::parse(seed).is_ok(), "{seed:?}");
    }
    for seed in TOML {
        assert!(toml_lite::parse(seed).is_ok(), "{seed:?}");
    }
    for seed in IPC {
        let reply = seed.contains("\"ok\"");
        assert_eq!(ipc::parse_request(seed).is_ok(), !reply, "{seed:?}");
        assert_eq!(ipc::parse_reply(seed).is_ok(), reply, "{seed:?}");
    }
    for seed in KEYS {
        assert!(KeySequence::parse(seed).is_ok(), "{seed:?}");
    }
    let refused = ["javascript:alert(1)", "data:text/html,<b>x</b>"];
    for seed in TARGETS {
        assert_eq!(
            target::classify(seed).is_ok(),
            !refused.contains(seed),
            "{seed:?}"
        );
    }
}
