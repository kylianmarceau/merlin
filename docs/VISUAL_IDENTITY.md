# Merlin browser UI identity

Branch: `feature/merlin-visual-identity`. Reference: existing Merlin Settings,
tabs, toolbar and palette. Chromium pin: `157.0.8103.26`.

## Implementation plan and acceptance gate

1. Inventory native Views, browser WebUI, shared resources, artwork and strings.
2. Establish a single token source, generating native and WebUI bindings.
3. Password save/update/manage, passkeys and global media controls first.
4. Permission prompts, site information, choosers and certificates next.
5. Autofill addresses/payments, profiles, extensions and side panels.
6. Remaining settings, printing, downloads, private browsing and recovery.
7. Audit uncommon dialogs and accessibility/high contrast; add update checks.

Keep Chromium controllers, services, commands, accessibility semantics, URL
handling, authentication, certificate validation and warning severity. Change
presentation at shared component boundaries and small upstream hooks. Do not
fork whole implementations. Preserve copyright/credits, protocol and user-agent
identifiers, website content, extension UI and operating-system UI.

A source change is **implemented**, not **qualified**, until light/dark captures,
keyboard/focus, narrow windows, VoiceOver and relevant private states have been
checked. Record results explicitly; source coverage is not runtime coverage.

## Surface checklist

Paths below are relative to Chromium `src/`, except `overlay/` paths, which
belong to this repository. The generated source catalog records individual
files and inherited style/artwork signals; these are review leads, not proof
that a service or surface is enabled on macOS.

