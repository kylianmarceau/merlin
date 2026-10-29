# Merlin branding

The browser is called **Merlin**. A merlin is a small, fast falcon that
wins by agility, not size, which is how a keyboard-first browser should
feel. The mark is its tail, fanned: five feathers spread from one point,
like tabs from one window.

`modal_browser` stays the internal code name (crates, Chromium paths,
`~/.config/modal_browser`). Only user-facing names change.

## Files

| File | Use |
|---|---|
| `merlin-mark.svg` | The mark alone: the fanned tail, forest with a rust middle feather. On cream or light grounds. |
| `merlin-app-icon.svg` | macOS app icon source, 1024 × 1024 on Apple's icon grid (824 px body). |
| `merlin-app-icon-1024.png` | The app icon rendered at 1024 px. |
| `merlin.icns` | Standalone app icon, 16 px to 1024 px, for the DMG and anywhere outside the build. |
| `merlin-favicon.svg` | Full-bleed tile for small sizes: tabs, docs, the website, Merlin's own pages. |
| `merlin-mono.svg` | The fan in one colour: the menu bar template and other single-colour uses. |
| `merlin-password-favicon.svg` | The password manager's tab icon: a key on the cream tile. |

`scripts/merlin_mark.py --write` draws every SVG above from one geometry,
plus the Icon Composer layer (`overlay/.../mac/AppIcon.icon/Assets/merlin.svg`)
and the Views glyphs (`overlay/components/vector_icons/merlin/*.icon`).
Change the mark there, never in an SVG by hand. `scripts/rebrand_icons.py`
uses the same script for the WebUI icons in patch 0009.

`scripts/build_branding.sh` then regenerates the macOS icon files from
`merlin-app-icon.svg` and `AppIcon.icon`: the files here and the ones the
build uses in `overlay/chrome/app/theme/merlin/mac/` (`app.icns`,
`Assets.car`). It needs Xcode 26+ and the Chromium checkout. Commit the
outputs.

The PNG tiles in `overlay/chrome/app/theme/{merlin,default_*_percent/merlin}/`
and `overlay/components/resources/default_*_percent/merlin/` are
`merlin-favicon.svg`, `merlin-mono.svg` and `merlin-password-favicon.svg`
rendered with `scripts/render_svg.swift` at each file's size.

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
The wordmark PNGs are rendered with Syne Bold, which is not installed on
the build machine; they were drawn in a browser with the font from Google
Fonts and checked in. See `docs/DECISIONS.md` 33.

## Colors

| Name | Hex | Use |
|---|---|---|
| Cream | `#F2ECE0` | Icon tile, light brand grounds |
| Forest | `#12352E` | The mark, the wordmark, text on Cream |
| Rust | `#C4552D` | The middle feather; one accent per mark, never body text |
| Hint | `#F6D44A` | The interface accent: link-hint labels, focus, highlights |

Hint yellow belongs to the interface, not the logo: it marks what you can
press. Keep it off the icon and the wordmark.

## Type

* Wordmark: **Syne Bold**, "Merlin", tracking −2%, in Forest (white on dark).
* Interface and docs: Inter.
* Code, keys and hint labels: JetBrains Mono.

All three are on Google Fonts under the SIL Open Font License.

## Still open

* A real bundle ID. `MAC_BUNDLE_ID` in `overlay/chrome/app/theme/merlin/BRANDING`
  is the placeholder `local.merlin.Merlin`; `scripts/package_mac.sh`
  refuses to sign it.
* A trademark and App Store name check for "Merlin". The name is crowded
  (Cornell's Merlin Bird ID app, Merlin Project); use "Merlin Browser"
  where a store or domain needs it unique.
* A tagline.
* "Chrome" and "Google" still appear in some Chromium strings (sign-in,
  sync, Google services); `scripts/rebrand_strings.py --report` lists them.
  They go with the surfaces that show them.
