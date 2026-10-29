// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/modal_style.h"

#include <map>
#include <tuple>

#include "base/no_destructor.h"
#include "ui/color/color_id.h"
#include "ui/color/color_provider.h"
#include "ui/gfx/color_utils.h"
#include "ui/views/view.h"
#include "ui/views/widget/widget.h"

namespace modal_browser::style {

namespace {

// Merlin's palette (branding/README.md): warm stone and
// charcoal neutrals with one accent, Hint yellow #F6D44A. On light surfaces
// accent text uses Ochre, since yellow text on white is unreadable.
constexpr Colors kLight = {
    .surface = SkColorSetARGB(0xFA, 0xFD, 0xFC, 0xF8),
    .surface_raised = SkColorSetRGB(0xF3, 0xEF, 0xE6),
    .border = SkColorSetARGB(0x1F, 0x28, 0x1E, 0x0A),
    .shadow = SkColorSetARGB(0x33, 0x28, 0x1E, 0x0A),
    .text = SkColorSetRGB(0x1C, 0x1B, 0x18),
    .text_secondary = SkColorSetRGB(0x61, 0x5C, 0x51),
    .text_tertiary = SkColorSetRGB(0x85, 0x7F, 0x70),
    .accent = SkColorSetRGB(0x7A, 0x60, 0x00),
    .accent_soft = SkColorSetARGB(0x5C, 0xF6, 0xD4, 0x4A),
    .error = SkColorSetRGB(0xB3, 0x26, 0x1E),
    .hint_bg = SkColorSetRGB(0xF6, 0xD4, 0x4A),
    .hint_text = SkColorSetRGB(0x1A, 0x1A, 0x1A),
    .hint_typed = SkColorSetARGB(0x66, 0x1A, 0x1A, 0x1A),
    .hint_border = SkColorSetARGB(0x59, 0x78, 0x5A, 0x00),
};

constexpr Colors kDark = {
    .surface = SkColorSetARGB(0xF5, 0x1C, 0x1B, 0x18),
    .surface_raised = SkColorSetRGB(0x2A, 0x28, 0x22),
    .border = SkColorSetARGB(0x24, 0xFF, 0xFF, 0xFF),
    .shadow = SkColorSetARGB(0x80, 0x00, 0x00, 0x00),
    .text = SkColorSetRGB(0xEC, 0xE8, 0xDD),
    .text_secondary = SkColorSetRGB(0xA6, 0xA1, 0x94),
    .text_tertiary = SkColorSetRGB(0x7C, 0x77, 0x6A),
    .accent = SkColorSetRGB(0xF6, 0xD4, 0x4A),
    .accent_soft = SkColorSetARGB(0x2E, 0xF6, 0xD4, 0x4A),
    .error = SkColorSetRGB(0xFF, 0x7A, 0x7A),
    .hint_bg = SkColorSetRGB(0xF6, 0xD4, 0x4A),
    .hint_text = SkColorSetRGB(0x1A, 0x1A, 0x1A),
    .hint_typed = SkColorSetARGB(0x66, 0x1A, 0x1A, 0x1A),
    .hint_border = SkColorSetARGB(0x66, 0x00, 0x00, 0x00),
};

}  // namespace

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
