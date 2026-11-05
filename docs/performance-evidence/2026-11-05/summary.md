
### Startup (launch to first page loaded, ms)

| | merlin-release | merlin-dev | brave | dia | merlin-release-adblock |
|---|---:|---:|---:|---:|---:|
| New profile | 536 | 4,699 | 567 | – | – |
| Existing profile | 512 | 4,695 | 592 | 3,678 | – |

### Memory (physical footprint of all browser processes, MB)

| | merlin-release | merlin-dev | brave | dia | merlin-release-adblock |
|---|---:|---:|---:|---:|---:|
| Idle, start page | 261 | 367 | 295 | 1,024 | 289 |
| 10 heavy local tabs | 1,657 | 1,915 | 1,979 | 2,915 | 1,867 |
| 30 heavy local tabs | 2,538 | 3,119 | 3,034 | 4,126 | 1,947 |
| After closing them | 485 | 1,131 | 1,203 | 1,620 | 487 |
| 10 real sites | 2,625 | 2,427 | 2,369 | 3,128 | 1,846 |
| Per extra tab (10→30) | 44 | 60 | 53 | 61 | 4 |
| Processes at 30 tabs | 51 | 47 | 45 | 54 | 41 |

### Local test pages (median ms from navigation start)

| | merlin-release | merlin-dev | brave | dia | merlin-release-adblock |
|---|---:|---:|---:|---:|---:|
| Simple: first paint | 72 | 84 | 80 | 80 | 76 |
| Simple: load | 47 | 49 | 62 | 48 | 45 |
| Heavy: first paint | 144 | 204 | 160 | 128 | 144 |
| Heavy: largest paint | 196 | 292 | 196 | 176 | 184 |
| Heavy: load | 255 | 379 | 265 | 227 | 253 |

### Real sites: largest paint (median of 3, ms)

| | merlin-release | merlin-dev | brave | dia | merlin-release-adblock |
|---|---:|---:|---:|---:|---:|
| en.wikipedia.org/wiki/Web_browser | 488 | 372 | 376 | 316 | 360 |
| github.com/rust-lang/rust | 388 | 620 | 336 | 912 | 408 |
| bbc.com/news | 104 | 112 | 164 | 144 | 168 |
| youtube.com/ | 1,000 | 1,516 | 884 | 2,252 | 896 |
| stackoverflow.com/questions | 296 | 387 | 245 | 444 | 209 |
| news.ycombinator.com/ | 360 | 588 | 964 | 408 | 376 |
| **Median across sites** | 360 | 387 | 336 | 408 | 360 |

### Real sites: load event (median of 3, ms)

| | merlin-release | merlin-dev | brave | dia | merlin-release-adblock |
|---|---:|---:|---:|---:|---:|
| en.wikipedia.org/wiki/Web_browser | 666 | 599 | 555 | 654 | 726 |
| github.com/rust-lang/rust | 367 | 963 | 325 | 963 | 519 |
| bbc.com/news | 1,665 | 2,770 | 357 | 474 | 536 |
| youtube.com/ | 918 | 1,313 | 799 | 1,885 | 791 |
| stackoverflow.com/questions | 279 | 2,056 | 439 | 508 | 192 |
| news.ycombinator.com/ | 324 | 531 | 918 | 343 | 336 |
| **Median across sites** | 367 | 963 | 439 | 508 | 519 |

### Tabs (median ms)

| | merlin-release | merlin-dev | brave | dia | merlin-release-adblock |
|---|---:|---:|---:|---:|---:|
| New tab with a page, to loaded | 67 | 69 | 80 | 212 | – |
| New tab page, to loaded | 50 | 59 | 117 | – | – |
| Switch to a background tab, to first frame | 25 | 23 | 11 | not measurable | 23 |

### Responsiveness

| | merlin-release | merlin-dev | brave | dia | merlin-release-adblock |
|---|---:|---:|---:|---:|---:|
| Speedometer 3.1 (higher is better) | 33.5, 34.8, 34.7 | 7.32 | 43.1, 43.1 | 41.4 | – |

Errors: none
Dia AppleScript overhead subtracted from its tab timings: 42 ms
