# Privacy: what the fork adds

Everything Chromium does with data is unchanged and documented upstream.
This page lists only what the modal layer (our Rust core and Chromium
glue) reads, writes or sends. It is an inventory, not an independent
review.

## Network

None. The modal layer makes no network requests of its own: no
telemetry, no update checks, no accounts, no AI services. Searches typed in
the command line go to the user's default search engine through
Chromium's own omnibox classifier, as if typed in the address bar.
The address card (decision 39) asks Chromium's address-bar engine as
Chromium's own field does, so the default search engine's suggestions
follow Chromium's setting for them.

## Files written

| What | Where | Mode | When |
|---|---|---|---|
| Workspaces: URLs, titles, pins, split pairs | `$XDG_DATA_HOME/modal_browser/workspaces/*.json` | 0600, directory 0700 | `:workspace save`, and autosave for windows opened from a workspace |
| Field text for `:edit` | a fresh `modal_browser_edit_*` directory in `$TMPDIR` | 0600, directory 0700 | while editing; deleted after normal editor exit and successful write-back; kept for recovery, with its path shown, when an established session is replaced, navigation cancels it, or write-back fails |
| Exports (`:extract ... editor`) | same as above | 0400 | deleted when the editor exits |
| browserctl socket | `$TMPDIR/modal_browser/browserctl.sock` | directory 0700 | while a normal window is open and `browserctl = true` |

Private (incognito) page data is not saved by the workspace/editor layer: private windows cannot save
workspaces and browserctl cannot see them. External editing and exports to an
editor are also disabled in private windows. Explicit downloads and browser
settings changes still follow Chromium and Merlin Settings behaviour.

## Files read

`~/.config/modal_browser/config.toml` (or `$XDG_CONFIG_HOME`), workspace
files on `:workspace open`, and the editor's temporary file while editing.

## Page data

Scripts run in Chrome's isolated world and return:

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

## Clipboard

Written only by explicit yank commands; read only by `p`/`P`.

## browserctl

Replies to same-user processes with tab titles and URLs of normal windows,
the active tab, the selection in it (`browserctl selection`), and command
results. Off with `browserctl = false`.
