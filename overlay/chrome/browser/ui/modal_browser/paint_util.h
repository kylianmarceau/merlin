// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_PAINT_UTIL_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_PAINT_UTIL_H_

#include <string>
#include <string_view>
#include <vector>

#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "ui/gfx/geometry/rect.h"

namespace gfx {
class Canvas;
}

// Painting helpers shared by the palette, status pill and hint layer.
namespace modal_browser::paint {

// A rounded card with a soft drop shadow and a hairline border. `rect` is
// the card itself; the shadow paints outside it, so callers leave
// style::kShadowMargin around it.
void DrawCard(gfx::Canvas* canvas,
              const gfx::Rect& rect,
              int radius,
              const style::Colors& colors,
              SkColor fill);

// Splits a key hint such as "J  gt" into keys {"J", "gt"}.
std::vector<std::u16string> SplitKeys(std::u16string_view keys);

// Width of the keycaps for `keys`, including gaps.
int KeycapsWidth(const std::vector<std::u16string>& keys);

// Draws keycaps right-aligned so they end at `right`, centered on
// `center_y`. Returns the x where they start.
int DrawKeycaps(gfx::Canvas* canvas,
                const std::vector<std::u16string>& keys,
                int right,
                int center_y,
                const style::Colors& colors);

// Draws one line of text in `rect`, left-aligned and vertically centered.
// Characters at `marks` (UTF-16 offsets, ascending) use `mark_font` and
// `mark_color`. Elides with "…" when the text does not fit. Returns the
// width drawn.
int DrawMarkedText(gfx::Canvas* canvas,
                   std::u16string_view text,
                   const std::vector<uint32_t>& marks,
                   const gfx::Rect& rect,
                   const gfx::FontList& font,
                   const gfx::FontList& mark_font,
                   SkColor color,
                   SkColor mark_color);

}  // namespace modal_browser::paint

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_PAINT_UTIL_H_
