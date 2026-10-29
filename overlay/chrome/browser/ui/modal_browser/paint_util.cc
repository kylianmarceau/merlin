// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/paint_util.h"

#include <algorithm>

#include "cc/paint/paint_flags.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/shadow_value.h"
#include "ui/gfx/skia_paint_util.h"
#include "ui/gfx/text_constants.h"

namespace modal_browser::paint {

namespace {

constexpr int kKeycapPadding = 6;
constexpr int kKeycapGap = 4;
constexpr char16_t kEllipsis[] = u"\u2026";

const gfx::FontList& KeyFont() {
  return style::MonoFont(-2, gfx::Font::Weight::MEDIUM);
}

}  // namespace

void DrawCard(gfx::Canvas* canvas,
              const gfx::Rect& rect,
              int radius,
              const style::Colors& colors,
              SkColor fill) {
  // Two layers of shadow: a wide, soft ambient one and a tight key one.
  gfx::ShadowValues shadows = {
      gfx::ShadowValue(gfx::Vector2d(0, 8), 28,
                       SkColorSetA(colors.shadow, SkColorGetA(colors.shadow))),
      gfx::ShadowValue(gfx::Vector2d(0, 1), 3,
                       SkColorSetA(colors.shadow, SkColorGetA(colors.shadow) / 2)),
  };
  cc::PaintFlags shadow_flags;
  shadow_flags.setAntiAlias(true);
  shadow_flags.setColor(fill);
  shadow_flags.setLooper(gfx::CreateShadowDrawLooper(shadows));
  canvas->DrawRoundRect(gfx::RectF(rect), radius, shadow_flags);

  cc::PaintFlags fill_flags;
  fill_flags.setAntiAlias(true);
  fill_flags.setColor(fill);
  canvas->DrawRoundRect(gfx::RectF(rect), radius, fill_flags);

  cc::PaintFlags border;
  border.setAntiAlias(true);
  border.setStyle(cc::PaintFlags::kStroke_Style);
  border.setStrokeWidth(1);
  border.setColor(colors.border);
  gfx::RectF hairline(rect);
  hairline.Inset(0.5f);
  canvas->DrawRoundRect(hairline, radius, border);
}

std::vector<std::u16string> SplitKeys(std::u16string_view keys) {
  std::vector<std::u16string> out;
  size_t start = 0;
  while (start < keys.size()) {
    size_t end = keys.find(u"  ", start);
    if (end == std::u16string_view::npos) {
      end = keys.size();
    }
    if (end > start) {
      out.emplace_back(keys.substr(start, end - start));
    }
    start = end + 2;
  }
  return out;
}

int KeycapsWidth(const std::vector<std::u16string>& keys) {
  int width = 0;
  for (const std::u16string& key : keys) {
    width += gfx::Canvas::GetStringWidth(key, KeyFont()) + 2 * kKeycapPadding;
  }
  if (!keys.empty()) {
    width += kKeycapGap * static_cast<int>(keys.size() - 1);
  }
  return width;
}

int DrawKeycaps(gfx::Canvas* canvas,
                const std::vector<std::u16string>& keys,
                int right,
                int center_y,
                const style::Colors& colors) {
  int x = right - KeycapsWidth(keys);
  const int start = x;
  for (const std::u16string& key : keys) {
    const int w =
        gfx::Canvas::GetStringWidth(key, KeyFont()) + 2 * kKeycapPadding;
    gfx::Rect cap(x, center_y - style::kKeycapHeight / 2, w,
                  style::kKeycapHeight);
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    flags.setColor(colors.surface_raised);
    canvas->DrawRoundRect(gfx::RectF(cap), style::kKeycapRadius, flags);
    cc::PaintFlags stroke;
    stroke.setAntiAlias(true);
    stroke.setStyle(cc::PaintFlags::kStroke_Style);
    stroke.setStrokeWidth(1);
    stroke.setColor(colors.border);
    gfx::RectF edge(cap);
    edge.Inset(0.5f);
    canvas->DrawRoundRect(edge, style::kKeycapRadius, stroke);
    canvas->DrawStringRectWithFlags(key, KeyFont(), colors.text_secondary, cap,
                                    gfx::Canvas::TEXT_ALIGN_CENTER);
    x += w + kKeycapGap;
  }
  return start;
}

int DrawMarkedText(gfx::Canvas* canvas,
                   std::u16string_view text,
                   const std::vector<uint32_t>& marks,
                   const gfx::Rect& rect,
                   const gfx::FontList& font,
                   const gfx::FontList& mark_font,
                   SkColor color,
                   SkColor mark_color) {
  if (text.empty() || rect.width() <= 0) {
    return 0;
  }
  const int ellipsis_width = gfx::Canvas::GetStringWidth(kEllipsis, font);
  int x = rect.x();
  size_t mark_index = 0;
  size_t i = 0;
  while (i < text.size()) {
    // A run of characters that are all marked or all unmarked.
    while (mark_index < marks.size() && marks[mark_index] < i) {
      ++mark_index;
    }
    const bool marked = mark_index < marks.size() && marks[mark_index] == i;
    size_t end = i + 1;
    if (marked) {
      size_t m = mark_index;
      while (end < text.size() && m + 1 < marks.size() &&
             marks[m + 1] == end) {
        ++end;
        ++m;
      }
    } else {
      const size_t next_mark =
          mark_index < marks.size() ? marks[mark_index] : text.size();
      end = std::min<size_t>(std::max<size_t>(next_mark, i + 1), text.size());
    }
    // Never split a surrogate pair.
    if (end < text.size() && (text[end] & 0xFC00) == 0xDC00) {
      ++end;
    }
    std::u16string_view run = text.substr(i, end - i);
    const gfx::FontList& f = marked ? mark_font : font;
    int w = gfx::Canvas::GetStringWidth(run, f);
    const bool last = end >= text.size();
    const int limit = rect.right() - (last ? 0 : ellipsis_width);
    if (x + w > limit) {
      // Draw what fits of this run, then the ellipsis.
      std::u16string_view fit = run;
      while (!fit.empty() &&
             x + gfx::Canvas::GetStringWidth(fit, f) + ellipsis_width >
                 rect.right()) {
        fit.remove_suffix(1);
      }
      if (!fit.empty()) {
        canvas->DrawStringRect(
            fit, f, marked ? mark_color : color,
            gfx::Rect(x, rect.y(), rect.right() - x, rect.height()));
        x += gfx::Canvas::GetStringWidth(fit, f);
      }
      canvas->DrawStringRect(
          kEllipsis, font, color,
          gfx::Rect(x, rect.y(), rect.right() - x, rect.height()));
      return x + ellipsis_width - rect.x();
    }
    canvas->DrawStringRect(run, f, marked ? mark_color : color,
                           gfx::Rect(x, rect.y(), w + 1, rect.height()));
    x += w;
    i = end;
  }
  return x - rect.x();
}

}  // namespace modal_browser::paint
