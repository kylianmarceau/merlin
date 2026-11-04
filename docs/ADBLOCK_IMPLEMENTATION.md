# Native blocker implementation and qualification

Native integration is implemented. Follow-up work on
`feature/adblock-qualification` completes the requested local memory/update-peak,
signed-in YouTube and observed-mid-roll measurements, fixes cosmetic batching and
a real filter-refresh failure, and records the justified development latency
budget. Read the [November 3 qualification record](ADBLOCK_QUALIFICATION.md) for
current results, limitations and the final 46/46 native-test pass. The original
percentage-only latency target did not pass; broader release-build qualification
remains separate. The `MerlinAdblock` feature is **disabled by default** pending
the remaining default-enablement gates in [the plan](ADBLOCK_PLAN.md). Development builds opt in with
`--enable-features=MerlinAdblock`; `--disable-features=MerlinAdblock` is the
independent kill switch. Modal browsing does not control this feature.

## Performance pass, 2026-11-04

Branch `feature/adblock-performance`. An audit of the integrated engine found
that adblock-rust itself was fast, but the code around it added most of the
cost. Every request hopped to the renderer's main thread, and every network
message for every request was relayed through the browser UI thread. Each
startup read and hashed all list text, and a repeating cosmetic timer woke
every tab. This pass removes those costs. Behavior and rule semantics are
unchanged.

**Request path.**

- The browser proxy factory and its loads run on one dedicated thread, not the
  UI thread. A check goes proxy thread → engine thread → proxy thread. The
  proxy reads a thread-safe `RequestGate` snapshot (on/off, site exceptions,
  readiness, live `Matcher`) that the Service republishes on every pref,
  readiness or generation change.
- The UI thread is visited only for blocked counts, Network Service CSP header
  parsing and requests that arrive while the engine is still starting.
- Sites with protection off skip the proxy entirely.
- Top-level documents skip the matcher; the engine never blocks them.
- Any added CSP is looked up as the request starts, so responses do not wait
  for an engine hop.
- Loads share the factory's downstream pipe rather than cloning one per
  request.

**Renderer.**

- `BackgroundResourceFetch` creates URL loader throttles off the main thread.
  The old throttle hopped back to the main thread for every request to ask
  whether a service worker controlled the frame. A lock-protected per-frame
  registry now answers on the loader thread.
- Uncontrolled frames get no throttle; the browser proxy already covers them.
- Controlled frames check through a `SharedRemote` bound on a background
  sequence.
- Patch 0046 adds a service worker controller-change hook, so
  `clients.claim()` after load also switches the frame to renderer-side
  checks.
- The cosmetic helper has no repeating timer. It starts once, 250 ms after
  script context creation, and is skipped when `generichide` applies and there
  are no procedural rules. It scans on idle time and observes only `class`/`id`
  attributes when it has no procedural rules.
- The helper reports identifiers through a direct isolated-world function
  rather than polling. It rescans after same-document navigations and holds
  off while prerendering.

**Startup and cache.**

- The cached engine (`current`) is identified by metadata: source ids,
  revisions, text digests, permissions, resources digest and engine version.
  Startup no longer reads or hashes list text.
- List text lives in `current.lists`, which is read only when a rebuild or
  download is due. Each file keeps a `.previous` snapshot.
- Inside the engine payload, a fast Rust checksum replaces a second SHA-256.
  BoringSSL still verifies the whole file.

Measurements use the new `scripts/benchmark_adblock_realistic.mjs`: 8 profile
pairs × 3 loads per variant. Each variant is a clean page with about 80
subresources, an ad-heavy page with 40 ad requests, or a service-worker
controlled page. Deltas are blocker on minus off, median ms, on the same
M2 / 16 GB arm64 `out/Modal` component build:

| Variant / metric | Before | After |
| --- | ---: | ---: |
| Clean load event | +13.6 | **+3.7** |
| Clean DOMContentLoaded | +20.4 | **+3.5** |
| Clean first contentful paint | +24.0 | **−4.0** |
| Clean per-resource stall | +11.6 | **+0.7** |
| Ad-heavy load event | +8.3 | **+2.8** |
| Ad-heavy per-resource time | −15.5 | **−23.9** |
| Service-worker load event | +47.1 | **+11.5** |
| Service-worker per-resource stall | +54.1 | **+9.8** |

