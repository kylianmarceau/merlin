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

## Files written

| What | Where | Mode | When |
|---|---|---|---|
| Workspaces: URLs, titles, pins, split pairs | `$XDG_DATA_HOME/modal_browser/workspaces/*.json` | 0600, directory 0700 | `:workspace save`, and autosave for windows opened from a workspace |
| Field text for `:edit` | a fresh `modal_browser_edit_*` directory in `$TMPDIR` | 0600, directory 0700 | while editing; deleted when the editor exits, the session is replaced or the page goes away (kept, with its path shown, only if write-back failed so the text is not lost) |
| Exports (`:extract ... editor`) | same as above | 0400 | deleted when the editor exits |
| browserctl socket | `$TMPDIR/modal_browser/browserctl.sock` | directory 0700 | while a normal window is open and `browserctl = true` |

Nothing is written for private (incognito) windows: they cannot save
workspaces and browserctl cannot see them.

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

## Clipboard

Written only by explicit yank commands; read only by `p`/`P`.

## browserctl

Replies to same-user processes with tab titles and URLs of normal windows,
the active tab, the selection in it (`browserctl selection`), and command
results. Off with `browserctl = false`.
