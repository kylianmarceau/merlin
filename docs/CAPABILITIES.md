# Capabilities

What Merlin supports, where it falls back to something else, and what it
doesn't have, with how each is tested. **Supported** means it works as in
Chromium (or as described). **Fallback** means it works another way, with
the difference stated. **Unavailable** means Merlin doesn't offer it.
The suites named in the last column are described in
[TESTING.md](TESTING.md); "by hand" means the release checklist in
`apps/browser/README.md`.

## WebKit tabs

Sites that need DRM video (Netflix and similar) open in WebKit, macOS's own
engine, because Merlin's Chromium has no Widevine. Everything else is
Chromium.

| Capability | Status | How it's tested |
|---|---|---|
| Playing DRM video (FairPlay) | Supported | By hand, on a DRM site |
| Picture in picture: right-click a video to enter or exit, or let video playing with sound float when its tab is left (Settings › General › Float videos when you switch tabs) | Supported for videos WebKit can present in Picture in Picture | Automatic mode in e2e `test_auto_pip` (opt-in); Netflix by hand |
| Choosing the engine per site; moving a site between engines (right-click a tab) | Supported | `pnpm ui:test` (routing and moving back to Chromium); e2e `test_webkit` (navigations behind a WebKit page) |
| Private windows: one WebKit session in memory that ends with the last private window | Supported | e2e `test_webkit` |
| Clear browsing data and "Forget this site" | Supported in both engines at once | e2e `test_webkit` |
| Site icons | Supported, fetched without cookies or credentials, kept apart from Chromium's | e2e `test_webkit` |
| The page's address and title in `merlin`, bookmarks, `:yank`, workspaces and session restore | Supported | e2e `test_webkit` |
| Sign-in pop-ups that keep `window.opener` | Supported for the same site; another site's opens a tab | e2e `test_webkit` |
| Modal keys (Normal mode, counts, sequences) | Unavailable: browser shortcuts still reach the shell | By hand |
| Hints, find in page, `:edit` and the outline | Unavailable: they refuse rather than act on the hidden Chromium page | e2e `test_webkit` |
| Downloads | Fallback: handed to Chromium, which downloads without WebKit's cookies, so a download that needs the site's sign-in can fail | By hand |
| Ad blocking | Unavailable: Merlin's blocker is built into Chromium | Not tested (nothing to test) |
| Extensions | Unavailable: extensions run only in Chromium tabs | Not tested (nothing to test) |
| Chromium's settings: site permissions, cookies, saved passwords, autofill, Safe Browsing, HTTPS-First | Unavailable: they apply to Chromium tabs only. WebKit keeps its own cookies and site data | By hand |

## Extensions

| Capability | Status | How it's tested |
|---|---|---|
| Installing unpacked and `.crx` extensions; content scripts | Supported | By hand |
| Chrome Web Store installs | Fallback: may need extra steps | By hand |
| Toolbar action popups | Supported, shown in place and sized to their content | By hand |
| Side panels (`chrome.sidePanel`) | Unavailable: Merlin has no side panel, and says so | By hand |
| `chrome.action.openPopup()` | Unavailable | By hand |

## The browser window

Normal and pop-up windows are a React window with no `BrowserView`
(`merlin_react_window_mac.mm`). It implements Chromium's `BrowserWindow`;
these methods do nothing there because Merlin draws its own replacement or
has no such feature:

| `BrowserWindow` behaviour | Status | Why |
|---|---|---|
| Status bubbles, download bubble, pinned toolbar actions, location bar views | Fallback: Merlin's own status line, downloads popover and address field | The shell draws them |
| Tab Search bubble | Fallback: the command palette and the Control-Tab switcher | Merlin has its own |
| Avatar (profile) bubble | Unavailable | One profile |
| Happiness-tracking surveys | Unavailable | Not shown |
| Top controls, immersive mode, custom tab bars | Unavailable | Mobile and other platforms only |
| Virtual-desktop workspaces (`GetWorkspace`) | Unavailable | Not a macOS feature; window spaces work as normal |
| App and DevTools windows | Fallback: Chromium's own window | Upstream implementation |
| The fullscreen exit and security indicator | Fallback: Chromium's native bubble | |

Tested by the end-to-end suite through the assembled app, and by hand for
the surfaces it can't see.

## Autofill and passwords

| Capability | Status | How it's tested |
|---|---|---|
| Saving and updating passwords | Supported, in Merlin's own prompt | By hand |
| Saving and filling addresses; saving cards on this Mac | Supported | By hand |
| Uploading cards to a payments account, IBAN, virtual cards, Autofill AI | Unavailable: the offer is not shown and Chromium carries on | By hand |

## Other areas

| Capability | Status | How it's tested |
|---|---|---|
| Reading mode | Unavailable: Chromium's needs its side panel. The outline (`gO`) and `yM` (copy as Markdown) cover some of it | Unit tests: no command offers it |
| Script plugins | Unavailable until there is a permission model | Unit tests: no command offers it |
| Error pages and certificate warnings in Merlin's style | Limitation: Chromium's styling, in Merlin's name | e2e `test_identity` (never says Chrome); the styling isn't tested |
| Safe Browsing lookups | Unavailable: they need a Google API key that forks don't have | Not tested |
| Profiles and sync | Unavailable: one profile; use workspaces and private windows | Unit tests: no profile command, panel or request |
| Ad blocking in Chromium tabs | Supported, on by default | e2e `test_adblock`, `test_site_panel`, `test_adblock_states` (off, no lists, a broken list, rules still loading); browser tests, with a development build |
| Lean defaults: Gemini, Lens, Help me write, Cast and the built-in AI APIs off, Memory Saver on, no field trials, no prewarmed or preloaded hidden pages | Supported | e2e `test_defaults` |
| Private windows: no history or workspace, invisible to `merlin` | Supported | e2e `test_private` |
| Turning command-line access off from Settings › General | Supported: the socket closes at once | e2e `test_shell_api` |
| Session restore after quitting, and after a crash once you choose Restore | Supported | e2e `test_session` |
| Site permission prompts and page dialogs (`alert`, `confirm`, `prompt`) | Supported, answered in the shell | e2e `test_prompts` |
| Input methods and dead keys, in fields and in Normal mode | Supported: their keys always reach the page | e2e `test_input`, with the keys an input method sends; no real input method |
| Recovery from a renderer or GPU process crash | Supported | e2e `test_crash` |
| Recovery when the interface itself fails: a window's error boundary with Reload Interface and Copy Diagnostics, and a bridge reload after an error outside React | Supported: tabs stay open | e2e `test_interface` |
| Passkeys and security keys, client certificates, proxy authentication, enterprise policies | Inherited from Chromium | Not tested: needs hardware or a matching setup |