Ad-server requests stay at 40 off / 0 on. Traces show the renderer
main-thread policy hop is gone for uncontrolled pages: it was 3.9 ms median
and 34 ms max per request. The return hop after matching fell from 2.2–7.5 ms
to about 0.1 ms. Physical footprint at idle, blocker overhead:

| Tabs | Before | After | Idle CPU per 15 s, on (before → after) |
| ---: | ---: | ---: | ---: |
| 1 | +45.8 MiB | **+21.9 MiB** | 0.23 s → 0.24 s |
| 10 | +38.1 MiB | **+32.7 MiB** | 0.88 s → **0.17 s** |
| 30 | +50.9 MiB | +58.1 MiB | 1.27 s → **0.73 s** |

The 30-tab footprint is within the 37.8–57.5 MiB range of earlier
checkpoints. A stack sampler was attached during that run. One earlier
physical-memory run stopped at the 30-tab step with a 60 s DevTools timeout.
It did not recur in the full rerun, or in a targeted stress run of
5 × 30 tabs with the blocker on, where the slowest browser round trip was
218 ms. It is recorded as unexplained, not fixed.

This build understates release-build speed. `dcheck_always_on` also passes
`-Cdebug-assertions` to Rust code (`build/config/BUILD.gn`). The same engine
microbenchmark measured **3.9 µs** per check without debug assertions and
**67.8 µs** with them. In-browser matches here took 0.12–0.24 ms median, and
most of the remaining engine-queue wait comes from that cost. A release build
should match far faster. Release-build page-load measurements are still to be
taken.

Evidence: `docs/adblock-evidence/2026-11-04-*`, described in its README.

## Baseline and hook decision

Chromium 157.0.8103.26, commit
`4c20950d2f187a6976cf5e2a1234ca896dcdfd1c`, with the already tested safety
controls and patches 0001–0013 preserved. No pin change or checkout reset was
performed. The existing component development configuration and test evidence
are recorded in [Testing](TESTING.md).

Before the feature build, ten runs of the existing local-page baseline measured
new-profile launch-to-load median **4.48 s** (range 4.41–7.63), and warm-profile
median **4.53 s** (range 4.16–4.63). One-tab process-tree RSS after 15 seconds was
**1,675 MiB**. The 30-tab sample returned zero because its process was no longer
live; that sample is invalid. These are development-build observations, not
release performance gate results. The original harness did not retain raw
trials for p95 calculation. The paired on/off measurements and live YouTube checks below supersede that baseline.

Patches 0014–0031 add native browser/renderer hooks, test registration, a document broker, a reserved isolated world, and dedicated socket handshake checks.
The browser request proxy uses Chromium's factory composition and the inner
factory override when available, retaining the enclosing CORS/ORB checks for
replacement responses. Security bypass flags are untouched. Factory types for
downloads and DevTools are excluded. Top-level documents are identified by
request destination, not `is_outermost_main_frame`, which is also true for
subresources initiated by a main frame.

Initiating origin and top-level exception context are separate. The latter
comes from browser-owned `IsolationInfo`, so factory creation before commit
cannot lose it. Requests retain their own document lifetime reference for
counting. Shared/service worker exceptions use their owning origin; dedicated
workers attributable to a frame use its top-level site. No active tab is chosen
for a worker without a frame.

Early configuration uses a commit-deferring condition and an acknowledged
associated Mojo message. The renderer receives the configuration before commit
and executes approved main-world scriptlets in `DidCreateScriptContext` before
the first inline script. The handoff and startup waits have bounded timers.
Sandboxed script-disabled documents receive no executable scripts. Neither CSP
nor sandbox policies are relaxed.

## Engine and data

The engine is pinned to **adblock 0.13.3** with its default embedded public-suffix
resolver, regex handling and `single-thread` feature, plus `css-validation` for procedural selector parsing. Without that optional feature the engine returns procedural syntax as native CSS; a dedicated fixture now guards this setting. Chromium's dependency-age
policy rejected the plan's tentative 0.13.5 because it was only four days old;
the minimum is fourteen days. The policy was retained.

`scripts/prepare_adblock_deps.py` uses Chromium's gnrt, a pin-specific dependency
lock, 41 crate archive digests and source digests. Both Cargo and GN compile the
same wrapper and dedicated `cxx` bridge, with Chromium's `cxx` 1.0.202. Recovered
upstream license notices are preserved; no engine source is modified. Specific
build adaptations are reproducible: separate thiserror 1/2 settings, stable
FlatBuffers code instead of its nightly optimization, the CSS parser build script outputs and macro documentation inputs, and ASCII-escaped build
environment author metadata for Siso's spawn protocol. Original author and
copyright files are unchanged.

