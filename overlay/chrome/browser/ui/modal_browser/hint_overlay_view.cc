// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/hint_overlay_view.h"

#include <algorithm>
#include <utility>

#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "cc/paint/paint_flags.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "ui/accessibility/ax_enums.mojom.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/shadow_value.h"
#include "ui/gfx/skia_paint_util.h"
#include "ui/views/accessibility/view_accessibility.h"

namespace modal_browser {

namespace {

constexpr int kLabelPaddingX = 4;
constexpr int kLabelHeight = 18;
// Labels sit slightly up and left of the target's corner, like a tab on it.
constexpr int kNudge = 3;

const gfx::FontList& LabelFont() {
  return style::MonoFont(-1, gfx::Font::Weight::BOLD);
}

}  // namespace

HintOverlayView::HintOverlayView() {
  GetViewAccessibility().SetRole(ax::mojom::Role::kGroup);
  GetViewAccessibility().SetName(u"Link hints");
}

HintOverlayView::~HintOverlayView() = default;

void HintOverlayView::SetHints(std::vector<HintPlacement> hints) {
  hints_ = std::move(hints);
  typed_.clear();
  const std::u16string summary =
      base::NumberToString16(hints_.size()) +
      u" hints shown. Type a label to choose, Escape to cancel.";
  GetViewAccessibility().SetName(summary);
  GetViewAccessibility().AnnouncePolitely(summary);
  SchedulePaint();
}

void HintOverlayView::SetTyped(std::u16string typed) {
  typed_ = std::move(typed);
  SchedulePaint();
}

std::vector<std::u16string> HintOverlayView::VisibleLabels() const {
  std::vector<std::u16string> out;
  for (const HintPlacement& hint : hints_) {
    if (base::StartsWith(hint.label, typed_)) {
      out.push_back(hint.label);
    }
  }
  return out;
}

gfx::Rect HintOverlayView::LabelBounds(const HintPlacement& hint) const {
  std::u16string upper = base::ToUpperASCII(hint.label);
  const int width =
      gfx::Canvas::GetStringWidth(upper, LabelFont()) + 2 * kLabelPaddingX;
  gfx::Rect rect(hint.anchor.x() - kNudge, hint.anchor.y() - kNudge, width,
                 kLabelHeight);
  // Keep labels fully inside the page area.
  rect.set_x(std::clamp(rect.x(), 0, std::max(0, this->width() - width)));
  rect.set_y(std::clamp(rect.y(), 0, std::max(0, height() - kLabelHeight)));
  return rect;
}

void HintOverlayView::OnPaint(gfx::Canvas* canvas) {
  const style::Colors& colors = style::ColorsFor(this);
  const gfx::FontList& font = LabelFont();
  const gfx::ShadowValues shadows = {
      gfx::ShadowValue(gfx::Vector2d(0, 1), 3, SkColorSetA(SK_ColorBLACK, 0x40))};
  for (const HintPlacement& hint : hints_) {
    if (!base::StartsWith(hint.label, typed_)) {
      continue;
    }
    const gfx::Rect rect = LabelBounds(hint);
    cc::PaintFlags bg;
    bg.setAntiAlias(true);
    bg.setColor(colors.hint_bg);
    bg.setLooper(gfx::CreateShadowDrawLooper(shadows));
    canvas->DrawRoundRect(gfx::RectF(rect), style::kHintRadius, bg);
    cc::PaintFlags border;
    border.setAntiAlias(true);
    border.setStyle(cc::PaintFlags::kStroke_Style);
    border.setStrokeWidth(1);
    border.setColor(colors.hint_border);
    gfx::RectF edge(rect);
    edge.Inset(0.5f);
    canvas->DrawRoundRect(edge, style::kHintRadius, border);

    // Uppercase reads better at this size; typing is case-insensitive.
    const std::u16string upper = base::ToUpperASCII(hint.label);
    const std::u16string typed = upper.substr(0, typed_.size());
    const std::u16string rest = upper.substr(typed_.size());
    int x = rect.x() + kLabelPaddingX;
    if (!typed.empty()) {
      const int w = gfx::Canvas::GetStringWidth(typed, font);
      canvas->DrawStringRect(typed, font, colors.hint_typed,
                             gfx::Rect(x, rect.y(), w + 1, rect.height()));
      x += w;
    }
    canvas->DrawStringRect(
        rest, font, colors.hint_text,
        gfx::Rect(x, rect.y(), rect.right() - x + 1, rect.height()));
  }
}

void HintOverlayView::OnThemeChanged() {
  views::View::OnThemeChanged();
  SchedulePaint();
}

BEGIN_METADATA(HintOverlayView)
END_METADATA

// -- HintHost -----------------------------------------------------------------

HintHost::HintHost(BrowserView* browser_view)
    : host_(browser_view, {.name = "ModalBrowserHints", .accept_events = false}) {
  // Hints are placed for one layout; when the window resizes, the session is
  // told through pointer activity and hides them. Until then, keep them
  // where they were.
}

HintHost::~HintHost() = default;

void HintHost::Show(std::vector<HintPlacement> hints) {
  if (!view_) {
    view_ = static_cast<HintOverlayView*>(
        host_.EnsureWidget(base::BindOnce([]() -> std::unique_ptr<views::View> {
          return std::make_unique<HintOverlayView>();
        })));
    if (!view_) {
      return;
    }
  }
  host_.ShowAt(host_.ContentsArea());
  view_->SetHints(std::move(hints));
}

void HintHost::Filter(std::u16string typed) {
  if (view_) {
    view_->SetTyped(std::move(typed));
  }
}

void HintHost::Hide() {
  host_.Hide();
}

bool HintHost::IsVisible() const {
  return host_.IsVisible();
}

}  // namespace modal_browser
