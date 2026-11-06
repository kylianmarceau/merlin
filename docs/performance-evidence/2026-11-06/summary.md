# Benchmarks — 2026-11-06, Merlin release build with PGO

MacBook with Apple M2 (8 cores) and 16 GB, after the overnight macOS update, on mains power. Dia was open in the background. The brave and dia columns are copied from [2026-11-05](../2026-11-05/summary.md); only Merlin was rerun. merlin-release has the native blocker on (the default since 2026-11-05); merlin-release-noadblock runs with --disable-features=MerlinAdblock. Speedometer ran three times; noadblock startup was a separate run.


### Startup (launch to first page loaded, ms)

| | merlin-release | brave | dia | merlin-release-noadblock |
|---|---:|---:|---:|---:|
| New profile | 778 | 567 | – | 558 |
| Existing profile | 539 | 592 | 3,678 | 546 |

### Memory (physical footprint of all browser processes, MB)

| | merlin-release | brave | dia | merlin-release-noadblock |
|---|---:|---:|---:|---:|
| Idle, start page | 275 | 295 | 1,024 | 258 |
| 10 heavy local tabs | 1,796 | 1,979 | 2,915 | 1,788 |
| 30 heavy local tabs | 2,690 | 3,034 | 4,126 | 2,342 |
| After closing them | 485 | 1,203 | 1,620 | 865 |
| 10 real sites | 1,899 | 2,369 | 3,128 | 2,871 |
| Per extra tab (10→30) | 45 | 53 | 61 | 28 |
| Processes at 30 tabs | 48 | 45 | 54 | 47 |

### Local test pages (median ms from navigation start)

| | merlin-release | brave | dia | merlin-release-noadblock |
|---|---:|---:|---:|---:|
| Simple: first paint | 72 | 80 | 80 | 68 |
| Simple: load | 47 | 62 | 48 | 48 |
| Heavy: first paint | 144 | 160 | 128 | 144 |
| Heavy: largest paint | 176 | 196 | 176 | 176 |
| Heavy: load | 243 | 265 | 227 | 238 |

### Real sites: largest paint (median of 3, ms)

| | merlin-release | brave | dia | merlin-release-noadblock |
|---|---:|---:|---:|---:|
| en.wikipedia.org/wiki/Web_browser | 488 | 376 | 316 | 320 |
| github.com/rust-lang/rust | 292 | 336 | 912 | 248 |
| bbc.com/news | 412 | 164 | 144 | 148 |
| youtube.com/ | 892 | 884 | 2,252 | 992 |
| stackoverflow.com/questions | 206 | 245 | 444 | 196 |
| news.ycombinator.com/ | 356 | 964 | 408 | 400 |
| **Median across sites** | 356 | 336 | 408 | 248 |

### Real sites: load event (median of 3, ms)

| | merlin-release | brave | dia | merlin-release-noadblock |
|---|---:|---:|---:|---:|
| en.wikipedia.org/wiki/Web_browser | 598 | 555 | 654 | 682 |
| github.com/rust-lang/rust | 346 | 325 | 963 | 350 |
| bbc.com/news | 527 | 357 | 474 | 933 |
| youtube.com/ | 777 | 799 | 1,885 | 859 |
| stackoverflow.com/questions | 205 | 439 | 508 | 197 |
| news.ycombinator.com/ | 322 | 918 | 343 | 355 |
| **Median across sites** | 346 | 439 | 508 | 355 |

### Tabs (median ms)

| | merlin-release | brave | dia | merlin-release-noadblock |
|---|---:|---:|---:|---:|
| New tab with a page, to loaded | 74 | 80 | 212 | – |
| New tab page, to loaded | 53 | 117 | – | – |
| Switch to a background tab, to first frame | 26 | 11 | not measurable | 25 |

### Responsiveness

| | merlin-release | brave | dia | merlin-release-noadblock |
|---|---:|---:|---:|---:|
| Speedometer 3.1 (higher is better) | 42.8, 43, 42.8 | 43.1, 43.1 | 41.4 | – |

Errors: none
Dia AppleScript overhead subtracted from its tab timings: 42 ms