| Batch | Browser-owned surfaces | Presentation sources | Inherited presentation to review | Qualification |
| --- | --- | --- | --- | --- |
| 1 | Save/update/manage passwords, generation, auto sign-in, leak/cross-domain/biometric/relaunch prompts | `chrome/browser/ui/views/passwords/`; `chrome/browser/resources/password_manager/` | Bubble headers, GPM artwork, Material cards/rounded buttons, shared vars, product strings | Light/dark save/cancel, safe/review headers, list/checkup/settings sampled; authentication manual |
| 1 | Passkey save/update/delete/upgrade, authenticator picker, QR/hybrid/PIN/error dialogs | `chrome/browser/ui/views/webauthn/`; `chrome/browser/resources/password_manager/dialogs/` | Authenticator illustrations, title/product icons, geometry | Static decoration implemented; synthetic creation fixture + manual OS/hardware qualification |
| 1 | Global media toolbar, session cards, live captions, cast/device picker, audio output | `chrome/browser/ui/views/global_media_controls/`; `components/global_media_controls/`; `components/media_message_center/` | Elevated surface tokens, pill buttons, card geometry; media artwork is website content | Merlin-owned card layout; artwork/no-artwork/two-session light/dark captures, actual play/pause and keyboard seek; cast/device states manual |
| 2 | Permission allow/block/once, quiet prompt, previously denied, policy/system-settings prompts | `chrome/browser/ui/views/permissions/` | Shared bubble metrics, button styles, severity/status icons | Light/dark prompt sampled; allow/once/deny delegate routing passed; OS states manual |
| 2 | Site information/security, permission toggles, cookies, chosen objects, safety tips | `chrome/browser/ui/views/page_info/`; `chrome/browser/ui/views/location_bar/` | Shared Views tokens, warning colors, site identity | Light/dark site info sampled; security/permission anchor regressions passed; remaining variants manual |
| 2 | Bluetooth/USB/HID/serial/file-system chooser, protocol handlers | `chrome/browser/ui/views/permissions/`; `chrome/browser/ui/views/chooser_content_view.cc`; `chrome/browser/ui/views/device_chooser_content_view.cc` | Native tables, button row, dialog metrics | Shared component coverage; device-dependent qualification open |
| 2 | Certificate manager/viewer, client certificate selection | `chrome/browser/resources/certificate_manager/`; `chrome/browser/resources/certificate_viewer/`; `chrome/browser/ui/views/certificate_selector.cc` | WebUI vars, certificate hierarchy and error styles | Light/dark manager sampled; viewer/client selection manual |
| 2 | TLS, Safe Browsing, billing, HTTPS-first, captive portal, supervised warnings; network errors | `components/security_interstitials/`; `components/neterror/`; `overlay/chrome/browser/ui/modal_browser/merlin_restyle.cc` | Warning hierarchy must stay; existing error-only restyle needs audit | TLS/network error sampled; back-to-safety tested; remaining warning variants manual |
| 3 | Address/contact suggestion popup, save/edit/delete address, autofill suggestions | `chrome/browser/ui/views/autofill/`; `chrome/browser/ui/views/autofill/popup/`; `chrome/browser/resources/settings/autofill_page/` | Filled fields, bubbles, promotional illustration and product names | Light/dark address settings sampled; promotional headers implemented; suggestion/save/edit variants manual |
| 3 | Card save/update/unmask, virtual card, IBAN, mandatory reauth, payment errors, payment request | `chrome/browser/ui/views/autofill/payments/`; `chrome/browser/ui/views/payments/`; `components/autofill_payments_strings.grdp` | Payment provider marks retained truthfully; browser artwork/buttons audited | Light/dark payment settings sampled; local-save controller fixture added; authentication/cloud variants manual |
| 4 | Profile toolbar/menu/picker, guest, profile management, sign-in/out, managed notices | `chrome/browser/ui/views/profiles/`; `chrome/browser/resources/signin/`; `chrome/browser/resources/profile_picker/` | Profile illustrations, product promotion, native and WebUI typography | Early theme hook and artwork implemented; profile/account-state qualification open |
| 4 | Extension toolbar/menu, install/uninstall, permissions, alerts, shortcuts, management | `chrome/browser/ui/views/extensions/`; `chrome/browser/resources/extensions/` | Shared cards/toolbar/dialogs; extension-provided content excluded | Light/dark management sampled; install/update/warning variants manual |
| 4 | Bookmarks/reading list/history/side-panel controls and search | `chrome/browser/ui/views/bookmarks/`; `chrome/browser/ui/views/side_panel/`; `chrome/browser/resources/side_panel/`; `overlay/chrome/browser/ui/modal_browser/merlin_library_pages.cc` | Header controls, WebUI cards, empty-state artwork | Library pages included in light/dark/narrow capture suite; side-panel variants manual |
| 5 | Settings: permissions, privacy/security, cookies, clear data, fonts/languages/accessibility/system, import/reset | `chrome/browser/resources/settings/`; `overlay/chrome/browser/ui/modal_browser/merlin_settings_page.cc` | Deep linked subpages still inherited; keep their navigation/actions | Core/deep-linked samples in light/dark/narrow; reset/import/uncommon states manual |
| 5 | Downloads toolbar/bubble/shelf, danger/insecure/deep-scan/recovery, download page | `chrome/browser/ui/views/download/`; `chrome/browser/resources/downloads/`; `overlay/chrome/browser/ui/modal_browser/merlin_downloads.cc` | Danger colors/actions, scan artwork, shared rows | Library page captured; danger/scan/recovery variants manual |
| 5 | Private/guest new tab, private window menu, close/clear prompts | `chrome/browser/resources/new_tab_page_incognito_guest/`; `chrome/browser/ui/views/incognito_clear_browsing_data_dialog.*`; `chrome/browser/ui/views/profiles/`; `overlay/chrome/browser/ui/modal_browser/merlin_start_page.cc` | Private glyph, disclosure, profile-specific theme | Private page in regular/narrow windows sampled; explicit mode-label regression; guest/clear variants manual |
| 5 | Print preview/settings/errors, browser print dialogs | `chrome/browser/resources/print_preview/`; `chrome/browser/ui/views/printing/` | Preview controls and sheets; macOS print/save sheets excluded | Light/dark real preview sampled with gold-action assertion; OS sheets excluded; errors/devices manual |
| 6 | Restore/crash/profile-error/default-browser prompts, first run, hung renderer, before-unload, JavaScript/auth dialogs | `chrome/browser/ui/views/session_crashed_bubble_view.cc`; `chrome/browser/ui/views/startup/`; `chrome/browser/ui/views/javascript*`; `chrome/browser/ui/views/login*`; `chrome/browser/ui/views/tab_modal*`; `components/javascript_dialogs/` | Buttons/metrics/product strings, severity | Shared component coverage; recovery/auth/state qualification open |
| 6 | Menus/context menus, zoom/find, translate, sharing/QR, fullscreen/exclusive access, task manager, page actions | `chrome/browser/ui/views/`; `chrome/browser/ui/views/toolbar/`; `chrome/browser/ui/views/frame/`; `chrome/browser/ui/views/translate/`; `chrome/browser/resources/` | Non-system menus/bubbles; stock artwork; every enabled action remains reachable | Existing menu/toolbar regressions included; remaining controls/state qualification open |
| 6 | About/version/credits, policy/management, diagnostics/flags, developer tools | `chrome/browser/resources/`; `ui/webui/resources/`; `third_party/devtools-frontend/src/front_end/`; `overlay/chrome/browser/ui/modal_browser/merlin_pages.cc` | Attribution/technical names intentionally retained; diagnostic tools still need presentation audit | DevTools shared tokens, strings and product/frame art implemented; uncommon diagnostic states manual |

