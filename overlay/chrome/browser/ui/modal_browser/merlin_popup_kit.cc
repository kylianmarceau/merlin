// Copyright 2026 The Merlin Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_popup_kit.h"

#include <vector>

#include "base/memory/raw_ref.h"
#include "base/no_destructor.h"
#include "cc/paint/paint_flags.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/color/color_id.h"
#include "ui/color/color_provider.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/font_list.h"
#include "ui/gfx/geometry/point_conversions.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/paint_vector_icon.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/background.h"
#include "ui/views/controls/button/md_text_button.h"
#include "ui/views/controls/label.h"
#include "ui/views/controls/separator.h"
#include "ui/views/layout/box_layout.h"
#include "ui/views/merlin_style.h"
#include "ui/views/style/typography.h"
#include "ui/views/view.h"
#include "ui/views/view_class_properties.h"
#include "ui/views/view_utils.h"

namespace modal_browser::popup {

namespace {

// Text-color tints, so the same card reads on Merlin's cream and charcoal.
constexpr SkAlpha kCardFillAlpha = 0x0B;
constexpr SkAlpha kCardEdgeAlpha = 0x14;
constexpr SkAlpha kTileFillAlpha = 0x38;

class CardBackground : public views::Background {
 public:
  void Paint(gfx::Canvas* canvas, views::View* view) const override {
    const ui::ColorProvider* colors = view->GetColorProvider();
    if (!colors || view->GetLocalBounds().IsEmpty()) {
      return;
    }
    const SkColor ink = colors->GetColor(ui::kColorSysOnSurface);
    const float radius = views::merlin_style::kCardRadius;
    gfx::RectF bounds(view->GetLocalBounds());
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    flags.setColor(SkColorSetA(ink, kCardFillAlpha));
    canvas->DrawRoundRect(bounds, radius, flags);
    bounds.Inset(0.5f);
    flags.setStyle(cc::PaintFlags::kStroke_Style);
    flags.setStrokeWidth(1.0f);
    flags.setColor(SkColorSetA(ink, kCardEdgeAlpha));
    canvas->DrawRoundRect(bounds, radius - 0.5f, flags);
  }
};

class IconTile : public views::View {
  METADATA_HEADER(IconTile, views::View)

 public:
  explicit IconTile(const gfx::VectorIcon& icon) : icon_(icon) {
    SetPreferredSize(gfx::Size(kIconTileSize, kIconTileSize));
    GetViewAccessibility().SetIsInvisible(true);
  }

  void OnPaint(gfx::Canvas* canvas) override {
    const ui::ColorProvider* colors = GetColorProvider();
    gfx::RectF tile(GetContentsBounds());
    tile.ClampToCenteredSize(gfx::SizeF(kIconTileSize, kIconTileSize));
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    flags.setColor(
        SkColorSetA(colors->GetColor(ui::kColorSysPrimary), kTileFillAlpha));
    canvas->DrawRoundRect(tile, views::merlin_style::kControlRadius, flags);
    const gfx::Point glyph = gfx::ToRoundedPoint(
        tile.CenterPoint() -
        gfx::Vector2dF(kIconTileGlyph / 2.0f, kIconTileGlyph / 2.0f));
    canvas->Save();
    canvas->Translate(glyph.OffsetFromOrigin());
    gfx::PaintVectorIcon(canvas, *icon_, kIconTileGlyph,
                         colors->GetColor(ui::kColorSysOnSurface));
    canvas->Restore();
  }

 private:
  const raw_ref<const gfx::VectorIcon> icon_;
};

BEGIN_METADATA(IconTile)
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

}  // namespace

void StyleAsCard(views::View* view) {
  view->SetBackground(std::make_unique<CardBackground>());
}

std::unique_ptr<views::View> CreateIconTile(const gfx::VectorIcon& icon) {
  return std::make_unique<IconTile>(icon);
}

void StyleChoiceList(views::View* container) {
  std::vector<views::MdTextButton*> buttons;
  for (views::View* child : container->children()) {
    if (auto* button = views::AsViewClass<views::MdTextButton>(child)) {
      buttons.push_back(button);
    }
  }
  auto* layout = container->SetLayoutManager(std::make_unique<views::BoxLayout>(
      views::BoxLayout::Orientation::kVertical, gfx::Insets(kCardInset)));
  layout->set_cross_axis_alignment(
      views::BoxLayout::CrossAxisAlignment::kStretch);
  for (size_t i = 0; i < buttons.size(); ++i) {
    views::MdTextButton* button = buttons[i];
    if (i > 0) {
      auto separator = std::make_unique<views::Separator>();
      separator->SetProperty(views::kMarginsKey, gfx::Insets::VH(1, 10));
      container->AddChildViewAt(std::move(separator),
                                container->GetIndexOf(button).value());
    }
    button->SetStyle(ui::ButtonStyle::kText);
    button->SetBgColorOverrideDeprecated(SK_ColorTRANSPARENT);
    button->SetHorizontalAlignment(gfx::ALIGN_LEFT);
    button->SetCornerRadius(views::merlin_style::kRowRadius);
    button->SetCustomPadding(gfx::Insets::VH(0, 10));
    button->SetMinSize(gfx::Size(0, kChoiceHeight));
    button->SetLabelStyle(views::style::STYLE_BODY_3_MEDIUM);
  }
  StyleAsCard(container);
}

const gfx::FontList& TitleFont() {
  return Font(views::merlin_style::kTitleFontSize, gfx::Font::Weight::SEMIBOLD);
}

const gfx::FontList& RowTitleFont() {
  return Font(13, gfx::Font::Weight::MEDIUM);
}

void StyleSecondary(views::Label* label) {
  label->SetFontList(Font(12, gfx::Font::Weight::NORMAL));
  label->SetEnabledColor(ui::kColorSysOnSurfaceSubtle);
}

}  // namespace modal_browser::popup
