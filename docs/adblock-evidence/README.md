# Native blocker evidence, 2026-11-02

These are development observations from the pinned Chromium 157.0.8103.26
arm64 component build on an Apple M2 with 16 GB RAM. They do not establish
live YouTube parity, a release performance pass or distribution readiness.

- [Primary paired benchmark](2026-11-02-benchmark.json): ten alternating
  on/off pairs after cosmetic declaration batching, 120 raw timing/CPU trials,
  six stable 1/10/30-tab samples, browser version and source hashes.
- [Raw enabled trace](2026-11-02-on.trace.json.gz),
  [disabled trace](2026-11-02-off.trace.json.gz) and
  [trace summary](2026-11-02-trace-summary.json): separate local ad-heavy runs,
  with generic cosmetics enabled. Native spans retain evaluator queue and
  return-hop costs. No personal browsing profile was used.
- [Rust allocation probe](2026-11-02-engine-heap.json): live requested Rust
  bytes and build/replacement peaks, excluding C++, V8 and reserved pages.
- [Bundle audit](2026-11-02-bundle-audit.json): supported/unsupported syntax,
  resources, scriptlets and YouTube/clean-page payload sizes.
- [Live YouTube comparison](2026-11-02-youtube-comparison.json): signed-out
  windowed Merlin, private protected Merlin, unprotected control and official
  Brave. Protected direct/private, nine-minute, SPA, playlist/autoplay, Shorts
  transitions, cross-site embed and foreground media controls passed. The
  unprotected music control showed ads. Remaining conditions are explicit.
- [Earlier automation diagnostic](2026-11-02-youtube-automation-diagnostic.json):
  headless/port-zero sessions stalled across protected/unprotected Merlin and
  Brave. The later ordinary windowed sessions passed; exact cause is unproven.
- [Pre-batching benchmark](2026-11-02-pre-batching-benchmark.json) and its
  [enabled trace](2026-11-02-pre-batching-on.trace.json.gz),
  [disabled trace](2026-11-02-pre-batching-off.trace.json.gz) and
  [summary](2026-11-02-pre-batching-trace-summary.json): same hostname harness
  before the stylesheet change. Host/startup variation prevents attributing
  every between-run difference to the code change.
- [Loopback diagnostic](2026-11-02-development-benchmark.json),
  [trace summary](2026-11-02-development-trace-summary.json) and
  [stable-process memory rerun](2026-11-02-development-memory.json): early
  diagnostic conditions. EasyList exempts loopback URLs from generic cosmetics.
  The original negative idle-CPU values are marked invalid and superseded.

Wall time includes DevTools coordination. Navigation Timing is retained
separately and still shows clean-page overhead. RSS includes shared mappings
and allocator reservation; it must not be equated with blocker-owned heap.
Read the [implementation record](../ADBLOCK_IMPLEMENTATION.md) for current
coverage, measurement tables and outstanding qualification.

Reproduce the primary benchmark using Node 22+:

```bash
node scripts/benchmark_adblock.mjs --app "$HOME/chromium/src/out/Modal/Merlin.app" --trace --output /tmp/adblock.json
python3 scripts/analyze_adblock_trace.py /tmp/adblock-on.trace.json /tmp/adblock-off.trace.json
python3 scripts/analyze_adblock_trace.py docs/adblock-evidence/2026-11-02-on.trace.json.gz
python3 scripts/measure_adblock_heap.py --output /tmp/adblock-heap.json
cargo run --offline -p merlin_adblock_core --example audit_bundle
```

The benchmark uses isolated profiles, disables list updates and validates that
the unprotected fixture serves all 64 ad resources while protection serves
none. Memory samples require stable child-process membership and nonnegative
CPU deltas. `--memory-only` repeats those samples without timing trials.

Reproduce a live signed-out route in a fresh isolated window:

```bash
node scripts/probe_adblock_youtube.mjs --app "$HOME/chromium/src/out/Modal/Merlin.app" --mode on --headful --seconds 90 --output /tmp/adblock-youtube.json
```

Use `--mode off` for the unprotected control, `--private` for private mode,
`--route spa|playlist|shorts|embed` for the route, `--autoplay` with a playlist
and `--url https://www.youtube.com/shorts --shorts-steps 3` with Shorts.
Live auctions vary; inspect the control and
record eligibility. Fresh profiles are signed out. No personal profile or
account credentials are used.
