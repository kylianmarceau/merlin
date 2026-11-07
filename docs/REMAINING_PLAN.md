# Remaining browser plan — 2026-11-03

Merlin has the planned browser feature set and a working native Brave-engine
integration. The next milestone is a qualified, installable GitHub beta with
protection enabled by default. Release engineering and acceptance remain;
another broad feature or visual redesign is not required.

This review follows the blocker qualification merge at `556e62f` and includes
the existing working-tree address/accessibility/tooling corrections. It
supersedes the *remaining-work assessment* in the earlier November 2/3 reviews
where the later qualification or working-tree fixes have closed an item.
Historical results retain their original dates and limitations.

## Review scope and verification

Reviewed the repository's implementation layers, Cargo/GN wiring, upstream
patch boundaries, scripts, all 25 Markdown instruction/documentation/planning
files present at the start (including ignored `notes/`), the configuration
example, and retained qualification records. Deeper tracing covered URL entry,
editor/document lifetimes, workspace persistence, private-window boundaries,
browserctl, native request/worker/cache policy, filter updates and distribution.
This is a repository-wide readiness review, not a line-by-line audit of the
external Chromium/Brave codebases or certification of untested macOS journeys.

Fresh checks during this review:

- `scripts/check.sh`: passed, including formatting, warnings-denied Clippy,
  **253 workspace tests**, **11 tooling regressions**, four identity-boundary
  tests, page/measurement scripts, bundled-data integrity and all **45 patches**.
- Chromium checkout HEAD matches `UPSTREAM_PIN` exactly. The live upstream
  checker returned `status: current`, exit 0, for Mac Stable
  **157.0.8103.26**, commit
  `4c20950d2f187a6976cf5e2a1234ca896dcdfd1c`.
- `autoninja -n chrome browser_tests`: succeeded with **zero build steps**.
  This verifies build-graph freshness; it is not a clean rebuild.
- UI, browser-blocker and renderer-blocker GN dependency checks passed.
- Applied Chromium presentation/name/artwork/DevTools audits and all eleven
  documented generated-token/presentation `--check` commands passed.
- Patch installer against the actual checkout: **45 already applied**, zero
  files would change.
- All **94 retained screenshot digests** match their manifest. Seven of the
  128 recorded source files differ because of the existing address/tooling
  follow-up. Those captures remain historical evidence, not newly captured
  evidence for the follow-up.
- Full default browser run completed without failures in **967 seconds**:
  **139 launcher SUCCESS statuses** (77 modal, 46 blocker, 16 identity).
  Gtest skipped the optional snapshot capture because no output directory was
  set. A separate explicit snapshot run then **passed**, producing **14 PNGs**;
  representative command-line, dark tab-palette and hint captures were inspected.
  Across the two runs, all **139 distinct selected browser cases executed and
  passed**. Retries were disabled. The 136 upstream browser/view/command/Find,
  21 worker/extension and 35 loader results remain retained historical evidence;
  those groups were not freshly rerun here.

The first sandboxed repository-check attempt could not bind its temporary Unix
socket. The complete check passed outside that restriction. Test profiles,
configuration/workspaces and sockets are isolated. No everyday profile,
account sign-in, OS authorization or device access was used in this review.
No application implementation was changed, release build produced or package
published. The pre-existing working-tree changes were preserved.

Local review logs use `/tmp/merlin-current-plan-*`.

## Already complete

| Plan area | Present implementation |
| --- | --- |
| Foundation and keyboard-first browser | Rust session/action architecture, CXX bridge, portable C++ harness, six modes, counts, mappings/aliases, config, hints across frames/open shadow roots, command/tab/list palettes, find, clipboard, marks and macros |
| Daily-driver/developer bridge | Splits, pins, windows/profiles, workspace save/restore/autosave/lazy loading/project lookup, browserctl and guarded external editing |
| Structured document browsing | Outline/folding, heading/code/table motions, links, Markdown/text extraction, Visual selection and Reading mode |
| Browser shell and identity | Merlin tabs/sidebar/groups/dragging, hidden tabs, address card/suggestions, start/Settings/library pages, page colours and shared native/WebUI/DevTools presentation |
| Earlier safety corrections | Editor generation/document guards and private-export restrictions; colour cache/contrast; site controls, capture indicators/stop actions, Private label; workspace project handoff |
| Chromium update | The 157 pin is built, tested historically, current in the fresh live check and matches the local checkout |
| Native blocker implementation | Brave `adblock` 0.13.3; request/redirect/worker/socket/cache integration, early scriptlets, cosmetics, popup filtering, offline lists/resources, validated updates, profile/site controls and private isolation |
| Latest address/tooling fixes | Address-card internal aliases, accessible suggestion options/actions/active descendant, identity suite in the default runner and exact Stable version/commit checking |