The initial data snapshot contains 18 EasyList/EasyPrivacy, uAssets and Brave
sources, with 217 resources and 298 canonical names/aliases. All 98 scriptlet
names referenced by the raw sources resolve, including names in inactive
conditional branches. Lists have separate trust masks; resource dependencies,
aliases and execution worlds are retained. Executable resource updates are
restricted to app releases. Provenance and notices are in
`overlay/components/merlin_adblock/resources/manifest.json` and `NOTICE.md`.

The native list preprocessor evaluates the Chromium environment and rejects
unknown capabilities, incomplete conditionals, unapproved includes and includes
crossing a trust boundary. With this snapshot the wrapper finds **160,407
supported rules** and **1,061 unsupported rules**, including **3,143 popup
references** handled by separate window-specific engines, and **88 CSP rules** with additive response integration. These syntax gaps must be reviewed before default enablement.
The serialized engine cache is **8,357,974 bytes**; that is not a memory
measurement. The YouTube configuration currently produces 81,656 bytes of
main-world script, 16,218 bytes of isolated-world script and 18 specific
selectors plus one procedural rule. Resource delivery is covered deterministically; live playback results are recorded below.

## Deterministic coverage, 2026-11-02

The native suites contain **44 cases**. The complete 43-case integration
checkpoint passed; the CSS batching change adds one case and passes all
13 affected cosmetic/scriptlet/lifecycle regressions. These tests
use local servers and explicit blocked/allowed controls; they do not depend on
live ad auctions. The separate loader suite passed **35/35** cases, including
preserving a Service Worker response body while adding a response policy.

| Path                   | Verified behavior                                                                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests and redirects | Script, image, stylesheet, font, media, object, fetch/XHR, keepalive, beacon, worker-script and prefetch requests; blocked destinations have zero server hits; redirect targets are checked                                                                                        |
| Early Hints            | Speculative factories run embedder policy; blocked resource has zero server hits and its count follows the committed navigation; feature-off control reaches server                                                                                                                |
| Cache                  | HTTP and renderer decoded-resource caches cannot bypass changed rules, newly enabled protection or opaque-document policy; allowed controls still load                                                                                                                             |
| Service Workers        | Cached and synthetic responses are checked before dispatch; typed replacement/rewrite/redirect behavior retains CORS; synthesized navigations retain body and receive additive CSP                                                                                                 |
| Workers                | Dedicated, shared and nested workers use browser-owned origin/exception attribution, including controlled workers and cache responses                                                                                                                                              |
| Sockets                | Allowed echo and blocked WebSocket handshakes in frames, dedicated and shared workers; Real WebTransport allowed/blocked CONNECT sessions and site/global exceptions passed in frames, dedicated and shared workers. CONNECT maps to Other; the pinned hook cannot rewrite its URL |
| Documents              | Main-world scriptlet runs before first inline script and in cross-process children; inherited blank/srcdoc and opaque sandbox documents; JavaScript-disabled contexts receive no executable helper                                                                                 |
| Cosmetics              | Domain and dynamic generic CSS, procedural selectors/actions, isolated helpers, packaged scriptlets and SPA rescanning; bounded DOM work; BFCache restoration and prerender activation                                                                                             |
| Windows                | Direct and redirected popups, blank-window chains and popunders; legitimate login windows and existing activation/permission policy remain usable                                                                                                                                  |
| State and controls     | Exact-host exceptions, global off/on without reloading, private profile isolation, stale menu rejection, Settings/commands with modal browsing off                                                                                                                                 |
| Recovery               | Corrupt/incompatible cache fallback, rollback, invalid candidate retains prior rules, profile shutdown, pending-generation cancellation and Network Service restart                                                                                                                |
| Updater                | HTTPS/source bounds, cookie/referrer omission, malformed HTML, HTTP failures, missing resources and redirect failures; previous valid snapshot stays active                                                                                                                        |

The previous upstream regression run passed **92/92** browser/view/command
cases and **44/44** Find cases. The final Merlin suite passed **74/74** cases;
feature-enabled worker/extension interception passed **21/21** cases. This
includes corrected Settings coverage and fullscreen toolbar restoration.

