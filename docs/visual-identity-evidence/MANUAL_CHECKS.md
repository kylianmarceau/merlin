# macOS qualification — manual check sheet

Prepared for the maintainer's requested handoff. Use the new branch's fresh
`out/Modal/Merlin.app`, a disposable profile, and synthetic credentials only.
Do not use your everyday profile for destructive settings/recovery cases.

The automated suite verifies rendered samples and several controller paths.
It does not certify this sheet. Record macOS/build version, theme, window
size, pass/fail, and screenshot/notes for each case. An unchecked box means
**unverified**, not passed.

## Launch an isolated manual profile

Quit any previous manual-test instance, then run this from the repository root
in Terminal after the final build has completed:

```sh
merlin_identity_test="$(mktemp -d /tmp/merlin-identity-manual.XXXXXX)"
XDG_CONFIG_HOME="$merlin_identity_test/config" \
XDG_DATA_HOME="$merlin_identity_test/data" \
~/chromium/src/out/Modal/Merlin.app/Contents/MacOS/Merlin \
  --user-data-dir="$merlin_identity_test/profile" \
  --modal-browser-socket="$merlin_identity_test/control.sock"
```

This isolates the browser profile, Merlin settings/workspaces and control
socket from your everyday instance. A user-data directory alone does not
isolate Merlin's settings or workspace storage. Record the temporary path if
you need to resume testing; quit the test browser before removing it.
Never approve a website certificate warning to perform these branding checks.

## Setup

- [ ] Record macOS version, Merlin revision and Chromium version.
- [ ] Launch a disposable profile; verify About and window title say Merlin.
- [ ] Choose Light in Merlin Settings; repeat the cases below in Dark.
- [ ] Test with the narrowest window Merlin allows, then a regular window.
- [ ] Keep a regular window and a private window open to check mode identity.
- [ ] Turn on VoiceOver using your normal macOS shortcut/settings; restore
      your previous VoiceOver setting after the checks.

## Passwords, authentication and passkeys

- [ ] Submit a synthetic password on a trusted test site. Save, dismiss and
      select Never on separate attempts. Confirm the respective result in
      Password Manager and that the correct site/user is shown.
- [ ] Update that password. Confirm Update changes only the chosen login;
      cancel leaves the old value. Check username editing and show/hide.
- [ ] Reveal/copy a saved password. Complete Touch ID/Keychain authentication
      yourself. Cancel/reject authentication on another attempt and confirm
      that the secret remains concealed and cannot be copied.
- [ ] Confirm Keychain/relaunch and biometric opt-in/confirmation prompts
      retain clear wording, meaningful status icons and working actions.
- [ ] Create/use/edit/delete a disposable passkey. Check the browser's
      chooser, device labels, PIN/error/timeout/cancel and completion states.
      Complete OS-owned authentication yourself. Preserve a recovery method
      for the test account before removing its passkey.
- [ ] If available, test an external security key and phone/QR flow. Verify
      the relying-party identity, QR code and cross-device instructions stay
      correct. Browser branding must not modify these security values.
- [ ] Trigger a compromised/reused/weak-password test fixture. Confirm
      warning text and severity remain clear; open checkup and return.
- [ ] Verify private windows do not silently save credentials or expose
      regular-profile data through Merlin-specific UI.

## Keyboard and VoiceOver

For each password prompt, media bubble, permission prompt, site-info bubble,
certificate warning, WebUI dialog and settings subpage:

- [ ] Open using the keyboard. Tab/Shift-Tab reach all available actions in
      a logical order; arrow keys work within menus/lists; Escape dismisses
      where appropriate and restores focus to the opener.
- [ ] A visible focus ring remains visible on light/dark backgrounds and
      near card/scroll boundaries; opening a menu does not trap focus.
- [ ] VoiceOver announces title, role, field labels, state and action names.
      Decorative Merlin artwork is not announced redundantly. Passwords
      stay concealed. Warnings announce the actual risk and safe action.
- [ ] Zoom/larger text and narrow windows do not hide controls or obscure
      site identity, warning details, validation errors or the focused item.
- [ ] Check macOS Increase Contrast and any installed browser theme; retain
      readable warning/selection/focus states and the user's frame theme.

## Media, permissions and site controls

- [ ] Play local/site audio and video. Check pause/resume, seek, next/previous
      when supplied, picture-in-picture, captions and keyboard control.
- [ ] Use a real cast receiver/audio-output device if available; select,
      disconnect, retry/error and close. Website titles/artwork stay intact.
- [ ] On a trusted disposable test origin, exercise Allow, Allow once,
      Never allow and dismissal for camera/microphone/location/notifications.
      Confirm the actual site permission and private-window behavior.
- [ ] Reopen Site settings and change a permission back. Test insecure and
      secure site info, cookies/site data, chosen objects and managed states.
- [ ] Test available Bluetooth/USB/HID/serial chooser and cancellation.
      Confirm device names, selection and permission scopes remain correct.

## Security, downloads, payments and less common surfaces

- [ ] Inspect an expired/self-signed-certificate warning and use Back to
      safety. Inspect details/certificate viewer. Do not bypass the warning
      for this branding check. Never treat a cosmetic result as proof of TLS.
- [ ] Using safe test fixtures, inspect Safe Browsing/HTTPS-first/security
      warnings and unsafe/insecure-download states. Verify risk wording,
      red/amber severity and the safe action; do not download real malware.
- [ ] Test download pause/resume/cancel/show in folder and retained history.
- [ ] With synthetic autofill data, test suggestion selection, save/update,
      edit/delete, validation and cancel. Check payment/IBAN/reauth prompts
      without making a purchase. Provider names/marks must remain truthful.
- [ ] Test browser-owned extension install/update/uninstall/permission and
      developer-mode warning UI with a known test extension. Extension-owned
      interfaces themselves are outside Merlin's presentation scope.
- [ ] Open profile menu/picker, guest, managed notices and sign-out/cancel;
      keep profile identity and data boundaries clear.
- [ ] Check print preview, destination/settings/errors and cancel; use Save
      to PDF only if you want an output file. macOS print/save sheets are
      OS-owned and do not need Merlin restyling.
- [ ] Test session restore/recovery, before-unload, JavaScript/auth dialogs,
      find/zoom, translate, menus, side panels and fullscreen entry/exit.
- [ ] Inspect diagnostic/developer pages and DevTools, including user theme
      selection, controls, notices and any remaining product names. Record
      source/UI gaps against the inventory rather than silently exempting them.

## Sign-off

- [ ] Review `browser-tests.json`, the screenshots and the source inventory.
- [ ] Classify every observed Chrome/Chromium name or product image: actual
      external service/compatibility/attribution, or unintended browser branding.
      Refer to `branding/product_name_exceptions.json`; report new exceptions.
      DevTools-specific strings are recorded in `branding/devtools_strings.json`;
      instructional and external artwork in `branding/artwork_exceptions.json`.
- [ ] Record failures and missing hardware/account-dependent coverage below.
- [ ] Mark full acceptance only after every inventory family is qualified.

| Case | Theme / window / private state | Result | Screenshot or notes |
| --- | --- | --- | --- |
| | | | |
