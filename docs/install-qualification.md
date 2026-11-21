# Install qualification: Merlin {{VERSION}}

Run per release on the draft release's download, before publishing it.
`scripts/package_mac.sh` copies this file to `dist/{{VERSION}}/`; fill in
that copy and keep it with `build-info.txt`. Mark each step `[x]` passed,
`[!]` failed (say what happened) or `[-]` not run (say why). Don't publish
with a failed step.

Tester: ______  Date: ______  Previous version installed: ______

## 1. Fresh account, quarantined download

On a macOS user account that has never run Merlin (System Settings > Users &
Groups > Add User), on the newest macOS. macOS version: ______

- [ ] Download the DMG and its `.sha256` from the draft release **in a
  browser**, so macOS quarantines it. `xattr -p com.apple.quarantine` on the
  DMG prints a value.
- [ ] `shasum -a 256` matches the `.sha256` file.
- [ ] The DMG shows Merlin, Applications, Read me first, LICENSE, NOTICE,
  Third-party notices and Build info.
- [ ] `codesign -dv` on the app in the DMG shows `flags=…(runtime)` and the
  designated requirement recorded in Build info.
- [ ] After dragging to Applications, the first launch is blocked with
  "can't check" (not "damaged"); **Open Anyway** in Privacy & Security opens
  it.
- [ ] Pages and a video play; Activity Monitor shows `Merlin Helper`
  (Renderer, GPU) processes.
- [ ] Quit and relaunch: no approval asked again.
- [ ] Finder's Get Info on Merlin.app shows version {{VERSION}}.

- [ ] Check the falcon intro, Skip intro and Reduce Motion. Go forward and
  back through appearance and workspace, and verify the live tab and colour preview.
- [ ] Quit partway and reopen at the saved step. Follow a real hint, jump to
  the lookout with Shift-G and choose Finish practice. Confirm the finish
  screen waits for Start browsing. Replay from Help › Keyboard Tutorial with
  a mouse, and check that finishing removes only the practice tab.

## 2. Replacing the previous version

On an account with the previous release installed and used: a saved
password, a few bookmarks and history, two workspaces, a `config.toml`
change, camera access granted to a site.

- [ ] Quit Merlin, replace it in Applications with this release (or
  `brew upgrade --cask kylianmarceau/tap/merlin`; it quits Merlin first).
- [ ] Bookmarks, history, workspaces and `config.toml` are still there.
- [ ] The saved password fills **without** a keychain prompt about
  "Chromium Safe Storage". (Expected once when moving from an ad-hoc release
  to the signing identity, then never again; note which happened.)
- [ ] The site still has camera access without macOS asking again.

## 3. Permission prompts

On a test page (for example https://webrtc.github.io/samples/), each prompt
shows Merlin's prompt and then, the first time, macOS's own:

- [ ] Camera
- [ ] Microphone
- [ ] Screen sharing (macOS asks for Screen Recording; relaunch when told to)
- [ ] Location
- [ ] Notifications

## 4. Minimum macOS

One run on macOS 14 Sonoma, the oldest version Merlin supports (a VM is
fine, for example with UTM or Tart). macOS version: ______

- [ ] Opens through Open Anyway, loads pages and plays a video.
- [ ] Hints, the command palette, a split view and a workspace work.
- [ ] Quits and relaunches cleanly.

## Notes