## Intentional exceptions

- Chromium attribution, licenses and credits remain unchanged.
- Internal file/symbol/resource names, `chrome://` URLs, protocols, UA and
  compatibility identifiers remain unchanged. URL rendering is security-sensitive.
- Third-party service/provider names (Google Account, Google Pay, Cast, Web
  Store destination, Chrome Root Store/Root Program), imported-browser names and extension/site content must
  remain truthful. Exceptions must be message/resource-specific, not a blanket
  exemption for every occurrence of Chrome or Google.
- macOS authentication, file, printer and system permission sheets are OS-owned.
- High contrast/forced colors take priority over decorative Merlin colors.
  The native mixer also steps aside for explicit user-installed themes and
  user colors. Merlin WebUI pages retain the shared page design.

## Required checks after a Chromium update

Regenerate the source catalog and compare added/removed files; regenerate token
bindings and check they are current. Apply/review the narrow patches, run GN
checks and the browser/UI regression suites. Review visible desktop messages
and referenced stock artwork against explicit exceptions. Repeat screenshots in
light/dark and narrow/private states, keyboard and VoiceOver, and functional
flows (including deny/cancel/error paths). Never approve warning changes on
screenshots alone.

## Evidence and batch log

Source inventory and implementation batches are recorded below. Automated sample
qualification is recorded in the evidence directory; full runtime acceptance
remains open until the manual state matrix is completed.

The full source catalog is [visual-identity-sources.tsv](visual-identity-sources.tsv).
It is generated by `python3 scripts/inventory_browser_ui.py --src ~/chromium/src`.
The catalog includes diagnostics and feature-gated pages; it does not assert
that each file is an independently reachable surface. It includes shared controls,
animated illustrations, desktop string catalogs and DevTools.


## Implemented batches and changed-file summary

A maintainer screenshot exposed that the first media batch had retained
Chromium's card arrangement. Its earlier evidence established token colours
and playback callbacks, not completed visual identity. Patches 0044–0045 and
Merlin-owned media components correct that structural gap.

| Batch | Implementation | Files owned by Merlin / upstream patch |
| --- | --- | --- |
| Foundation | Early theme registration (including the initial profile picker); native, modal-overlay and WebUI tokens, system typography, 8 px control/14 px card and dialog corners; focus contrast corrected | `branding/design_tokens.json`, generated `branding/generated/` CSS and `merlin_design_tokens.h`; `merlin_theme.cc`, `merlin_pages.cc`, `merlin_start_page.cc`, `merlin_settings_page.cc`, `merlin_restyle.cc`, `modal_style.{h,cc}`, `BUILD.gn`; patches `0032`, `0038` |
| Passwords/media | Compact password decoration; semantic status headers; elevated media surfaces, transport button and dialog corner tokens | `merlin_bubble_header.h`; patches `0032`, `0035`, `0037` |
| Media layout correction | Merlin header, compact artwork/metadata card, persistent elapsed/duration row, rectangular transport controls below the timeline and compact caption/settings rows; retain every upstream control and its event/state bindings | `merlin_media_controls.{h,cc}`, `media_presentation` leaf target; opt-in component presentation parameters in patch `0044`; artwork, no-artwork, two-session, live and cast-notice fixtures; responsive cast warning in patch `0045` |
| Product names | Desktop message-only edits; keep translator hints, identifiers, links, markup and attribution | `scripts/rebrand_remaining_names.py`, `branding/product_name_exceptions.json`; patch `0033` |
| Artwork | 48 browser-owned password/profile/settings/bookmark SVGs; distinct checkup states; private-window illustrations and vector glyphs | `branding/identity_artwork.json`, artwork generators; patches `0034`, `0036` |
| Remaining UI | Shared Views/WebUI styling reaches permission/site controls, autofill/payments, profile/extension UI, dialogs and side panels; targeted print/private-page overrides | Native mixer + patch `0032`; patch `0035` |
| Autofill/passkeys | Shared address/payment/authentication/success headers for ten inherited autofill prompts; static passkey/PIN decoration, preserving device instructions and QR/progress UI | `branding/native_header_overrides.json`, `merlin_bubble_header.h`; patch `0041` |
| DevTools/diagnostics | Merlin neutral/accent and navigation/checkbox/focus tokens, button geometry, 44 localizable browser labels, product icon and decorative Layers frame; AI diagnostic label; preserve external datasets/policies and protocol identifiers | `branding/devtools_strings.json`, `scripts/audit_devtools_strings.cjs`, diagnostic generators; patches `0039`, `0042`, `0043` |
| Component fallbacks | Map neutral/link fallback roles and pair gold prominent actions with dark text, including print preview without native color export | `branding/generated/merlin_component_tokens.css`; patch `0040` |
| Regression/update support | Source catalog, product-name exceptions pinned to exact message text, stock-artwork checks and rendered UI regression cases | `scripts/inventory_browser_ui.py`, `scripts/check_visual_identity.py`, `scripts/generate_*.py`, `merlin_identity_browsertest.cc`, `scripts/check.sh`, `scripts/run_browser_tests.sh` |
| Patch installation | Correctly preserve diff markers for files without a terminal newline | `scripts/apply_patches.py` |