The original phases 1–4 are implemented. Phase 5's beta/distribution gates
remain. The identity implementation is present, with sampled runtime evidence;
the full manual state matrix remains open.

## Blocker work the latest merge has already closed

Do not repeat these as wholly missing work:

- **Memory and update measurements:** browser/renderer native allocations and
  V8 were measured at 1/10/30 tabs, with close-to-one, six configuration
  replacements and repeated navigation. The conservative 30-tab live allocation
  estimate is **27.415 MiB**. A separate unprofiled macOS run measured physical
  overhead of **57.50 / 43.95 / 37.84 MiB**. These are different metrics;
  there is no 32 MiB total-RAM pass.
- **Actual online refresh:** the comment-only Brave source minimum was fixed;
  all 18 approved sources installed, and all 64 fixture ad requests remained
  blocked. Observed browser-attributed live memory peaked at **60.28 MiB** and
  settled to **10.07 MiB**. The sampled peak is a lower bound.
- **Local latency investigation:** cosmetic batching was improved; 360 retained
  loads across ten profile pairs passed the explicitly revised development
  paint budget. Median paint deltas were **0–12 ms**. The original
  percentage-only clean-page target did **not** pass; load-event regressions
  remain recorded. The revised development budget is not release qualification.
- **Additional YouTube conditions:** signed-in non-Premium off/on comparison,
  an observed unprotected mid-roll opportunity, a separate completed 15-minute
  protected run, and maintainer-confirmed player controls are recorded. Earlier
  normal/private, SPA, playlist/autoplay, Shorts transitions and permitted-embed
  evidence remains useful. Interrupted runs and controls without mid-rolls
  are explicitly distinguished from accepted runs.
- **Native regression checkpoint:** the retained complete qualification run
  passed **46/46** blocker cases.

See [the qualification record](ADBLOCK_QUALIFICATION.md). This is Merlin's
integration of Brave's engine, not the complete Brave Shields product.

## Remaining work, in execution order

### 1. Make the distribution build reproducible

- [x] *(2026-11-04: `scripts/build_release.sh`; args gain `chrome_pgo_phase = 0` and pass `gn gen`.)* Supply a working release-build helper or copy procedure. The current
  `build/args.release.gn` example imports `//build/args.release.gn`, but the
  overlay installer does not put that file in Chromium's `build/` directory.
  Only `out/Modal` currently has an args file.
- [ ] Validate the release args against the current pin and build the optimized
  non-component app. Preserve exact source/pin/args, version/build identity and
  matching symbols/build IDs.
- [x] *(2026-11-04: `io.github.kylianmarceau.merlin`.)* Deliberately settle the application bundle identity, previously
  `local.merlin.Merlin`, and keep it and the Merlin profile location stable.
  A purchased domain is not a technical prerequisite.
- [x] *(Committed before 2026-11-04.)* Commit the intended existing address/accessibility/tooling additions,
  including the untracked tooling regression file, before tagging a release.
  The local build uses those live overlay files; HEAD alone omits them.

Done when a documented clean-checkout procedure produces the selected app
without depending on undocumented local setup.

### 2. Close default-protection gates on that build