Full workspace formatting, warnings-denied lint, **252 Rust/bridge/host tests**,
page-script checks and resource integrity passed. The engine has **19** Rust
fixtures. All **31 patches** pass strict application against the pinned source
and the installer reports no changes for the already-applied checkout.
Browser, renderer, bridge/Mojo and UI GN checks passed. The final incremental
`chrome browser_tests` build passed with the CSS batching change; its dependency
graph is unchanged.

## Live YouTube coverage, 2026-11-02

Fresh signed-out, windowed sessions passed in normal and private Merlin with
protection enabled. An unprotected music control showed **four ad-showing
samples**, establishing ad eligibility for that comparison; the protected
normal/private sessions showed none and sustained playback. These are samples,
not a count of distinct ads. No accounts or personal profiles were accessed.

| Protected route    | Observed result                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Direct playback    | Normal and private music sessions sustained playback without observed ads                                       |
| Longer playback    | Nine-minute Blender video run reached 540 seconds, with 108 samples, no ad-showing samples or player warnings   |
| In-site navigation | Native recommendation click changed video while preserving the document and time origin; playback passed        |
| Playlist/autoplay  | Public 25-item playlist loaded; seeking near the end led to the next video automatically                        |
| Shorts             | Looping playback and three native Next transitions passed; the unprotected three-transition control also passed |
| Third-party embed  | Permitted Blender embed played in a cross-site iframe under an owned loopback parent                            |
| Player controls    | Foreground 90-second run passed seeking, rendered captions, fullscreen and picture-in-picture                   |

