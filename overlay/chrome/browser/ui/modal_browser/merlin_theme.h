// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_THEME_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_THEME_H_

#include <string>
#include <string_view>

#include "chrome/browser/ui/modal_browser/merlin_design_tokens.h"

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
// touching Chrome's theme model.
//
// The mixer steps aside when the profile has a Chrome theme or a color the
// user picked, and for high contrast and forced colors.
void InstallMerlinTheme();

struct MerlinAppearance {
  bool full_tint = true;
  bool page_colors = true;
  bool sharp_corners = false;
  bool comfortable = false;
  bool theme_hints = false;
  std::string background = "plain";
  std::string image;
  bool operator==(const MerlinAppearance&) const = default;
};
const MerlinAppearance& GetMerlinAppearance();
bool SetMerlinAppearance(MerlinAppearance appearance);

// Process-wide config; returns true only when the palette changes.
bool SetMerlinThemeColor(std::string_view color);
design::Palette MerlinPalette(bool dark);
std::string MerlinThemeCss();

// The mixer itself; public for tests.
void AddMerlinColorMixer(ui::ColorProvider* provider,
                          const ui::ColorProviderKey& key);

// Whether the mixer applies to `key`.
bool MerlinThemeApplies(const ui::ColorProviderKey& key);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_THEME_H_
