# Merlin branding

The browser is called **Merlin**. A merlin is a small, fast falcon that
wins by agility, not size, which is how a keyboard-first browser should
feel. The mark is the swept-back, right-facing falcon approved for the browser:
a rust silhouette on a warm cream tile, with a curved wing channel and a
negative-space eye. Monochrome contexts use the same silhouette.

`modal_browser` stays the internal code name (crates, Chromium paths,
`~/.config/modal_browser`). Only user-facing names change.

## Files

| File | Use |
|---|---|
| `merlin-mark.svg` | The approved rust falcon alone, with a transparent background. |
| `merlin-app-icon.svg` | macOS app icon source, 1024 × 1024 on Apple's icon grid (824 px body). |
| `merlin-app-icon-1024.png` | The app icon rendered at 1024 px. |
| `merlin.icns` | Standalone app icon, 16 px to 1024 px, for the DMG and anywhere outside the build. |
| `merlin-favicon.svg` | Full-bleed tile for small sizes: tabs, docs, the website, Merlin's own pages. |
| `merlin-mono.svg` | The falcon in one colour: the menu bar template and other single-colour uses. |
| `merlin-password-favicon.svg` | The password manager's tab icon: a key on the cream tile. |

`merlin-falcon.json` stores the smooth vector contours traced from the approved
artwork; `merlin-approved.png` retains that source for visual comparison.
`scripts/merlin_mark.py --write` draws every SVG above from those contours,
plus the Icon Composer layer (`overlay/.../mac/AppIcon.icon/Assets/merlin.svg`)
and the Views glyphs (`overlay/components/vector_icons/merlin/*.icon`).
Change the mark there, never in an SVG by hand. `scripts/rebrand_icons.py`
uses the same script for the WebUI icons in patch 0009.

`scripts/build_branding.sh` then regenerates the macOS icon files from
`merlin-app-icon.svg` and `AppIcon.icon`: the files here and the ones the
build uses in `overlay/chrome/app/theme/merlin/mac/` (`app.icns`,
`Assets.car`). It needs Xcode 26+ and the Chromium checkout. Commit the
outputs.

The same build script renders every product tile, favicon and monochrome PNG
in `overlay/chrome/app/theme/{merlin,default_*_percent/merlin}/` and
`overlay/components/resources/default_*_percent/merlin/`. It also composes the
wordmarks with `scripts/render_wordmark.swift`. The two `merlin-wordmark-*-mask.png`
files retain the existing Syne lettering only, without any old logo pixels; this
keeps builds independent of installed fonts. Internal pages load the shared
`icon.svg` rather than embedding a separate drawing.

## In the build

`build/args.modal.gn` and `build/args.release.gn` set
`branding_file_path = "//chrome/app/theme/merlin/BRANDING"`, so the build
makes `Merlin.app` with this icon, "About Merlin" and "Quit Merlin" in
the menus, and a profile in `~/Library/Application Support/Merlin`. An
`out/Modal` made before this needs that line in its `args.gn`
(`scripts/apply_overlay.sh` warns). See `docs/DECISIONS.md` 31 and 37.

`branding_path_component = "merlin"` (both args files) points every
product logo at the overlay: `chrome/app/theme/merlin/` (tiles 64-256,
the mono tray glyph, `product_logo.svg`), `default_{100,200}_percent/merlin/`
for Chrome and components (16 and 32 px tiles, the wordmark PNGs, the
version page logo) and `components/vector_icons/merlin/` (the menu glyph).
The wordmark PNGs retain the existing Syne Bold lettering and use the new
falcon tile, rust lettering on light grounds and cream on dark grounds. See `docs/DECISIONS.md` 33.

## Colors

| Name | Hex | Use |
|---|---|---|
| Cream | `#F5E9D7` | Icon tile, light brand grounds, wordmark on dark |
| Rust | `#AA4C32` | The falcon and the wordmark on light grounds |
| Hint | `#F6D44A` | The interface accent: link-hint labels, focus, highlights |

Hint yellow belongs to the interface, not the logo: it marks what you can
press. Keep it off the icon and the wordmark.

## Type

* Wordmark: **Syne Bold**, "Merlin", tracking −2%, in Rust (Cream on dark).
* Browser interface: the macOS system UI family, following Merlin Settings.
* Documentation typography: Inter.
* Code, keys and hint labels: JetBrains Mono.

The wordmark, documentation and code fonts are on Google Fonts under the SIL
Open Font License. Browser UI uses the installed system fonts.

## Shared browser UI design

`design_tokens.json` is the canonical palette and geometry for native Views,
Merlin pages, inherited WebUI components and DevTools. Run
`python3 scripts/generate_design_tokens.py` to generate the native header and
CSS in `generated/`. The narrow upstream patch generators consume those tokens;
regenerate and verify the corresponding patches after changing them. Do not
edit generated bindings by hand.

The [surface inventory and batch summary](../docs/VISUAL_IDENTITY.md) records
coverage, exact name/artwork exceptions and Chromium-update checks. The
[rendered evidence](../docs/visual-identity-evidence/README.md) separates sampled
UI states from the remaining manual qualification matrix.

## Still open

* A trademark and App Store name check for "Merlin". The name is crowded
  (Cornell's Merlin Bird ID app, Merlin Project); use "Merlin Browser"
  where a store or domain needs it unique.
* A tagline.
* Complete the manual UI state matrix. Actual external services, compatibility
  names, trust policies and open-source credits retain truthful names. Exact
  exceptions live in `product_name_exceptions.json`, `devtools_strings.json`
  and `artwork_exceptions.json`; use `scripts/check_visual_identity.py --src`
  against the applied Chromium tree to reject unreviewed changes.
