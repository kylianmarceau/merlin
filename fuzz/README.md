# Fuzz targets

libFuzzer targets for the core's parsers, which read input from outside
the browser: `config.toml`, workspace files, the `browserctl` socket, key
notation in bindings and text typed into `:open`. They run in the browser
process, so a panic in any of them takes down the whole browser.

| Target | Parser | Checks |
|---|---|---|
| `json` | `json::parse` | Never panics; an accepted document, written compact or indented, reads back the same |
| `toml_lite` | `toml_lite::parse` | Never panics; an accepted file, written back as one dotted key per line, has the same values at the same paths |
| `ipc` | `ipc::parse_request`, `ipc::parse_reply` | Never panics; an accepted request, encoded again, parses to the same request |
| `keys` | `KeySequence::parse` | Never panics; an accepted sequence, written in key notation, parses to the same keys |
| `target` | `target::classify` | Never panics; a URL it produces classifies as itself, and search terms it produces still search for the same terms |

The checks live in one place,
`overlay/components/modal_browser/core/tests/roundtrip/mod.rs`. The targets
include it, and `cargo test` runs the same checks over seeds and a few
thousand mutations (`core/tests/parsers.rs`), so they never go stale.

## Running them

```bash
scripts/fuzz.sh            # every target for 60 seconds
scripts/fuzz.sh 600 json   # one target for 10 minutes
```

This needs only stable Rust: the script builds with the coverage flags
cargo-fuzz uses, without AddressSanitizer, which the core (it forbids
unsafe code) doesn't need. With nightly and `cargo-fuzz` installed,
`cargo fuzz run json` from the repository root works too.

The daily CI workflow (`.github/workflows/daily.yml`) runs
`scripts/fuzz.sh 60` and keeps the corpus between runs.

`seeds/` holds a few valid inputs per target and is committed. The growing
`corpus/`, any failing inputs in `artifacts/` and the build in `target/`
are not. To replay a failing input, run the target's binary on it:

```bash
fuzz/target/coverage/$(rustc -vV | sed -n 's/^host: //p')/release/json fuzz/artifacts/json-crash-<hash>
```

Fix the parser, then add the input to `core/tests/parsers.rs` so it stays
fixed.
