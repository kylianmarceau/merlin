# Performance baseline

How fast Merlin starts, loads pages, opens and switches tabs, how much
memory it uses and how responsive it is, against Brave and Dia. Use it as
the reference point for optimization work: rerun the same benchmark after a
change and compare.

## Latest — 2026-11-06, release build with PGO and ad blocking on

The first release build with profile-guided optimization, ad blocking on by
default and search prewarm off, measured against the baseline below. Same
Mac, after a macOS update, on mains power. Only Merlin was rerun; Brave and
Dia are the 2026-11-05 figures. Raw results are in
[performance-evidence/2026-11-06](performance-evidence/2026-11-06/summary.md).

| | Merlin 2026-11-06 | Merlin 2026-11-05 | Brave | Dia |
|---|---:|---:|---:|---:|
| Speedometer 3.1 (higher is better) | **42.8** (42.8, 43.0, 42.8) | 34.3 | 43.1 | 41.4 |
| Startup, existing profile | **0.54 s** | 0.51 s | 0.59 s | 3.7 s* |
| Startup, new profile | 0.78 s (0.56 s, blocker off) | 0.54 s | 0.57 s | – |
| Memory, idle | **275 MB** (258 MB, blocker off) | 261 MB | 295 MB | 1,024 MB* |
| Memory, 30 heavy tabs | 2,690 MB (2,342 MB, blocker off) | 2,538 MB | 3,034 MB | 4,126 MB* |
| Memory, after closing them | **485 MB** (865 MB, blocker off) | 485 MB | 1,203 MB | 1,620 MB* |
| Memory, 10 real sites | **1,899 MB** (2,871 MB, blocker off) | 2,625 MB | 2,369 MB | 3,128 MB* |
| Heavy test page, load event | 243 ms | 255 ms | 265 ms | **227 ms** |
| Real sites, median load event | **346 ms** | – | 439 ms | 508 ms |
| New tab with a page, to loaded | 74 ms | 67 ms | 80 ms | 212 ms† |
| Switch to a background tab | 26 ms | 25 ms | **11 ms** | – |

- **PGO closed the JavaScript gap:** Speedometer rose 25%, to Brave's
  score and ahead of Dia's, steady across three runs.
- **Ad blocking by default cut memory on real sites by a third** (1,899 MB
  vs 2,871 MB with it off) and makes Merlin lightest on real sites too.
- **A new profile's first launch costs about 220 ms more** with the blocker
  on (0.78 s vs 0.56 s); launches of an existing profile are unchanged.
  The likely cause is the blocker setting up its filter lists for the new
  profile.
- 30-tab memory moves with Memory Saver's timing (see below); it is within
  the spread of earlier runs.

## Baseline — 2026-11-05, Merlin 0.1.0-beta.1

MacBook with Apple M2 (8 cores) and 16 GB, macOS 27.0.1, on mains power.
Raw results and every table are in
[performance-evidence/2026-11-05](performance-evidence/2026-11-05/summary.md).

| | Merlin release | Brave 1.98.63 | Dia 1.55.1 | Merlin dev build |
|---|---:|---:|---:|---:|
| Chromium | 157.0.8103.26 | 156.0.8078.80 | 156.0.8078.74 | 157.0.8103.26 |
| Startup, existing profile | **0.51 s** | 0.59 s | 3.7 s* | 4.7 s |
| Speedometer 3.1 (higher is better) | 34.3 (33.5, 34.8, 34.7) | **43.1** (43.1, 43.1) | 41.4 | 7.3 |
| Memory, idle | **261 MB** | 295 MB | 1,024 MB* | 367 MB |
| Memory, 30 heavy tabs | **2,538 MB** | 3,034 MB | 4,126 MB* | 3,119 MB |
| Memory, after closing them | **485 MB** | 1,203 MB | 1,620 MB* | 1,131 MB |
| Memory, 10 real sites | 2,625 MB | 2,369 MB | 3,128 MB* | 2,427 MB |
| Memory, 10 real sites, Merlin ad blocking on | **1,846 MB** | | | |
| New tab with a page, to loaded | **67 ms** | 80 ms | 212 ms† | 69 ms |
| New tab page, to loaded | **50 ms** | 117 ms | – | 59 ms |
| Switch to a background tab, to first frame | 25 ms | **11 ms** | not measurable | 23 ms |
| Heavy test page, load event | 255 ms | 265 ms | **227 ms** | 379 ms |
| Real sites, median largest paint | 360 ms | **336 ms** | 408 ms | 387 ms |

Memory is the physical footprint of every process in the browser's tree.

\* Dia ran in the maintainer's everyday profile, with pinned Gmail, Slack,
Calendar and other tabs; its startup and memory include them. A new Dia
profile needs onboarding and an account, which the benchmark can't do.

† Dia's tab timings go through AppleScript; its measured per-command
overhead (42 ms) is subtracted, but they remain less precise than the
DevTools timings of the other browsers.

### What it shows

- **The release build fixed most of the dev build's slowness:** 9× faster
  startup, 4.7× the Speedometer score and lighter pages. The dev build's
  DCHECKs and component libraries cost that much; don't judge speed on it.
