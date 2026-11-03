// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MODAL_STYLE_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MODAL_STYLE_H_

#include <optional>

#include "components/modal_browser/ffi/src/lib.rs.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/font_list.h"

namespace views {
class View;
}
namespace ui {
struct ColorProviderKey;
}

// The visual language of the modal layer's surfaces (palette, status pill,
// which-key panel, hint labels), in one place. Two palettes, light and dark,
// chosen from the browser window's theme. Colors are our own; nothing here
// copies another product's artwork.
namespace modal_browser::style {

struct Colors {
  SkColor surface;         // card backgrounds
  SkColor surface_raised;  // selected row, keycaps
  SkColor border;          // hairline around cards
  SkColor shadow;          // drop shadow tint
  SkColor text;            // primary text
  SkColor text_secondary;  // URLs, summaries
  SkColor text_tertiary;   // placeholders, footers
  SkColor accent;          // matched characters, prompt, focus
  SkColor accent_soft;     // selected-row tint
  SkColor error;
  SkColor hint_bg;         // link hint label
  SkColor hint_text;
  SkColor hint_typed;      // characters already typed in a label
  SkColor hint_border;
};

// Light or dark, from the color provider of `view` (or its widget).
bool IsDark(const views::View* view);
const Colors& ColorsFor(bool dark);
inline const Colors& ColorsFor(const views::View* view) {
  return ColorsFor(IsDark(view));
}

// Mode pill colors: the dot and the label tint.
SkColor ModeColor(ffi::Mode mode, bool dark);

// Text and icon colors that read on `surface`, whatever its color: Merlin's
// charcoal ink on light surfaces, its cream on dark ones. The toolbar and
// the active tab take the page's color, so everything drawn on them uses
// this.
struct Ink {
  SkColor text;
  SkColor text_dim;
  SkColor icon;
  SkColor icon_disabled;
  SkColor hover;
  SkColor pressed;
};
Ink InkOn(SkColor surface);

// Page-derived colours must not override high-contrast or forced-colour UI.
bool PageColorsAllowed(const ui::ColorProviderKey& key);
std::optional<SkColor> PageSurface(const views::View* view,
                                   std::optional<SkColor> surface);

// Fonts. UI text uses the system font; keys and hint labels use a monospaced
// face so labels line up and are easy to read at a glance.
const gfx::FontList& UiFont(int size_delta = 0,
                            gfx::Font::Weight weight = gfx::Font::Weight::NORMAL);
const gfx::FontList& MonoFont(int size_delta = 0,
                              gfx::Font::Weight weight = gfx::Font::Weight::MEDIUM);

// Metrics, in DIPs.
inline constexpr int kPaletteWidth = 640;
inline constexpr int kPaletteMinMargin = 24;
inline constexpr int kPaletteRadius = 14;
inline constexpr int kPaletteInputHeight = 52;
inline constexpr int kPaletteRowHeight = 40;
inline constexpr int kPaletteMaxVisibleRows = 8;
inline constexpr int kPaletteFooterHeight = 30;
inline constexpr int kShadowMargin = 24;
inline constexpr int kPillHeight = 26;
inline constexpr int kPillRadius = 13;
inline constexpr int kEdgeMargin = 12;
inline constexpr int kKeycapHeight = 20;
inline constexpr int kKeycapRadius = 5;
inline constexpr int kHintRadius = 4;
// The page card: the toolbar and the page as one surface, inset from the
// window's sides, rounded at its four outer corners.
inline constexpr int kCardSide = 8;
inline constexpr float kCardRadius = 12;
// Delay before the which-key panel appears after a prefix, so fast
// sequences like `gg` never flash it.
inline constexpr int kWhichKeyDelayMs = 400;

}  // namespace modal_browser::style

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MODAL_STYLE_H_
