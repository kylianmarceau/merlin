// Copyright 2026 The Merlin Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_POPUP_KIT_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_POPUP_KIT_H_

#include <memory>

namespace gfx {
class FontList;
struct VectorIcon;
}  // namespace gfx
namespace views {
class Label;
class MdTextButton;
class View;
}  // namespace views

// Building blocks for Merlin's pop-ups (permission prompts, site
// information, the profile menu). They follow macOS popovers: a plain grey
// panel hanging from a toolbar button, a grey circle in front of the
// message, two equal grey buttons, and hairlines between groups.
//
// Each Chromium view keeps its controller, callbacks, element identifiers,
// accessible names and strings; these helpers change presentation only.
// Callers check views::merlin_style::IsEnabled() first.
namespace modal_browser::popup {

// Metrics, in DIPs.
inline constexpr int kIconCircleSize = 30;
inline constexpr int kIconGlyph = 16;
inline constexpr int kIconTextGap = 12;
inline constexpr int kButtonHeight = 32;
inline constexpr int kButtonRadius = 10;
inline constexpr int kButtonGap = 8;
inline constexpr int kHairlineInset = 12;

// A grey circle behind `icon`, a little lighter (or darker) than the pop-up.
// Decorative: hidden from accessibility.
std::unique_ptr<views::View> CreateIconCircle(const gfx::VectorIcon& icon);

// Lays out `container`, which owns all three buttons, as Merlin's decision
// row: `decline` and `accept` side by side at equal width, and `other`, if
// given, as a quiet text button centred below. Each button keeps its
// callback, ID and element identifier.
void StyleDecisionButtons(views::View* container,
                          views::MdTextButton* decline,
                          views::MdTextButton* accept,
                          views::MdTextButton* other);

// A hairline between groups of rows, inset from the pop-up's edges.
std::unique_ptr<views::View> CreateHairline(int vertical_margin);

// Pop-up title, body and secondary text.
const gfx::FontList& TitleFont();
const gfx::FontList& BodyFont();
void StyleSecondary(views::Label* label);

}  // namespace modal_browser::popup

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_POPUP_KIT_H_
