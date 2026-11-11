// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/browser/ui/modal_browser/merlin_theme.h"

#include <map>
#include <tuple>

#include "base/no_destructor.h"
#include "ui/color/color_id.h"
#include "ui/color/color_provider.h"
#include "ui/color/color_provider_key.h"
#include "ui/gfx/color_utils.h"
#include "ui/native_theme/native_theme.h"
#include "ui/views/view.h"
#include "ui/views/widget/widget.h"

namespace modal_browser::style {

namespace {

// Merlin's palette (branding/README.md): warm stone and
// charcoal neutrals with one accent, Hint yellow #F6D44A. On light surfaces
// accent text uses Ochre, since yellow text on white is unreadable.
constexpr auto& kLight = design::kLightOverlay;
constexpr auto& kDark = design::kDarkOverlay;

}  // namespace

float CardRadius() {
  return GetMerlinAppearance().sharp_corners ? 3 : 12;
}

bool IsDark(const views::View* view) {
  const ui::ColorProvider* provider = view ? view->GetColorProvider() : nullptr;
  if (!provider && view && view->GetWidget()) {
    provider = view->GetWidget()->GetColorProvider();
  }
  if (!provider) {
    return false;
  }
  return color_utils::IsDark(provider->GetColor(ui::kColorWindowBackground));
}

const Colors& ColorsFor(bool dark) {
  return dark ? kDark : kLight;
}

Colors ColorsFor(const views::View* view) {
  Colors colors = ColorsFor(IsDark(view));
  const auto* provider = view ? view->GetColorProvider() : nullptr;
  const auto& baseline = IsDark(view) ? design::kDark : design::kLight;
  if (provider &&
      provider->GetColor(ui::kColorSysPrimary) != baseline.primary) {
    colors.surface = provider->GetColor(ui::kColorBubbleBackground);
    colors.surface_raised = provider->GetColor(ui::kColorSysBaseContainer);
    colors.text = provider->GetColor(ui::kColorSysOnSurface);
    colors.text_secondary = provider->GetColor(ui::kColorSysOnSurfaceSubtle);
    colors.accent = provider->GetColor(ui::kColorSysPrimary);
    colors.accent_soft =
        SkColorSetA(provider->GetColor(ui::kColorSysPrimaryContainer), 0x5c);
  }
  if (provider && GetMerlinAppearance().theme_hints) {
    colors.hint_bg = provider->GetColor(ui::kColorToggleButtonTrackOn);
    colors.hint_text = InkOn(colors.hint_bg).text;
    colors.hint_typed = SkColorSetA(colors.hint_text, 0x99);
    colors.hint_border = SkColorSetA(colors.hint_text, 0x66);
  }
  return colors;
}

SkColor ModeColor(ffi::Mode mode, bool dark) {
  switch (mode) {
    case ffi::Mode::Insert:
      return dark ? SkColorSetRGB(0x4C, 0xC3, 0x8A) : SkColorSetRGB(0x1F, 0x8F, 0x55);
    case ffi::Mode::Hint:
      return dark ? SkColorSetRGB(0xF5, 0xB5, 0x44) : SkColorSetRGB(0xB8, 0x6E, 0x00);
    case ffi::Mode::Passthrough:
      return dark ? SkColorSetRGB(0xF2, 0x6F, 0xB4) : SkColorSetRGB(0xC2, 0x29, 0x8A);
    case ffi::Mode::Visual:
      return dark ? SkColorSetRGB(0x5E, 0xB0, 0xFF) : SkColorSetRGB(0x1F, 0x6F, 0xD1);
    case ffi::Mode::Command:
      return ColorsFor(dark).accent;
    default:
      return ColorsFor(dark).text_secondary;
  }
}

Ink InkOn(SkColor surface) {
  const bool dark = color_utils::GetContrastRatio(SK_ColorWHITE, surface) >
                    color_utils::GetContrastRatio(SK_ColorBLACK, surface);
  if (dark) {
    return {
        .text = SK_ColorWHITE,
        .text_dim = SK_ColorWHITE,
        .icon = SK_ColorWHITE,
        .icon_disabled = SkColorSetARGB(0x4D, 0xEC, 0xE8, 0xDD),
        .hover = SkColorSetARGB(0x1A, 0xFF, 0xFF, 0xFF),
        .pressed = SkColorSetARGB(0x29, 0xFF, 0xFF, 0xFF),
    };
  }
  return {
      .text = SK_ColorBLACK,
      .text_dim = SK_ColorBLACK,
      .icon = SK_ColorBLACK,
      .icon_disabled = SkColorSetARGB(0x47, 0x1C, 0x1B, 0x18),
      .hover = SkColorSetARGB(0x12, 0x28, 0x1E, 0x0A),
      .pressed = SkColorSetARGB(0x1F, 0x28, 0x1E, 0x0A),
  };
}

bool PageColorsAllowed(const ui::ColorProviderKey& key) {
  return key.contrast_mode != ui::ColorProviderKey::ContrastMode::kHigh &&
         key.forced_colors == ui::ColorProviderKey::ForcedColors::kNone;
}

std::optional<SkColor> PageSurface(const views::View* view,
                                   std::optional<SkColor> surface) {
  if (!GetMerlinAppearance().page_colors)
    return std::nullopt;
  return view && view->GetWidget() &&
                 !PageColorsAllowed(
                     view->GetNativeTheme()->GetColorProviderKey(nullptr))
             ? std::nullopt
             : surface;
}

const gfx::FontList& UiFont(int size_delta, gfx::Font::Weight weight) {
  static base::NoDestructor<std::map<std::tuple<int, int>, gfx::FontList>>
      cache;
  auto key = std::make_tuple(size_delta, static_cast<int>(weight));
  auto it = cache->find(key);
  if (it == cache->end()) {
    it = cache
             ->emplace(key, gfx::FontList().Derive(size_delta,
                                                   gfx::Font::NORMAL, weight))
             .first;
  }
  return it->second;
}

const gfx::FontList& MonoFont(int size_delta, gfx::Font::Weight weight) {
  static base::NoDestructor<std::map<std::tuple<int, int>, gfx::FontList>>
      cache;
  auto key = std::make_tuple(size_delta, static_cast<int>(weight));
  auto it = cache->find(key);
  if (it == cache->end()) {
    // Menlo ships with every macOS; other platforms fall back to the
    // generic monospace family.
    gfx::FontList base({"Menlo", "monospace"}, gfx::Font::NORMAL,
                       gfx::FontList().GetFontSize(), gfx::Font::Weight::NORMAL);
    it = cache->emplace(key, base.Derive(size_delta, gfx::Font::NORMAL, weight))
             .first;
  }
  return it->second;
}

}  // namespace modal_browser::style