- **JavaScript and page responsiveness are about 20% behind Brave and Dia**
  on Speedometer, consistently across runs. The likely cause is that
  Merlin's release build has profile-guided optimization off
  (`chrome_pgo_phase = 0` in `build/args.release.gn`), and Brave and Dia
  ship with it. The native blocker's code is inactive when the feature is
  off, page-colour sampling is a cached 96-pixel copy of the active tab,
  and Energy Saver was not active.
- **Memory is Merlin's strength.** It uses the least memory idle and with
  many tabs, and returns it fastest after tabs close. Merlin turns on
  Memory Saver by default, so the 30-tab figure depends on when idle tabs
  are unloaded: a rerun with the blocker on measured 1,947 MB.
- **Ad-heavy sites favour Brave**, which blocks ads by default. BBC News's
  load event took 1.7 s in Merlin and 0.36 s in Brave; with Merlin's blocker
  on it took 0.54 s, and memory across 10 real sites fell 30%.
- **New tabs are fastest in Merlin.** The benchmark measured tab switching
  at 25 ms vs Brave's 11 ms, but a trace of eight switches in each browser
  (same pages, same window size) measured 10–28 ms in Merlin and 10–44 ms in
  Brave, with the same browser-side switch work (about 17 ms per switch).
  The difference is noise from the many-tab benchmark, not a Merlin cost.

### Optimization targets, by expected impact

1. **Profile-guided optimization — done; measured 2026-11-06.**
   `build/args.release.gn` uses Google's profile
   ([decision 45](DECISIONS.md#45-release-builds-use-pgo-no-search-prewarm)).
   Speedometer went from 34.3 to 42.8.
2. **Native ad blocking on by default — done; measured 2026-11-06**
   ([decision 46](DECISIONS.md#46-ad-blocking-on-by-default)): memory
   across 10 real sites fell a third. It adds about 220 ms to a new
   profile's first launch, which is worth a look.
3. **Search prewarm — off since 2026-11-05 (patch 0052).** The only
   Merlin-specific work in the tab-switch trace: a hidden Google page
   prerendered per tab, up to 11.5 ms of browser main-thread work each.
   Its memory effect could not be measured headless (the prewarm never
   starts there). The 2026-11-06 30-tab figure (2,342 MB with the blocker
   off, vs 2,538 MB) points to a small saving, but it is within Memory
   Saver's spread.

## Method

`scripts/benchmark_browsers.mjs` runs one browser through these steps,
writing a JSON file; `scripts/summarize_benchmarks.mjs` turns a folder of
them into the tables in `summary.md`.

| Step | What it measures |
|---|---|
| `startup` | Launch to a local page's load event: five launches with a new profile, five with an existing one (Dia: three, own profile) |
| `memory-idle` | Footprint after 15 s on the start page |
| `pageload-local` | Eight loads each of a simple article and a heavy page (≈90 subresources from two origins, 30 scripts doing 4 ms of work each, 300 cards); first paint, largest paint and load event from the page's own timing |
| `pageload-real` | Wikipedia, GitHub, BBC News, YouTube, Stack Overflow and Hacker News, three loads each (network-dependent) |
| `newtab` | Command to load event for a new tab with a page, and for the browser's new tab page |
| `memory-tabs` | Footprint with 10 and 30 heavy tabs after settling, tab-switch time to the first frame after activation, footprint 30 s after closing them |
| `real` | Footprint with 10 real sites open |
| `speedometer` | Speedometer 3.1 from browserbench.org, in the foreground |

Merlin and Brave get a new, isolated profile and DevTools on a random local
port. Merlin also gets its own config folder (a copy of your
`config.toml`) and browserctl socket, so it never touches your profile,
workspaces or running Merlin. Dia is driven by AppleScript, launched with
`--enable-applescript-javascript` for that session, in a test window that
is closed afterwards; the real sites it visits stay in Dia's history.

### Rerunning

Quit Brave and Dia, plug in, and leave the Mac alone while it runs:
windows come to the front, and a window in the background is throttled.
A full run takes about 15 minutes per browser.

```bash
out=/tmp/merlin-bench-$(date +%F)
for b in merlin-release brave dia; do
  node scripts/benchmark_browsers.mjs --browser "$b" --out "$out"
done
# Since 2026-11-05 Merlin blocks ads by default, so merlin-release measures it
# with the blocker on. For a like-for-like comparison with the 2026-11-05
# merlin-release column (blocker off):
node scripts/benchmark_browsers.mjs --browser merlin-release --name merlin-release-noadblock \
  --arg --disable-features=MerlinAdblock --out "$out" --skip speedometer,startup,newtab
node scripts/summarize_benchmarks.mjs "$out"
```

Brave is expected at `/Applications/Brave Browser.app`; pass `--app` for
another location. `merlin-dev` measures `out/Modal`. Real-site numbers vary
with the network; compare local-page, memory and Speedometer results first.
Run Speedometer more than once before trusting a difference under 5%.
