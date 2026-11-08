# Plan: More appearance options

## Goal

Let people choose Merlin's colours, like Dia's "Theme Color" row, without
losing the current look as the default. The choice is app-wide: one colour
for every window, the same way `popup_transparency` works.

Settings > Appearance already has Theme, Tabs, Hide tabs, Pop-up
transparency and Fonts. This adds to that section.

## 1. Theme colour

- **Setting:** a "Theme colour" row in Settings > Appearance, under
  "Theme". It shows a row of swatches: Default (neutral) plus about 8
  presets (green, blue, purple, yellow, pink, red, orange, graphite).
- **Custom colour:** the last swatch opens a colour picker for any hex
  value.
- **Saved as:** `theme_color = "default"` or `"#RRGGBB"` in `[options]` in
  the config file.
- **What it colours:**
  - the window frame and sidebar background (a light tint in light mode, a
    deep tint in dark mode)
  - the accent: selected tab, focus rings, toggles, the split outline, the
    start page
  - frosted pop-ups pick up a faint tint of it
- **Where the code goes:** `merlin_theme.cc` already redefines the base
  `kColorSys*` colours. It would build them from the chosen colour instead
  of the fixed palette. Settings and the start page would read the same
  colour through the existing design tokens.
- **Rules to keep:**
  - Text colour (light or dark) is picked automatically for contrast, the
    same way tabs already handle page colour.
  - High contrast and forced colours still override it.
  - The active tab still takes the page's colour (decision 38). The theme
    colour fills everything around it.
  - Private windows keep their fixed dark look so they stay recognisable.

## 2. Other ideas worth adding (ranked)

1. **Accent only vs. full tint:** a toggle for whether the colour tints the
   whole window frame or only accents.
2. **Page-colour matching on/off:** let people turn off the active tab
   taking the page's colour if they'd rather have a steady theme.
3. **Corner style:** rounded (current) or sharper corners on the page card
   and pop-ups.
4. **Density:** compact or comfortable spacing for tab rows and the
   toolbar.
5. **Start page background:** plain, theme gradient, or an image they
   choose.
6. **Link-hint colour:** hints are always Hint yellow today. Let them
   follow the theme colour, or stay yellow.

## 3. Steps

1. Add the `theme_color` option to the config parser and
   `docs/config.example.toml`.
2. Make `merlin_theme.cc` build its colour set from one seed colour, with
   automatic light and dark versions.
3. Add the swatch row and colour picker to the Appearance section of
   `merlin_settings_page.cc`.
4. Re-apply colours live in every open window when the setting changes,
   with no restart.
5. Tests: a browser test for each preset in light and dark mode, plus a
   contrast check that text on every preset meets WCAG AA.
6. Docs: one new entry in `DECISIONS.md` and an update to
   `VISUAL_IDENTITY.md`.
