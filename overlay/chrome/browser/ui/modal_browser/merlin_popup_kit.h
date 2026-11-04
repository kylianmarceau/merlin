// Copyright 2026 The Merlin Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_POPUP_KIT_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_POPUP_KIT_H_

#include <memory>

#include "ui/gfx/geometry/insets.h"

namespace gfx {
class FontList;
struct VectorIcon;
}  // namespace gfx
namespace views {
class Label;
class View;
}  // namespace views

// Building blocks for Merlin's own pop-up layouts (permission prompts, site
// information, the profile menu). They follow the Settings page: grouped
// rows on a rounded card instead of full-width separators, a gold-tinted
// tile behind each row icon, and choices listed in one card rather than as
// a stack of separate buttons.
//
// Each Chromium view keeps its controller, callbacks, element identifiers,
// accessible names and strings; these helpers change presentation only.
// Callers check views::merlin_style::IsEnabled() first.
namespace modal_browser::popup {

// Card metrics, in DIPs.
inline constexpr int kCardInset = 4;
inline constexpr int kCardGap = 8;
inline constexpr int kPopupSideInset = 12;
inline constexpr int kIconTileSize = 28;
inline constexpr int kIconTileGlyph = 16;
inline constexpr int kChoiceHeight = 34;

// Gives `view` a card background: a faint tint of the text color over the
// pop-up surface with a hairline edge, rounded like the Settings cards.
void StyleAsCard(views::View* view);

// A rounded square tinted with Merlin's gold behind `icon`, for the start of
// a row. Decorative: hidden from accessibility.
std::unique_ptr<views::View> CreateIconTile(const gfx::VectorIcon& icon);

// Turns `container`, whose children are views::MdTextButtons, into one card
// listing them as rows with hairlines between. Every button keeps its
// callback, ID and element identifier; they are given equal visual weight,
// so no choice is pushed on the user.
void StyleChoiceList(views::View* container);

// Pop-up title and secondary text, set like the Settings page.
const gfx::FontList& TitleFont();
const gfx::FontList& RowTitleFont();
void StyleSecondary(views::Label* label);

}  // namespace modal_browser::popup

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_POPUP_KIT_H_
