#!/usr/bin/env bash
# Fuzzes the core's parsers: builds the libFuzzer targets in fuzz/ with
# coverage instrumentation, then runs each for a while. A panic in these
# parsers would run in the browser process and take the whole browser down.
#
#   scripts/fuzz.sh                 # every target, 60 seconds each
#   scripts/fuzz.sh 300 json ipc    # these targets, 5 minutes each
#
# Stable Rust is enough: the coverage flags are the ones cargo-fuzz passes,
# without its AddressSanitizer, which the core (no unsafe code) doesn't need.
# With nightly and cargo-fuzz installed, `cargo fuzz run <target>` from the
# repository root works too. A failing input is saved in fuzz/artifacts/;
# replay it with `<binary> fuzz/artifacts/<file>`.
set -euo pipefail
cd "$(dirname "$0")/.."

seconds="${1:-60}"
shift || true
targets=("$@")
[[ ${#targets[@]} -gt 0 ]] || targets=(json toml_lite ipc keys target)

host="$(rustc -vV | sed -n 's/^host: //p')"
# --target keeps these flags off build scripts, which can't link sancov.
RUSTFLAGS="-Cpasses=sancov-module \
  -Cllvm-args=-sanitizer-coverage-level=4 \
  -Cllvm-args=-sanitizer-coverage-inline-8bit-counters \
  -Cllvm-args=-sanitizer-coverage-pc-table \
  -Cllvm-args=-sanitizer-coverage-trace-compares \
  --cfg fuzzing -Cdebug-assertions -Coverflow-checks" \
CARGO_TARGET_DIR=fuzz/target/coverage \
  cargo build --release --locked --manifest-path fuzz/Cargo.toml --target "$host"

bin="fuzz/target/coverage/$host/release"
mkdir -p fuzz/artifacts
for target in "${targets[@]}"; do
  mkdir -p "fuzz/corpus/$target"
  echo "==> $target for ${seconds}s"
  log="fuzz/artifacts/$target.log"
  status=0
  "$bin/$target" "fuzz/corpus/$target" "fuzz/seeds/$target" \
    -max_total_time="$seconds" -artifact_prefix="fuzz/artifacts/$target-" \
    -print_final_stats=1 > "$log" 2>&1 || status=$?
  # The summary and any failure; the full output stays in the log.
  grep -E '^#[0-9]+[[:space:]]+DONE|^stat::number_of_executed_units|panicked|SUMMARY|Test unit written' "$log" || true
  if [[ $status -ne 0 ]]; then
    tail -40 "$log" >&2
    echo "FAIL: $target found an input (exit $status); see fuzz/artifacts/" >&2
    exit 1
  fi
done
echo "No target found a failing input."