*(2026-11-05: the maintainer turned the feature on by default before these
gates closed — [decision 46](DECISIONS.md#46-ad-blocking-on-by-default). The
checks below remain useful acceptance work.)*

- [ ] Compare the same release binary on/off with fixed lists and isolated
  profiles: startup, clean/ad-heavy fixtures, broader real sites and YouTube.
  Retain paired raw measurements, median/p95, CPU/memory and build identity.
- [ ] Review release results against a stated budget. Carry forward the
  distinction between owned live allocations, physical memory and update peaks;
  explicitly accept or revise measured budgets before default enablement.
- [ ] Exercise real login/OAuth, legitimate popup, payment-form (without a
  purchase), upload/download and site-exception recovery journeys.
- [ ] Review the **1,061 unsupported rules by compatibility impact**. Their
  syntax categories are already counted; resolve important gaps or document
  the supported boundary. Full uBlock/Brave syntax parity is not established.
- [ ] Record remaining scope limits, including Shorts-specific ad eligibility
  and native control/accessibility acceptance. Signed-in playback and an
  observed mid-roll comparison are already covered for the recorded conditions.
- [ ] After the gates pass, change the feature default and verify fresh-profile
  protection, global/site toggles, offline startup, update/rollback and the
  independent kill switch in the final binary.

This closes the release baseline in blocker milestone 0, real-flow acceptance
in milestone 4 and the remaining release/default-enablement gate in milestone 6.
Milestone 5's supported live playback matrix has evidence; do not relabel it as
untested. An explicitly opt-in preview is possible, but does not complete the
planned default-protected release.

### 3. Finish active-window and macOS acceptance

- [ ] Real keyboard/focus and Japanese/other IME in the address card, palette
  and page fields; VoiceOver on suggestions, palette/outline, tabs and Settings.
- [ ] Narrow/light/dark/private/high-contrast states, zoomed iframe hints,
  groups/cross-window dragging, hidden tabs, splits and fullscreen.
- [ ] Real camera/microphone/screen/tab sharing, OS permissions, cancellation
  and stop actions; passwords/autofill, Touch ID/Keychain/passkeys and available
  hardware/device chooser journeys.
- [ ] Password-manager extension, Dark Reader, uBlock Origin Lite, Vimium
  coexistence and MV3 worker/shortcut/permission/install journeys. Existing
  synthetic content-script/interceptor tests do not replace that matrix.
- [ ] Clean quit, force quit/recovery, multiple windows/profiles, uploads,
  downloads/PDFs and replacement-update retention of profile/config/workspaces.
- [ ] Warning/error/recovery variants and effective Safe Browsing behavior in
  the distribution build. A rendered warning fixture does not establish
  functioning API-dependent threat protection; publish measured limitations.

Use [the manual identity sheet](visual-identity-evidence/MANUAL_CHECKS.md),
[the smoke plan](TESTING.md) and [the extension matrix](../notes/BETA.md).
Record unavailable hardware/account states explicitly. Existing identity
captures qualify sampled states, not every family in the source inventory.

### 4. Finish notices, privacy and current-status documentation

- [x] *(2026-11-04: added.)* Add the intended root `LICENSE`; Cargo declares BSD-3-Clause and source
  headers refer to the file, but it is absent.
- [ ] Generate/review notices for the actual release graph and ship them in
  the artifact: Chromium, Rust dependencies, lists and executable resources.
  The blocker notice/bundle generators exist; they are not wired into a tested
  release package. Complete the independent reviews retained in the beta plan.
- [ ] Add Settings' `config.toml` writes to `PRIVACY.md`'s files-written table
  and correct decision 14's obsolete read-only statement.
- [ ] Point historical planning toward current status. Old rebase, shell,
  branding, memory/YouTube TODOs, patch/test counts and GN `UNVERIFIED`
  comments should not be mistaken for current requirements.
- [ ] Publish supported macOS/arm64 requirements and clear limitations: no
  Google Sync, Netflix (unsigned Widevine) or binary auto-updater; extension
  installation limitations; measured API-dependent protection limitations.

### 5. Make security delivery operational

- [ ] Assign release/security ownership, schedule Stable checks, produce
  versioned GitHub artifacts and establish how every tester hears of updates.
- [ ] Exercise the documented turnaround: within three days for Stable security
  releases and 24 hours for exploited-in-the-wild fixes. Manual delivery is
  acceptable for the selected invited beta if it is dependable.
- [ ] Repeat blocker content/Blink/worker/cache tests and presentation audits
  on Chromium updates. The maintenance surface is now 45 patches, rather than
  the original three UI hooks. No in-repo CI/release workflow currently
  automates this process.

The current Chromium update is complete; ongoing security delivery is a
separate operational requirement.

### 6. Package, install-test and publish the GitHub beta

- [x] *(2026-11-04: replaced with ad-hoc signing, DMG, checksum, build info and dSYMs; tried on the dev build.)* Replace/adapt `scripts/package_mac.sh`: its default only prints a dry
  run, while its execution path still requires Developer ID/notary credentials
  and uses the obsolete signing prototype. It does not package the chosen
  release scope.
- [ ] Package an explicitly selected fresh non-component build into a versioned
  archive/DMG, including notices and build metadata; generate SHA-256 checksums
  and retain matching diagnostic symbols.
- [ ] Test a browser-downloaded/quarantined artifact on another Mac: install,
  per-app Open Anyway approval, launch/helpers/renderers, permissions, relaunch,
  replacement update and retention of user data.
- [ ] Publish a versioned GitHub beta with requirements, limitations,
  installation/update steps, checksums and an issue/security contact.

Follow [the release policy](RELEASE.md): paid Apple membership, Developer ID,
notarization and stapling are deliberately excluded. Free ad-hoc signing where
needed for Apple Silicon execution is compatible with this scope.

## Later work, outside the first-beta gate

Permissioned scripting/plugins (`:script` is still explicitly planned),
site-specific keymaps, persistent marks, cross-frame outline/extraction, richer
address special rows/keyword chips, address-inside-active-tab redesign step 7b,
horizontal tab scrolling, whole-group dragging, fullscreen drop targets,
bundled browserctl and a binary updater can follow. Porting Cargo fixtures to
Chromium gtest is integration work; those tests already run under Cargo.

Windows/Linux/Intel, Google Sync, DRM/proprietary codecs and complete Brave
Shields parity are product-scope decisions, not prerequisites for the chosen
macOS arm64 release. Branding's historical tagline/name-check list is separate
product housekeeping, not missing browser functionality.
