# Native ad blocking implementation plan

Status: native implementation is present; follow-up qualification on
`feature/adblock-qualification` passed 46 native tests, measured full browser
live allocations, physical footprint and real online-update peaks, and covered
signed-in playback, observed mid-roll conditions and maintainer-confirmed player
controls. Clean-page overhead is bounded under an explicitly revised development
paint budget; the original percentage-only gate did not pass. The feature
remains opt-in. See the [current qualification record](ADBLOCK_QUALIFICATION.md)
and [implementation evidence](ADBLOCK_IMPLEMENTATION.md).
The maintainer clarified on 2026-11-02 that packaging and publication are
outside this task; the implementation and tests remain in scope.
Written 2026-11-01 against the repository's current overlay architecture.

Historical release scope, updated 2026-11-02 (deferred from this task): complete implementation and qualification
for GitHub Releases without a paid Apple account. Developer ID signing and
Apple notarization are intentionally excluded, not release gates. Follow
[Release](RELEASE.md) for packaging and unnotarized installation acceptance.

## Outcome

Embed [Brave's adblock-rust engine](https://github.com/brave/adblock-rust)
directly into Merlin. Block ads and trackers before they load, hide remaining
ad elements, prevent unwanted pop-ups, and support ad-free YouTube playback.
Users should get protection by default, a straightforward exception for a
broken site, and automatic filter updates without rebuilding the browser.

YouTube is a first-release acceptance requirement. A network-only prototype
is an intermediate milestone, not completion of this plan. Matching Brave's
experience requires compatible lists, resources, scriptlets, and browser
hooks as well as its Rust library. No implementation can promise that every
ad stays blocked forever: YouTube changes will require maintenance.

This adds an independent native feature. It must work with modal browsing
disabled, without an extension, and without depending on Manifest V3 APIs.
Brave Rewards, accounts, telemetry, and the rest of Shields are outside scope.
Creator sponsorships embedded in video content are also outside scope.

## Starting point and update boundary

Merlin currently has no native general-purpose blocker. The existing Rust
core is deliberately dependency-free; the `cxx` bridge and GN targets provide
an interop pattern, not an ad-blocking implementation. See
[Architecture](ARCHITECTURE.md), [the core manifest](../overlay/components/modal_browser/core/Cargo.toml),
and [the bridge target](../overlay/components/modal_browser/ffi/BUILD.gn).

The current `UPSTREAM_PIN` names Chromium 157.0.8103.26. That is context, not
a claim that the ongoing update has finished building or passed regression
tests. Finish the [Chromium update gates](CHROMIUM_UPDATE.md) first and record
the actual baseline. Do not change the pin, reset the checkout, reapply the
overlay, or run a competing build as part of preparing this plan.

Implement against the resulting tested pin on a separate feature branch.
Keep upstream hooks in individually reviewable patches and Merlin code in
the overlay. Allocate patch numbers after the update settles. Do not vendor
an entire Brave browser fork or modify the engine unless an identified
compatibility problem requires it.

## Component layout

Proposed paths; create them during implementation, not as empty scaffolding.

| Path | Responsibility |
|---|---|
| `overlay/components/merlin_adblock/core/` | Rust engine wrapper, typed request/results, cache-format handling and unit tests; Cargo and GN targets |
| `overlay/components/merlin_adblock/ffi/` | Dedicated `cxx` bridge, independent of the modal session |
| `overlay/components/merlin_adblock/common/` | Shared feature declarations and browser/renderer Mojo messages |
| `overlay/components/merlin_adblock/resources/` | Packaged initial lists, resource bundle, provenance and version manifest |
| `overlay/chrome/browser/merlin_adblock/` | Profile service, request interception, preferences, list updater and browser tests |
| `overlay/chrome/renderer/merlin_adblock/` | Per-frame early injection, cosmetic filtering and bounded DOM observation |
| Existing Merlin settings, toolbar and command files | Thin controls that call the profile service |
| `scripts/` | Reproducible dependency/resource preparation and performance measurement |
| `patches/` | GN dependencies and minimal browser/renderer integration points |

Extend `scripts/apply_overlay.sh` to link the new overlay directories.
Keep browser and renderer targets separate and below the Views UI layer;
`ChromeContentBrowserClient` must not depend on the full modal UI target.
Add the Rust crates to the local Cargo workspace for fast testing, while
preserving GN as the actual browser build.

## Runtime design

### Ownership and threading

Use a profile-keyed C++ service for settings, exceptions, readiness and
counts. A separate evaluator owns Rust engines on dedicated sequences;
the browser UI thread must not parse lists or synchronously wait for rule
matching. Share an engine between consumers with identical rule/resource
configuration where safe; do not construct an engine per tab. Different
profile configurations must not overwrite each other's engine state.

Start with a single evaluator sequence per distinct configuration. Upstream's
default `single-thread` feature makes `Engine` unsuitable for transfer or
shared access across threads. Construct, use and destroy it on its owning
sequence. An off-sequence builder can hand over validated serialized bytes,
not a live non-`Send` engine. Benchmark contention before introducing evaluator
replicas or disabling that feature; either choice changes the memory budget.

Rebuild rules away from the active matching sequence and install a complete
new generation atomically. Include engine version, selected lists, resource
version and relevant policy in the cache identity. Do not assume serialized
engines remain compatible after a library upgrade. Release superseded
generations once outstanding requests finish; bound build/update concurrency.

Model readiness explicitly: disabled, initializing, ready, or degraded.
Load a validated cached or bundled generation before protected page requests
are released; never wait for an online download at startup. Bound startup
waiting. If no usable generation exists, allow browsing, expose the degraded
state, and recover without leaving requests suspended. An update failure
keeps the previous working generation active.

### Browser requests and context

The checked Chromium header exposes `WillCreateURLLoaderFactory`,
`CreateURLLoaderThrottles`, `WillInterceptWebSocket`/`CreateWebSocket`, and
`WillCreateWebTransport`. Treat them as integration candidates, not proof
that one hook covers every request path.

Prefer a browser-owned URLLoaderFactory interceptor for document and worker
HTTP(S) traffic, subject to the coverage spike below. Install it once at
factory creation and perform request checks off the UI thread. Use Chromium's
supported factory composition; preserve extension interceptors, redirect
checks, CORS, cookies, sandboxing and Safe Browsing. Never set security bypass
flags merely to make filtering work. Add complementary hooks only for paths
that the tested factory design does not cover.

Pass the engine the canonical request URL, source context, HTTP method and
correct resource type. Keep the initiating frame origin distinct from the
top-level site: the former affects filter semantics; the latter selects the
user's site exception. Derive context from browser-owned frame/worker state,
not a renderer-provided page URL. Recheck every redirect and relevant URL
rewrite; bound replacement loops.

Worker factories can lack a frame. Preserve worker ownership and storage
partition identity. For shared/service workers with multiple clients, define
and test a deterministic exception policy; never assign an arbitrary active
tab as their source. Handle opaque and inherited origins deliberately.

Support typed allow, block, replacement-resource and URL-rewrite results.
Cancel blocked loads with the appropriate Chromium blocked-client error.
Serve replacements with correct MIME types and preserve browser security
checks. Audit CSP and other rule modifiers used by the selected lists; either
implement their semantics or record the coverage gap before enabling them.
Do not silently reduce every engine result to a boolean.

Limit the initial request policy to web traffic. Preserve internal Merlin/
Chromium pages, DevTools, extension resources, downloads, and browser-owned
services through explicit tested policies. Do not block all top-level
navigations using subresource rules; strict document blocking needs a
separate navigation policy and recovery UI if added later.

### Renderer filtering and scriptlets

Get per-document CSS, exceptions and scriptlet configuration to the renderer
before page scripts execute. Prove the ordering using a page whose first
inline script observes a hooked API. Sending JavaScript from the browser
after page load, as some current modal actions do, is too late.

Use renderer lifecycle hooks for document creation and script contexts, with
an explicit document-token/generation handshake. Discard stale messages and
clean up on navigation and frame destruction. Use an isolated world for
helpers where appropriate; scriptlets that patch page APIs need the correct
main-world execution path. Preserve the site's actual CSP and the sandbox;
do not globally relax either to inject scripts.

Apply domain-specific cosmetic CSS early. Batch and deduplicate newly seen
classes/IDs for generic selectors; bound observers, queues, and caches rather
than repeatedly scanning the whole page. Audit procedural cosmetic syntax
in the chosen lists and implement required behavior or report the limitation.
Cover cross-process iframes, `about:blank`/`srcdoc` origin inheritance, dynamic
content, same-document navigation, prerender activation and back/forward cache.

Treat scriptlets and replacements as a versioned trusted resource bundle.
Preserve upstream resource aliases, dependencies, execution-world metadata
and trust permissions. Third-party/custom rules must not acquire trusted
scriptlet permissions automatically. Do not execute arbitrary remote script
URLs specified by a list.

## Ordered implementation milestones

Each milestone ends in a reviewable commit or PR with its own validation.
Keep the feature disabled by default during development; enable it for users
only after milestone 6 passes.

### 0. Establish the baseline and prove the hooks

- [x] Complete the Chromium update and record build/test results and pin.
- [ ] Record current release-build startup, page-load and process-tree memory
  baselines on the development Mac, including YouTube playback.
- [x] Spike a single blocked local HTTP resource and an early main-world
  scriptlet using the actual pinned APIs. Include an out-of-process iframe.
- [x] Build a coverage matrix for document requests, redirect targets, fetch/
  XHR, images/scripts/media, dedicated/shared/service workers, keepalive/
  beacon, prefetch/early hints, WebSockets and WebTransport.
- [x] Test HTTP cache and service-worker-cached/synthetic responses explicitly;
  factory interception of outgoing network traffic alone may miss these.
  Document which paths need an additional loader/renderer hook.
- [x] Resolve worker exception semantics, interceptor ordering, and how
  configuration reaches the renderer before its first page script.

Exit: a short recorded design decision, compiling hook prototypes and local
tests proving request cancellation and injection timing. Do not proceed on
the assumption that a navigation throttle blocks subresources.

### 1. Embed and build the engine

- [x] Select and pin an upstream release/commit; `adblock` 0.13.5 is the
  research starting point as of this plan, not a floating dependency.
- [x] Audit the transitive dependency/feature graph against the resulting
  Chromium Rust toolchain. Match Cargo's `cxx` version to Chromium's vendor.
- [x] Vendor missing crates with Chromium's Rust dependency tooling and
  generate the corresponding GN targets. Keep preparation reproducible from
  this overlay repo, including lockfiles/checksums and required metadata.
- [x] Build a small Rust API for constructing/loading a generation, checking
  requests, retrieving cosmetic data, and installing approved resources.
  Use typed `cxx` results and validate incoming enums/strings.
- [x] Decide domain resolution explicitly: retain the embedded resolver for
  the spike or connect Chromium's public-suffix implementation. If disabling
  `embedded-domain-resolver`, install and test the external resolver first.
- [x] Add rule fixtures for domain/type/method/third-party matching,
  exceptions, important rules, redirects, rewrites, cosmetics, scriptlets,
  malformed input and serialized-cache incompatibility.
- [x] Record engine, list and resource license/notice requirements per source;
  preserve upstream notices and provenance in the distribution metadata.

Exit: both Cargo tests and a real GN-linked Merlin build exercise the same
wrapper. A successful Cargo build alone does not complete this milestone.

### 2. Add native network blocking and basic recovery

- [x] Implement the profile service, evaluator ownership and interception
  selected in milestone 0, including redirects and worker lifecycle handling.
- [x] Add dedicated WebSocket checks and resolve WebTransport coverage/type
  mapping; preserve allowed handshakes and close blocked ones correctly.
- [x] Add bounded cancellation, shutdown and disconnect behavior: no hanging
  requests after tab close, profile destruction or Network Service restart.
- [x] Provide a feature kill switch plus global and per-site toggles before
  trialing real lists. The feature remains active when modal keys are off.
- [x] Count blocked requests per document in memory; do not double-count a
  request at multiple interception points or retain browsing history.
- [x] Test exceptions across subframes and attributable workers, opaque
  origins, two profiles, private windows and simultaneous navigations.

Exit: deterministic local tests prove blocked requests do not reach the
server and allowed requests still load. Network-only blocking is available
for development, clearly identified as incomplete.

### 3. Ship lists, resources and reliable updates

- [x] Choose the initial list set from EasyList/EasyPrivacy plus vetted
  uBlock/Brave fixes and unbreak rules required for compatibility and YouTube.
  Use Brave's current catalog as a reference, not an instruction to enable
  every list. Keep broad annoyance/cookie filtering optional.
- [x] Pin a compatible resource bundle from the applicable upstream projects.
  Check actual resource coverage; `brave/adblock-resources` alone must not be
  assumed to include every community scriptlet referenced by the lists.
- [x] Package a tested initial rules/resource generation with the app for
  offline first launch. Store update data in an explicit application cache,
  with bounded storage and no page URLs or private browsing records.
- [x] Add a manifest identifying each source, revision, digest, permissions,
  resource compatibility, retrieval time and licensing metadata.
- [x] Use Chromium's networking for updates without cookies or referrers.
  Document HTTPS endpoints and host visibility; never upload visited URLs.
- [x] Refresh in the background on a proposed six-hour schedule with jitter,
  respecting source expiry/rate limits, backoff and manual refresh. List
  checks are independent of browser binary updates and are user-controllable.
- [x] Validate size/format, resource references and rule-count anomalies;
  verify published integrity metadata where available. Hashes delivered over
  the same channel are not a substitute for authenticated update delivery.
- [x] Deliver executable resource-bundle updates as signed, versioned Merlin
  components with a pinned verification key and defined key rotation; until
  that path exists, update executable resources only through app releases.
  Source lists can select only resources permitted by their trust level.
- [x] Stage, test and atomically publish a new generation. Keep the previous
  working generation for rollback; reject incompatible/corrupt caches and
  fall back to valid bundled data without waiting for the network.

Exit: tests cover offline startup, failed/interrupted downloads, malformed
lists, incompatible resources, failed signature verification and rollback.
The old engine continues blocking while a replacement is prepared.

### 4. Add cosmetics, scriptlets and unwanted pop-up blocking

- [x] Implement document-start configuration delivery, CSS and resource
  execution with the lifecycle rules above. Test that execution precedes the
  first inline page script, including on redirects and cross-site frames.
- [x] Add bounded dynamic cosmetic filtering and SPA handling; test repeated

  updates, detached frames, navigation cancellation and cache restoration.
- [x] Use Chromium's existing pop-up permission machinery as the baseline.
  Add list-backed pop-up/pop-under decisions at the creation/navigation hook
  before unwanted windows appear, including click-triggered ad destinations.
- [ ] Preserve legitimate user navigation, sign-in, payment and download
  flows. Give users a per-site recovery option rather than blocking every
  `window.open` call or every redirect.
- [x] Check that disabling protection takes effect for new requests and that
  a reload removes previously injected page hooks. Do not promise to safely
  undo all scriptlet side effects in an already running document.

Exit: local fixtures verify CSS exceptions, resource substitutions, scriptlet
timing and permissions, unwanted window prevention and allowed login windows.

### 5. Finish user controls and qualify YouTube

- [x] Add an ad-blocking section to Merlin Settings: global toggle, enabled
  lists, update state/time, manual refresh, exceptions and degraded status.
- [x] Add a compact site control with this-document blocked count and an
  enable/disable action. Explain when reload is required.
- [x] Add proposed `:adblock on`, `:adblock off`, `:adblock site toggle`,
  `:adblock status` and `:adblock update` commands through the existing
  command/action path. `browserctl command` inherits them for normal windows;
  existing private-window restrictions remain in force.
- [x] Keep site preferences profile-scoped; default exceptions apply to the
  exact top-level hostname, not unrelated subdomains. Private windows may
  read existing settings but keep their new exceptions/counts in memory and
  never expose their activity through browserctl or logs.
- [x] Run the YouTube matrix below and fix gaps in resource support, timing
  or lists. Keep temporary site fixes in versioned data where possible,
  rather than scattering hard-coded YouTube branches through C++.
- [x] Record dated manual results against current Brave with its version and
  list state. Do not infer parity from sharing a library or seeing one video
  play without an ad.

Dated evidence covers protected normal/private playback, an ad-eligible
unprotected control, longer playback, SPA navigation, playlist/autoplay, Shorts
transitions, permitted embeds and foreground controls. Official Brave version
and end-of-session component state are retained from November 2. The
[November 3 follow-up](ADBLOCK_QUALIFICATION.md) adds a maintainer-controlled
non-Premium signed-in comparison, an actually observed mid-roll opportunity,
a completed 15-minute protected run and maintainer-confirmed seeking, captions,
fullscreen/exit and Picture-in-Picture/return. The supported test conditions are
qualified, not every route/account combination. Shorts-specific ad eligibility
and general Brave parity are not established; interrupted and no-mid-roll
controls are explicitly distinguished from completed accepted runs. No
distribution work was performed.

YouTube qualification covers signed-out and signed-in non-Premium sessions
(using a maintainer-controlled account when available), normal and private
windows, direct loads and in-site SPA navigation, playlists/autoplay, Shorts,
embedded players, pre-roll and longer playback that can exercise mid-rolls.
Check banners, anti-adblock interstitials, stalled playback, seeking, captions,
fullscreen and picture-in-picture. Ads vary by account, region and experiment;
record the conditions and use an unblocked control to establish that the
session was eligible to receive ads. Report untested cases explicitly.

Use stable local player-like fixtures in automated tests for request and
scriptlet behavior. Live YouTube checks supplement them; they must not be
required on every CI run or store account credentials in fixtures.

Exit: settings and commands work, private state stays private, and the dated
YouTube matrix passes for the supported test conditions. Describe this as
tested ad blocking, not a guarantee of permanently zero ads.

### 6. Measure, release and maintain

- [ ] Compare the same release build with the native feature on/off, keeping
  profiles, lists, page content, warm/cold cache and hardware conditions fixed.
  Include clean local pages, ad-heavy fixtures, real sites and YouTube.
- [x] Run at least ten paired trials for startup and page loading; record
  median/p95, blocked/transferred bytes, CPU and process-tree memory. Trace
  hot paths so IPC/queue delay is included, not only Rust matching time.
- [x] Measure incremental idle memory and 1/10/30-tab totals, update peak
  memory, repeated navigations, DOM observation and evaluator contention.
  Verify full rulesets are not duplicated per tab and caches stop growing.
- [ ] Use provisional performance gates: no more than 5% median or 10% p95
  clean-page load regression; no more than 100 ms median warm-start overhead;
  and default-list blocker-owned steady memory within 32 MiB per distinct
  evaluator configuration. These are engineering targets, not current results.
  Establish measurement noise in milestone 0 and record any justified budget
  changes before enabling the default. Report update peaks separately.
  Follow-up result: the original percentage-only target did not pass. The
  documented component-build budget uses a one-frame median / two-frame p95
  absolute floor (16.7 / 33.4 ms) alongside 5% / 10%; all six final clean-page
  cases passed that revision. At 30 tabs, the conservative live allocation
  estimate is 27.415 MiB. Unprofiled physical overhead is higher (37.84–57.50 MiB
  across the measured checkpoints), so this is not a 32 MiB total-RAM pass.
  Real online update observed 60.28 MiB live-attributed peak and 10.07 MiB after.
  Keep this combined release/default-enablement gate open; the follow-up is
  local qualification, not release-build or broad real-site acceptance.
  Performance pass, 2026-11-04: the request proxy moved off the UI thread, the
  renderer per-request main-thread hop and repeating cosmetic timer were
  removed, and startup no longer reads list text. Realistic clean-page load
  cost fell from +13.6 to +3.7 ms median (DOMContentLoaded +3.5 ms, first
  paint no slower). One-tab overhead fell from +45.8 to +21.9 MiB, and 10-tab
  idle CPU returned to the blocker-off level. Development-build Rust debug
  assertions slow matching about 17×, so a release-build measurement is the
  remaining evidence for this gate.
- [x] Run Rust/bridge tests, new deterministic browser/renderer tests, Merlin's
  existing suite and relevant upstream navigation/worker/extension tests.
  Test engine failure, profile shutdown and Network Service restart.
- [x] Extend `scripts/check.sh` and browser-test selection for the new suites.
  The current browser runner defaults to `ModalBrowserBrowserTest.*` and adds
  upstream-default flags for other filters: explicitly wire the new suite so
  the feature is exercised, not accidentally disabled or skipped.
- [x] Update README, Architecture, Privacy, Testing, configuration examples
  and release notes. Replace the current claim that Merlin's layer makes no
  network requests with the exact list/component update behavior and controls.
- [ ] Enable the feature by default only after correctness, YouTube,
  performance, update-integrity and recovery gates pass. Retain a local kill
  switch and the ability to roll back a bad rules generation.

Exit: native protection ships with measured costs, a usable site exception,
offline defaults, a working updater and reproducible regression coverage.

After release, check upstream engine/resource compatibility on each upgrade,
triage site-breakage and YouTube reports, and repeat hook coverage tests on
every Chromium pin change. Serve small list fixes independently of binary
releases when possible; runtime/API changes still require a browser release.

## First implementation task

After the Chromium update passes, implement milestone 0 and the smallest
GN-linked engine spike in milestone 1. Prove both native request cancellation
and injection before the first page script before investing in the full UI.
Keep all milestone checkboxes open until the corresponding evidence exists.

## Upstream references

Research checked 2026-11-01. Recheck API and list revisions when implementing.

- [adblock-rust](https://github.com/brave/adblock-rust) and
  [versioned Engine API](https://docs.rs/adblock/0.13.5/adblock/engine/struct.Engine.html):
  network/cosmetic/resource interfaces and threading feature choices.
- [Engine implementation](https://github.com/brave/adblock-rust/blob/master/src/engine.rs):
  resource installation, per-URL cosmetics and generation replacement.
- [Brave lists](https://github.com/brave/adblock-lists): community-list usage
  and Brave-specific fixes.
- [Brave resources and catalog](https://github.com/brave/adblock-resources):
  scriptlet/resource metadata, list sources and trust permissions.
- [Brave's YouTube maintenance example](https://brave.com/whats-new/android-youtube-improvements/):
  why ongoing compatibility fixes are part of the work.
- [Brave engine benchmark](https://github.com/brave/brave-browser/issues/57042):
  useful engine measurements, not a forecast of Merlin's total memory.

For integration APIs, inspect the tested Chromium checkout's
`content/public/browser/content_browser_client.h`,
`chrome/browser/chrome_content_browser_client.{h,cc}`,
`content/public/renderer/render_frame_observer.h`, and its Rust dependency
tooling/docs. Local prototypes and tests must verify the selected hooks.