The [dated samples and conditions](adblock-evidence/2026-11-02-youtube-comparison.json)
include official [Brave v1.98.63](https://github.com/brave/brave-browser/releases/tag/v1.98.63)
with fresh default Shields. Its music session played but showed three
ad-showing samples. Component revisions were captured at the end, including
Default Adblock Filters 1.0.23400 and Resources 1.0.155; they may have updated
during playback. A single fresh-profile comparison does not establish parity.

Earlier headless and windowed probes using debugging port zero stalled around
45–50 seconds in protected/unprotected Merlin and Brave. Those samples are
retained as an [automation diagnostic](adblock-evidence/2026-11-02-youtube-automation-diagnostic.json).
The final windowed helper uses an ordinary nonzero loopback debugging port and
records `navigator.webdriver=false`, without a runtime-feature override or
security bypass. The earlier stall did not recur in the final conditions; its
exact cause remains unestablished. The probe distinguishes setup failures from
playback/route acceptance failures and retains diagnostic screenshots locally.

At this November 2 checkpoint, signed-in playback and an observed mid-roll
opportunity were untested. Both were subsequently measured in the
[November 3 follow-up](ADBLOCK_QUALIFICATION.md).
Shorts-specific ad eligibility was not established. The chosen music embed was
unavailable with protection both off and on; a permitted Blender embed passed.
Background fullscreen was denied in the long parallel run; the final foreground
control passed. Native UI/accessibility acceptance and broader real-site
journeys remain manual qualification work. These results describe the tested
conditions, not a guarantee of permanently zero ads.

## November 2 qualification checkpoint (superseded in part)

Ten-pair development measurements, stable 1/10/30-tab memory samples and
retained traces have completed. The repeated hide declarations in the default
516-selector clean-page payload are now batched. Single-argument `:is()` arms
preserve selector specificity and isolate invalid selectors; pseudo-selectors
and existing selector lists retain separate rules. The new regression covers
specificity, pseudo-elements, selector lists and a large selector batch. See
[Selectors Level 4](https://www.w3.org/TR/selectors-4/#matches) for the `:is()` semantics.

At this checkpoint, full browser-owned heap/update peaks remained open; the
[November 3 follow-up](ADBLOCK_QUALIFICATION.md) supplies those measurements,
independent physical footprint and additional live checks. The feature remains
disabled by default. Broader real-site performance and comparable release-build
qualification remain separate. No distribution build, packaging or GitHub
publication was done.

## Scope and measurements

The maintainer clarified on 2026-11-02 that this task covers ad-blocker
implementation and testing. Packaging and GitHub publication are separate.
These observations use the existing arm64 component development build; they
are not distribution or release-build acceptance.

The [primary ten-pair run](adblock-evidence/2026-11-02-benchmark.json) contains
120 raw timing trials, all 120 valid page CPU samples, six stable memory/idle
CPU samples, source hashes and the actual browser version. Runs alternate
on/off ordering and use fresh profiles plus warm relaunches. The hostname
`page.fixture.test` resolves locally and exercises generic cosmetics.
Every uncached ad-heavy control fetched **64** ad resources; protection fetched
**zero** in every cached and uncached trial.

| Metric, milliseconds                  | Off median / p95 | On median / p95 |
| ------------------------------------- | ---------------: | --------------: |
| First launch to fixture ready         |    6,474 / 9,083 |   6,169 / 8,793 |
| Warm launch to fixture ready          |    6,835 / 9,478 |   6,435 / 9,819 |
| Clean uncached, DevTools wall time    |    53.67 / 87.00 |   52.85 / 81.94 |
| Clean cached, DevTools wall time      |    44.46 / 71.52 |   44.04 / 70.23 |
| Ad-heavy uncached, DevTools wall time |  244.93 / 260.94 |  72.48 / 104.40 |
| Ad-heavy cached, DevTools wall time   |    64.41 / 87.76 |   76.13 / 94.06 |

The median uncached ad-heavy wall time fell **70.4%**. The wall-clock clean-page
numbers are within the provisional percentage limits in this run, but DevTools
coordination adds substantial noise. **Navigation Timing still regresses**:
clean uncached median is **19.60 → 25.70 ms** and cached is **18.25 → 24.45 ms**.
Do not treat the wall-clock result or a negative startup delta as proof that
all performance gates pass. Earlier runs show substantial host/startup noise;
raw pre-batching and loopback diagnostics are retained with their limitations.
Further latency profiling is recorded in the
[November 3 follow-up](ADBLOCK_QUALIFICATION.md); comparable release-build
measurements remain separate.

| Clean tabs | Off process-tree RSS, MiB | On RSS, MiB | Delta, MiB | Off / on idle CPU seconds per 15 s |
| ---------- | ------------------------: | ----------: | ---------: | ---------------------------------: |
| 1          |                   1,360.4 |     1,424.4 |       64.0 |                        0.01 / 0.07 |
| 10         |                   3,103.8 |     3,159.6 |       55.8 |                        0.46 / 0.46 |
| 30         |                   6,953.4 |     7,057.2 |      103.8 |                        0.35 / 1.42 |

Live process counts match between modes (8/17/37). Idle measurements retry
when child-process membership changes instead of accepting negative CPU deltas.
RSS includes shared mappings and allocator-reserved pages, so these deltas are
not a measurement of blocker-owned heap or a pass for the 32 MiB target.

[Compressed raw traces and their summary](adblock-evidence/README.md) retain
request round trips, inner matching, generic cosmetics and renderer policy
checks. Round-trip spans include evaluator queuing and return hops. Trace runs
are separate from the timing/memory samples. Warm cache loading installs on
the owning thread without serializing the same cache twice.

The expanded source audit identifies the 1,061 unsupported rules: 718 use
unrecognized network options; 162 require HTML filtering; 57 are generic
unhide rules; 41 have empty redirects; 19 have invalid scriptlet arguments;
14 use removeparam regular expressions; 13 use unsupported cosmetic syntax;
12 have empty removeparam; 11 combine CSP with a content type; six contain
invalid CSS selectors; three use double negation; two contain multiple
procedural selectors; two combine removeparam with exceptions; and one
negates a document type. These counts are compatibility limits, not blocked
request counts. No parity claim follows from resource coverage alone.

## Rust allocation probe

`scripts/measure_adblock_heap.py` builds an isolated release-mode allocation
counter around the same wrapper and default list groups. The default generation
owned **9,878,274 requested bytes** cold and **10,939,286 bytes (10.43 MiB)**
after a fixed request/cosmetic workload. Replacing the generation returned to
exactly 10,939,286 bytes. Building peaked at 38,130,213 bytes; building a
replacement while retaining the old generation peaked at 48,706,740 bytes
(46.45 MiB). After dropping both generations, 415,609 bytes of lazy library
state remained relative to the pre-load baseline.

These are requested live Rust allocation bytes. They exclude allocator-reserved
pages, C++ staging and IPC buffers, thread stacks and V8 helpers; realloc may
have allocator-internal transient copies. They support engine ownership and
replacement behavior, and do not alone establish the complete browser-owned
32 MiB budget. The browser benchmark records process-tree RSS separately. The [raw allocation
results](adblock-evidence/2026-11-02-engine-heap.json) include the command and
measurement limits.
