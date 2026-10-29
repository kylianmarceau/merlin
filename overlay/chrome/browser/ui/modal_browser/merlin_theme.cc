// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_theme.h"

#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "ui/color/color_id.h"
#include "ui/color/color_mixer.h"
#include "ui/color/color_provider.h"
#include "ui/color/color_provider_key.h"
#include "ui/color/color_provider_manager.h"
#include "ui/color/color_recipe.h"

namespace modal_browser {

namespace {

// One set of base colors per mode. Names follow Chromium's system tokens;
// comments say where they show in Merlin.
struct Palette {
  SkColor header;             // window frame, inactive tabs, tab sidebar
  SkColor header_inactive;    // the same in a background window
  SkColor base;               // toolbar and the active tab
  SkColor base_container;     // filled controls on the toolbar
  SkColor base_elevated;      // raised controls
  SkColor surface;            // menus, bubbles, dialogs
  SkColor omnibox;            // the address field
  SkColor on_surface;         // primary text and icons
  SkColor on_surface_subtle;  // secondary text and icons
  SkColor on_header;          // text and icons on the frame
  SkColor divider;            // hairlines
  SkColor outline;            // control borders
  SkColor header_hover;       // hover on frame items (tabs, buttons)
  SkColor primary;            // links, toggles, progress, selection
  SkColor on_primary;
  SkColor primary_container;  // selected rows, tonal buttons
  SkColor on_primary_container;
  SkColor focus_ring;
  SkColor text_highlight;     // selected text in the omnibox and fields
};

constexpr Palette kLight = {
    .header = SkColorSetRGB(0xEC, 0xE7, 0xDD),
    .header_inactive = SkColorSetRGB(0xF1, 0xED, 0xE5),
    .base = SkColorSetRGB(0xF8, 0xF5, 0xEE),
    .base_container = SkColorSetRGB(0xEF, 0xEB, 0xE2),
    .base_elevated = SkColorSetRGB(0xFF, 0xFF, 0xFF),
    .surface = SkColorSetRGB(0xFD, 0xFC, 0xF8),
    .omnibox = SkColorSetRGB(0xEE, 0xE9, 0xDF),
    .on_surface = SkColorSetRGB(0x1C, 0x1B, 0x18),
    .on_surface_subtle = SkColorSetRGB(0x61, 0x5C, 0x51),
    .on_header = SkColorSetRGB(0x3A, 0x37, 0x2F),
    .divider = SkColorSetRGB(0xDD, 0xD6, 0xC8),
    .outline = SkColorSetRGB(0xCF, 0xC7, 0xB6),
    .header_hover = SkColorSetRGB(0xE2, 0xDC, 0xCF),
    .primary = SkColorSetRGB(0x7A, 0x60, 0x00),
    .on_primary = SkColorSetRGB(0xFF, 0xFF, 0xFF),
    .primary_container = SkColorSetRGB(0xF7, 0xE7, 0xA8),
    .on_primary_container = SkColorSetRGB(0x2E, 0x24, 0x00),
    .focus_ring = SkColorSetRGB(0xB8, 0x92, 0x0E),
    .text_highlight = SkColorSetRGB(0xF8, 0xE5, 0x96),
};

constexpr Palette kDark = {
    .header = SkColorSetRGB(0x12, 0x11, 0x0F),
    .header_inactive = SkColorSetRGB(0x17, 0x16, 0x13),
    .base = SkColorSetRGB(0x1E, 0x1D, 0x19),
    .base_container = SkColorSetRGB(0x26, 0x24, 0x1F),
    .base_elevated = SkColorSetRGB(0x2C, 0x2A, 0x24),
    .surface = SkColorSetRGB(0x1E, 0x1D, 0x19),
    .omnibox = SkColorSetRGB(0x2A, 0x28, 0x22),
    .on_surface = SkColorSetRGB(0xEC, 0xE8, 0xDD),
    .on_surface_subtle = SkColorSetRGB(0xA6, 0xA1, 0x94),
    .on_header = SkColorSetRGB(0xD9, 0xD4, 0xC7),
    .divider = SkColorSetRGB(0x2E, 0x2C, 0x26),
    .outline = SkColorSetRGB(0x45, 0x42, 0x3A),
    .header_hover = SkColorSetRGB(0x24, 0x22, 0x1D),
    .primary = SkColorSetRGB(0xF6, 0xD4, 0x4A),
    .on_primary = SkColorSetRGB(0x1A, 0x1A, 0x1A),
    .primary_container = SkColorSetRGB(0x4A, 0x3F, 0x12),
    .on_primary_container = SkColorSetRGB(0xF7, 0xE7, 0xA8),
    .focus_ring = SkColorSetRGB(0xF6, 0xD4, 0x4A),
    .text_highlight = SkColorSetRGB(0x5A, 0x4C, 0x14),
};

}  // namespace

bool MerlinThemeApplies(const ui::ColorProviderKey& key) {
  if (key.custom_theme || key.user_color.has_value()) {
    return false;
  }
  if (key.contrast_mode == ui::ColorProviderKey::ContrastMode::kHigh ||
      key.forced_colors != ui::ColorProviderKey::ForcedColors::kNone) {
    return false;
  }
  return true;
}

void AddMerlinColorMixer(ui::ColorProvider* provider,
                          const ui::ColorProviderKey& key) {
  if (!MerlinThemeApplies(key)) {
    return;
  }
  const Palette& p =
      key.color_mode == ui::ColorProviderKey::ColorMode::kDark ? kDark : kLight;
  ui::ColorMixer& mixer = provider->AddMixer();

  mixer[ui::kColorSysHeader] = {p.header};
  mixer[ui::kColorSysHeaderInactive] = {p.header_inactive};
  mixer[ui::kColorSysHeaderContainer] = {p.base};
  mixer[ui::kColorSysHeaderContainerInactive] = {p.base};
  mixer[ui::kColorSysOnHeaderPrimary] = {p.on_header};
  mixer[ui::kColorSysOnHeaderPrimaryInactive] = {p.on_surface_subtle};
  mixer[ui::kColorSysOnHeaderDivider] = {p.divider};
  mixer[ui::kColorSysOnHeaderDividerInactive] = {p.divider};
  mixer[ui::kColorSysStateHeaderHover] = {p.header_hover};
  mixer[ui::kColorSysStateHeaderHoverInactive] = {p.header_hover};

  mixer[ui::kColorSysBase] = {p.base};
  mixer[ui::kColorSysBaseContainer] = {p.base_container};
  mixer[ui::kColorSysBaseContainerElevated] = {p.base_elevated};
  mixer[ui::kColorSysSurface] = {p.surface};
  mixer[ui::kColorSysOmniboxContainer] = {p.omnibox};

  mixer[ui::kColorSysOnSurface] = {p.on_surface};
  mixer[ui::kColorSysOnSurfaceSecondary] = {p.on_surface_subtle};
  mixer[ui::kColorSysOnSurfaceSubtle] = {p.on_surface_subtle};
  mixer[ui::kColorSysDivider] = {p.divider};
  mixer[ui::kColorSysNeutralOutline] = {p.outline};
  mixer[ui::kColorSysTonalOutline] = {p.outline};

  mixer[ui::kColorSysPrimary] = {p.primary};
  mixer[ui::kColorSysOnPrimary] = {p.on_primary};
  mixer[ui::kColorSysPrimaryContainer] = {p.primary_container};
  mixer[ui::kColorSysOnPrimaryContainer] = {p.on_primary_container};
  mixer[ui::kColorSysTonalContainer] = {p.primary_container};
  mixer[ui::kColorSysOnTonalContainer] = {p.on_primary_container};
  mixer[ui::kColorSysStateFocusRing] = {p.focus_ring};
  mixer[ui::kColorSysStateTextHighlight] = {p.text_highlight};
  mixer[ui::kColorSysStateOnTextHighlight] = {p.on_surface};
}

void InstallMerlinTheme() {
  static bool installed = false;
  if (installed) {
    return;
  }
  installed = true;
  ui::ColorProviderManager& manager = ui::ColorProviderManager::Get();
  manager.AppendColorProviderInitializer(
      base::BindRepeating(&AddMerlinColorMixer));
  // Providers made before this (the first window's) are rebuilt with it.
  manager.ResetColorProviderCache();
}

}  // namespace modal_browser
