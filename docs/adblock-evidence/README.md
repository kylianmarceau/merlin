# Native blocker evidence

## Follow-up qualification, 2026-11-03

Read the [current qualification record](../ADBLOCK_QUALIFICATION.md) for methods,
results and limitations. This is an arm64 component development build on Apple
M2 / 16 GB / macOS 27, Chromium 157.0.8103.26. The original percentage-only
clean-page target did not pass; a documented frame-aware development paint
budget is evaluated separately. The feature remains opt-in and no distribution
packaging or publication was performed.

- [Final clean-page paint sweep](2026-11-03-final-paint.json.gz) and
  [calculated summary](2026-11-03-final-paint-summary.json): 360 retained loads,
  ten independent profile pairs, 1/100/1,000 cards and zero/100 ms response
  delays. All six cases pass the explicitly revised 16.7/33.4 ms floor budget;
  unfavorable load-event results and relative-gate failures are retained.
- [Earlier pre-fix navigation](2026-11-03-pre-fix-navigation.json.gz),
  [quoted-attribute batching navigation](2026-11-03-quoted-batching-navigation.json.gz)
  and [intermediate paint sweep](2026-11-03-quoted-batching-paint.json.gz):
  diagnostic progression, including measurements that failed earlier budgets.
- [Clean trace diagnostics](2026-11-03-clean-trace-diagnostics.json), with
  [repeated off](2026-11-03-repeated-clean-off.trace.json.gz) /
  [on](2026-11-03-repeated-clean-on.trace.json.gz) traces and
  [single off](2026-11-03-single-clean-off.trace.json.gz) /
  [on](2026-11-03-single-clean-on.trace.json.gz) traces: separate instrumented
  paint/load investigations. Both the favorable repeated and unfavorable
  single-pair paint results are retained; these are not final sweep trials.
- [Browser/renderer native capture](2026-11-03-native-memory.json.gz),
  [symbolized summary](2026-11-03-native-memory-summary.json),
  [off dump trace](2026-11-03-native-memory-off.memory.trace.json.gz) and
  [on dump trace](2026-11-03-native-memory-on.memory.trace.json.gz): 4 KiB
  Poisson samples, 1/10/30 tabs, close-to-one, six complete configuration
  replacements and 30 later navigations. The conservative 30-tab live
  allocation estimate is 27.415 MiB; this does not establish 32 MiB total RAM.
  The attempted online refresh in this initial capture failed the source
  minimum guard; the separate corrected refresh below supersedes that attempt.
- [Unprofiled macOS physical footprint](2026-11-03-physical-memory.json):
  `proc_pid_rusage` process-ledger statistics with heap reporting disabled,
  matching stable process counts and whole-tree RSS/idle CPU. Physical
  on-minus-off deltas are 57.50 / 43.95 / 37.84 MiB at 1/10/30 tabs. This is
  one paired observation, not exact attribution or a confidence interval.
- [Actual successful online refresh](2026-11-03-online-update.json.gz),
  [summary](2026-11-03-online-update-summary.json) and
  [dump trace](2026-11-03-online-update-on.memory.trace.json.gz): all 18 approved
  sources installed after fixing the comment-only companion's minimum; 64/64
  fixture ad requests remained blocked. At 100 ms intervals, browser
  feature-attributed live allocations peaked at an observed 60.28 MiB and
  settled to 10.07 MiB. Shorter transient peaks may be missed.
- [Source minimum audit](2026-11-03-source-minimum-audit.json): public endpoint
  status and size/rule counts before the catalog-only fix. It contains no
  downloaded list bodies or profile data.
- [YouTube qualification](2026-11-03-youtube-qualification.json): signed-in
  non-Premium 690-second off/on comparison (32/0 ad-showing samples), actual
  mid-roll observations, separate completed 900-second follow-ups and
  maintainer-confirmed seeking/captions/fullscreen/PiP. The interrupted long
  runs and the awake control without an observed mid-roll are not passed off
  as accepted mid-roll runs. Account identity, credentials, cookies, profile
  contents and screenshots are excluded.
- [Complete native-test log](2026-11-03-native-tests.log.gz): **46/46 passed**.
  [Workspace-check log](2026-11-03-workspace-check.log.gz): **253 Rust/bridge/host
  tests**, **15 Python tests**, resource/format/lint checks and **45 patches**.
  The owner's local home path is replaced with `/Users/TEST_OWNER` in these logs.

The full native capture preceded only the catalog minimum correction; evaluator
and selector code are the same. Profiles retain their original Mach-O UUIDs.
The successful online-refresh capture matches the corrected binary. Symbolized
summaries are included; reanalysis of raw allocation stacks needs the exact
matching local Mach-O binary and rejects UUID mismatches. Memory traces retain
allocator/process dumps and process/thread names; duplicate `heaps_v2` payloads
are removed because allocation samples already live in the paired JSON report.
Detailed memory-infra tracing and sampler serialization can inflate process
memory; use the independent unprofiled ledger for physical-footprint observations.

Reproduce separately, with Node 22+, the built component app and the laptop awake:

```bash
caffeinate -i node scripts/benchmark_adblock.mjs --app "$HOME/chromium/src/out/Modal/Merlin.app" --navigation-sweep --paint --output /tmp/adblock-paint.json
caffeinate -i node scripts/benchmark_adblock.mjs --app "$HOME/chromium/src/out/Modal/Merlin.app" --native-memory --output /tmp/adblock-native.json
python3 scripts/analyze_adblock_memory.py /tmp/adblock-native.json --build "$HOME/chromium/src/out/Modal" --output /tmp/adblock-native-summary.json
caffeinate -i node scripts/benchmark_adblock.mjs --app "$HOME/chromium/src/out/Modal/Merlin.app" --physical-memory --output /tmp/adblock-physical.json
caffeinate -i node scripts/benchmark_adblock.mjs --app "$HOME/chromium/src/out/Modal/Merlin.app" --update-only --output /tmp/adblock-update.json
caffeinate -i scripts/run_browser_tests.sh 'MerlinAdblock*'
scripts/check.sh
```

Run playback separately from timing/profiling work. For signed-in tests, use a
new dedicated test profile with `--profile /tmp/merlin-adblock-test-account
--wait-for-signin --headful --no-controls`; the owner signs in themselves.
Do not use an ordinary personal browsing profile. Use `--stop-after-midroll`
with an off-mode direct route when requiring observed mid-roll eligibility;
a completed video without that observation intentionally fails that criterion.
A hardware sleep or scheduling gap is a diagnostic, not a valid completed run.
The helper's interactive sign-in wait is excluded from playback gap checking.

## Initial qualification, 2026-11-02

These historical development observations use the same pinned Chromium
157.0.8103.26 arm64 component build on Apple M2 / 16 GB. Their outstanding
account/memory follow-ups are superseded by the November 3 record. They do not
establish general Brave parity, a release performance pass or distribution
readiness.

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
