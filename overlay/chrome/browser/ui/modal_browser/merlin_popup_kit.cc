// Copyright 2026 The Merlin Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_popup_kit.h"

#include <utility>
#include <vector>

#include "base/memory/raw_ref.h"
#include "base/no_destructor.h"
#include "cc/paint/paint_flags.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/color/color_id.h"
#include "ui/color/color_provider.h"
#include "ui/color/color_variant.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/color_utils.h"
#include "ui/gfx/font_list.h"
#include "ui/gfx/geometry/point_conversions.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/paint_vector_icon.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/controls/button/md_text_button.h"
#include "ui/views/controls/label.h"
#include "ui/views/controls/separator.h"
#include "ui/views/layout/box_layout.h"
#include "ui/views/layout/table_layout.h"
#include "ui/views/style/typography.h"
#include "ui/views/view.h"
#include "ui/views/view_class_properties.h"

namespace modal_browser::popup {

namespace {

// How far the icon circle moves from the pop-up's grey toward contrast.
constexpr SkAlpha kCircleBlend = 0x26;

class IconCircle : public views::View {
  METADATA_HEADER(IconCircle, views::View)

 public:
  explicit IconCircle(const gfx::VectorIcon& icon) : icon_(icon) {
    SetPreferredSize(gfx::Size(kIconCircleSize, kIconCircleSize));
    GetViewAccessibility().SetIsInvisible(true);
  }

  void OnPaint(gfx::Canvas* canvas) override {
    const ui::ColorProvider* colors = GetColorProvider();
    gfx::RectF circle(GetContentsBounds());
    circle.ClampToCenteredSize(gfx::SizeF(kIconCircleSize, kIconCircleSize));
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    flags.setColor(color_utils::BlendTowardMaxContrast(
        colors->GetColor(ui::kColorBubbleBackground), kCircleBlend));
    canvas->DrawCircle(circle.CenterPoint(), kIconCircleSize / 2.0f, flags);
    const gfx::Point glyph = gfx::ToRoundedPoint(
        circle.CenterPoint() -
        gfx::Vector2dF(kIconGlyph / 2.0f, kIconGlyph / 2.0f));
    canvas->Save();
    canvas->Translate(glyph.OffsetFromOrigin());
    gfx::PaintVectorIcon(canvas, *icon_, kIconGlyph,
                         colors->GetColor(ui::kColorSysOnSurface));
    canvas->Restore();
  }

 private:
  const raw_ref<const gfx::VectorIcon> icon_;
};

BEGIN_METADATA(IconCircle)
END_METADATA

const gfx::FontList& Font(int size, gfx::Font::Weight weight) {
  // Few combinations are used; cache them as the palette's UiFont does.
  static base::NoDestructor<std::vector<std::pair<int, gfx::FontList>>> cache;
  const int key = size * 1000 + static_cast<int>(weight);
  for (const auto& [k, font] : *cache) {
    if (k == key) {
      return font;
    }
  }
  const gfx::FontList base;
  cache->emplace_back(key, base.DeriveWithSizeDelta(size - base.GetFontSize())
                               .DeriveWithWeight(weight));
  return cache->back().second;
}

void StyleButton(views::MdTextButton* button, ui::ButtonStyle style) {
  button->SetStyle(style);
  button->SetCornerRadius(kButtonRadius);
  button->SetCustomPadding(gfx::Insets::VH(0, 10));
  button->SetMinSize(gfx::Size(0, kButtonHeight));
  button->SetLabelStyle(views::style::STYLE_BODY_3_MEDIUM);
}

}  // namespace

std::unique_ptr<views::View> CreateIconCircle(const gfx::VectorIcon& icon) {
  return std::make_unique<IconCircle>(icon);
}

void StyleDecisionButtons(views::View* container,
                          views::MdTextButton* decline,
                          views::MdTextButton* accept,
                          views::MdTextButton* other) {
  std::unique_ptr<views::MdTextButton> owned_decline =
      container->RemoveChildViewT(decline);
  std::unique_ptr<views::MdTextButton> owned_accept =
      container->RemoveChildViewT(accept);
  std::unique_ptr<views::MdTextButton> owned_other =
      other ? container->RemoveChildViewT(other) : nullptr;

  auto* layout = container->SetLayoutManager(std::make_unique<views::BoxLayout>(
      views::BoxLayout::Orientation::kVertical, gfx::Insets(), 4));
  layout->set_cross_axis_alignment(
      views::BoxLayout::CrossAxisAlignment::kStretch);

  // Two columns linked to the same width, sharing any spare room equally.
  auto* row = container->AddChildView(std::make_unique<views::View>());
  row->SetLayoutManager(std::make_unique<views::TableLayout>())
      ->AddColumn(views::LayoutAlignment::kStretch,
                  views::LayoutAlignment::kStretch, 1.0f,
                  views::TableLayout::ColumnSize::kUsePreferred, 0, 0)
      .AddPaddingColumn(views::TableLayout::kFixedSize, kButtonGap)
      .AddColumn(views::LayoutAlignment::kStretch,
                 views::LayoutAlignment::kStretch, 1.0f,
                 views::TableLayout::ColumnSize::kUsePreferred, 0, 0)
      .LinkColumnSizes({0, 2})
      .AddRows(1, views::TableLayout::kFixedSize);
  StyleButton(owned_decline.get(), ui::ButtonStyle::kTonal);
  StyleButton(owned_accept.get(), ui::ButtonStyle::kProminent);
  row->AddChildView(std::move(owned_decline));
  row->AddChildView(std::move(owned_accept));

  if (owned_other) {
    StyleButton(owned_other.get(), ui::ButtonStyle::kText);
    owned_other->SetMinSize(gfx::Size(0, kButtonHeight - 4));
    owned_other->SetLabelStyle(views::style::STYLE_BODY_4);
    owned_other->SetEnabledTextColors(ui::kColorSysOnSurfaceSubtle);
    owned_other->SetBgColorOverride(ui::ColorVariant(SK_ColorTRANSPARENT));
    container->AddChildView(std::move(owned_other));
  }
}

std::unique_ptr<views::View> CreateHairline(int vertical_margin) {
  auto hairline = std::make_unique<views::Separator>();
  hairline->SetProperty(views::kMarginsKey,
                        gfx::Insets::VH(vertical_margin, kHairlineInset));
  return hairline;
}

const gfx::FontList& TitleFont() {
  return Font(14, gfx::Font::Weight::SEMIBOLD);
}

const gfx::FontList& BodyFont() {
  return Font(13, gfx::Font::Weight::NORMAL);
}

void StyleSecondary(views::Label* label) {
  label->SetFontList(Font(12, gfx::Font::Weight::NORMAL));
  label->SetEnabledColor(ui::kColorSysOnSurfaceSubtle);
}

}  // namespace modal_browser::popup
