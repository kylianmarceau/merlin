# Privacy: what the fork adds

Everything Chromium does with data is unchanged and documented upstream.
This page lists what Merlin's modal layer and native ad blocker
read, write or send. It is an inventory, not an independent
review.

## Network

The modal layer adds no telemetry, update checks, accounts or AI services.
Searches typed in the command line go to the user's default search engine through
Chromium's own omnibox classifier, as if typed in the address bar.
The address card (decision 39) asks Chromium's address-bar engine as
Chromium's own field does, so the default search engine's suggestions
follow Chromium's setting for them.

When the native ad blocker is enabled, normal profiles can automatically
refresh selected filter sources with Chromium's networking. The fixed catalog
uses **easylist.to** and **raw.githubusercontent.com** over HTTPS. Requests omit
cookies and referrers and never contain visited page URLs, browsing history,
account identifiers or blocked-request reports. Source hosts can see the
client's IP address and requested list path. Redirects to other hosts or HTTP
are rejected. Each source download is bounded by Chromium's 5 MiB string-loader
limit; source/resource incompatibility or invalid data retains the old engine.

The scheduler checks approximately every six hours with up to 30 minutes of
jitter, respects source expiry, and backs off after failures. Both global
protection and automatic updates can stop automatic checks. An explicit manual
refresh can check lists independently of the automatic setting. Private windows
never create an updater. Executable scriptlets and replacements are bundled
with the app and cannot be downloaded by the list updater; they change through
application releases. There are no Merlin browser-binary update checks.

The native feature remains disabled by default during implementation and
qualification; see [the implementation record](ADBLOCK_IMPLEMENTATION.md).

## Files written

| What | Where | Mode | When |
|---|---|---|---|
| Workspaces: URLs, titles, pins, split pairs and optional project folder | `$XDG_DATA_HOME/modal_browser/workspaces/*.json` | 0600, directory 0700 | `:workspace save`, and autosave for windows opened from a workspace |
| Field text for `:edit` | a fresh `modal_browser_edit_*` directory in `$TMPDIR` | 0600, directory 0700 | while editing; deleted after normal editor exit and successful write-back; kept for recovery, with its path shown, when an established session is replaced, navigation cancels it, or write-back fails |
| Exports (`:extract ... editor`) | same as above | 0400 | deleted when the editor exits |
| browserctl socket | `$TMPDIR/modal_browser/browserctl.sock` | directory 0700 | while a normal window is open and `browserctl = true` |
| Native blocker lists, source revisions/digests/retrieval times, serialized engine and previous snapshot | Chromium profile's `MerlinAdblock/current` and `current.previous` | within the user-owned profile | after a validated generation is built; atomic publication, at most two 64 MiB snapshots plus temporary staging |
| Blocker enablement, list selection, automatic-update setting, last successful refresh and exact-host site exceptions | Chromium profile preferences (`merlin.adblock.*`) | Chromium profile permissions | explicit settings, commands or site-control changes; refresh time after a successful update |

Private (incognito) page data is not saved by the workspace/editor layer: private windows cannot save
workspaces and browserctl cannot see them. External editing and exports to an
editor are also disabled in private windows. Explicit downloads and browser
settings changes still follow Chromium and Merlin Settings behaviour.
Native blocker preferences in private windows use Chromium's in-memory
off-the-record preference layer. They may read existing settings and lists;
their new exceptions, list choices and blocked counts are not written to disk.

## Files read

`~/.config/modal_browser/config.toml` (or `$XDG_CONFIG_HOME`), workspace
files on `:workspace open`, and the editor's temporary file while editing.
The native blocker reads its validated profile cache and app-bundled fallback
data. Private windows can read the normal profile's existing blocker cache.

## Page data

Native matching evaluates canonical request URLs, browser-owned initiating
origins, resource types and HTTP methods on a dedicated thread. The
top-level hostname selects site exceptions separately. URLs are not retained
by the matcher, logged, uploaded or written to its cache. Counts are bounded,
in-memory values tied to live documents. Site exceptions retain only the exact
hostname the user explicitly exempts, not a navigation history. Shared/service
workers without a single frame use their owning origin for exceptions.

Versioned, app-bundled scriptlets may execute in a page's main world to patch
APIs before its scripts run; cosmetic helpers use an isolated world. Resource
permissions are assigned by the fixed source catalog. Custom list text cannot
grant itself trusted-scriptlet access or introduce executable resource URLs.
Actual page CSP and sandbox policies are preserved.

The modal layer's scripts run in Chrome's isolated world and return:

* for hints: element kinds and rectangles only; no text or values;
* for the outline and `:extract`: headings, paragraphs, lists, code,
  tables and link targets of the current page, kept in memory until the
  next navigation and never written to disk unless the user copies or
  exports them;
* for `:edit`: the focused field's type, `autocomplete`, name and length,
  then its value only after the policy allows it (never for passwords or
  fields marked for payment or one-time codes);
* for `yy`, `yf`, `yc`, `y` in Visual mode: the URL, link, code or
  selection being copied, straight to the clipboard.

* for the tab bar's color: the visible viewport of the active page, read from the compositor
  and scaled down to at most 96 by 96 pixels, reduced to one colour (or a
  neutral fallback) in memory and cached on that document. Switching tabs
  reuses the cached result; navigation invalidates it. No page script runs and nothing is written or sent.

* for recording/sharing controls: Chromium's current camera, microphone and
  capture state and the capturing tabs' top-level origins, used for the current
  window's indicator and menu. This state stays in memory, including in private
  windows; it is not logged, persisted or added to browserctl replies. Stopping
  capture uses Chromium's existing user-media/display-media stop callbacks.

## Clipboard

Written only by explicit yank commands; read only by `p`/`P`.

## browserctl

Replies to same-user processes with tab titles and URLs of normal windows,
the active tab, the selection in it (`browserctl selection`), and command
results. Off with `browserctl = false`.