Existing uncommitted work was present when the branch was created. For the merge,
the browser-safety and workspace prerequisites were recorded in a separate
commit, retaining the code used by the tested build. Unrelated release-policy
and review edits remain uncommitted. The pre-existing site-controls, workspace
and ad-blocking work is not claimed as new identity implementation.

## Commands and update procedure

From this repository:

```sh
python3 scripts/generate_design_tokens.py --check
python3 scripts/generate_identity_patch.py --check
python3 scripts/generate_identity_details.py --check
python3 scripts/generate_password_headers.py --check
python3 scripts/generate_devtools_identity.py --check
python3 scripts/generate_component_details.py --check
python3 scripts/generate_autofill_headers.py --check
python3 scripts/generate_diagnostics_identity.py --check
python3 scripts/generate_devtools_controls.py --check
python3 scripts/generate_media_presentation.py --check
python3 scripts/generate_media_permission_layout.py --check
python3 scripts/check_visual_identity.py --src ~/chromium/src
CHROMIUM_SRC=~/chromium/src scripts/verify_patches.sh
MERLIN_IDENTITY_SCREENSHOTS="$PWD/docs/visual-identity-evidence" \
  scripts/run_browser_tests.sh 'MerlinIdentityBrowserTest.*'
```

After changing the Chromium pin, regenerate patches in numeric order with the
corresponding `generate_*.py` / `rebrand_remaining_names.py` scripts, then apply
them with `scripts/apply_patches.py`. Artwork generators read the pinned source
for original dimensions and fail if an expected asset disappears. Review new
promotional assets and new message files from the source catalog; an audit of
known resources is not an automatic discovery guarantee.

The name audit covers the explicit desktop string-file list in
`rebrand_remaining_names.py`. Its 54 message exceptions include external Web
Store/enterprise/mobile destinations, compatibility product names and the
actual certificate root program. Each exception includes a reason and a hash
of its normalized message text. Updates require reviewing changed text rather
than automatically accepting a new baseline.

DevTools has a separate dependency pinned by Chromium's Git tree. Patch verification
fetches its files at that exact revision. `devtools_strings.json` records 56
localizable strings: 44 browser labels change, and 12 exact external-service,
policy or compatibility references remain. Stale translations for the 44 changed
keys are removed so DevTools uses its existing English-source fallback until
Merlin translations are supplied; the rest of each locale catalog is preserved.
The DevTools theme hook honors the match-browser preference, custom host themes
and forced colors. Syntax and semantic warning palettes remain upstream.

The automated source inventory currently catalogs 13,074 presentation files.
These include shared components and feature-gated resources; this is not a count
of independently exercised UI states. Each row remains unqualified until its
specific state is reviewed. The family table records which runtime samples have
evidence without promoting an entire family to passed.

The artwork exception file also pins four instructional phone/laptop/connection
animations. These convey authentication guidance and progress rather than product
promotion. Static passkey and locked-PIN headers use Merlin's semantic component.

The name test for rendered pages excludes actual filesystem paths (which may
contain Chromium's test/profile directory identifiers) and the specific external
Web Store and Root Store names. It does not rewrite displayed paths or URLs.

## Qualification still required for full acceptance

The source catalog is an inventory and review aid. Shared token coverage does
not prove that every state of every source file has been exercised. Leave the
surface checklist open until all corresponding states have evidence.

Remaining manual qualification includes VoiceOver on macOS; actual Touch ID,
Keychain and passkey/hardware-key flows; account/cloud and device-dependent
prompts (casting, Bluetooth/USB/HID/serial, payment authentication, managed
profiles); extension install/update warnings; malicious-download, Safe Browsing
and recovery variants; and uncommon/developer-facing surfaces. Preserve warning
severity and inspect their actual actions, not only their colors. macOS-owned
sheets and third-party content remain outside presentation scope.

See [rendered evidence and test results](visual-identity-evidence/README.md).
