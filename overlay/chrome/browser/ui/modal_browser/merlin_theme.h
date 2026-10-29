// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_THEME_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_THEME_H_

namespace ui {
class ColorProvider;
struct ColorProviderKey;
}  // namespace ui

namespace modal_browser {

// Merlin's colors for Chromium's own interface: window frame, toolbar,
// tabs (on top and in the sidebar), omnibox, menus and bubbles.
//
// Chromium builds every color from a pipeline of mixers, and references
// between colors resolve against the last mixer in the pipeline
// (ui/color/color_provider.cc). So one mixer appended after Chrome's own that
// redefines the base system colors (kColorSysHeader, kColorSysBase, ...)
// recolors everything derived from them, with no upstream patch and without
// touching Chrome's theme model (DECISIONS 16, 33).
//
// The mixer steps aside when the profile has a Chrome theme or a color the
// user picked, and for high contrast and forced colors.
void InstallMerlinTheme();

// The mixer itself; public for tests.
void AddMerlinColorMixer(ui::ColorProvider* provider,
                          const ui::ColorProviderKey& key);

// Whether the mixer applies to `key`.
bool MerlinThemeApplies(const ui::ColorProviderKey& key);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_THEME_H_
