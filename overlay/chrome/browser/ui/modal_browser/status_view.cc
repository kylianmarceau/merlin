// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/status_view.h"

#include <algorithm>

#include "base/functional/bind.h"
#include "base/strings/string_split.h"
#include "cc/paint/paint_flags.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/browser/ui/modal_browser/paint_util.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/frame/multi_contents_view.h"
#include "ui/accessibility/ax_enums.mojom.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/views/accessibility/view_accessibility.h"

namespace modal_browser {

namespace {

constexpr int kPillPaddingX = 12;
constexpr int kDot = 7;
constexpr int kGap = 8;
constexpr int kMaxMessageWidth = 520;
constexpr int kPanelPadding = 12;
constexpr int kPanelLineHeight = 22;
constexpr int kPanelColumnWidth = 210;
constexpr int kPanelMaxRows = 10;
constexpr size_t kMaxPanelLines = 14;

// The page card and the bar under it (redesign steps 4 and 5).
constexpr int kCardTop = 2;
constexpr int kCardSide = 8;
constexpr int kBarHeight = 26;
constexpr int kBarGap = 4;  // between the card, the bar and the window edge
constexpr int kCardBottom = kBarHeight + 2 * kBarGap;
constexpr float kCardRadius = 12;
// The which-key and message panel floats inside the card, this far from
// its bottom-left corner.
constexpr int kPanelInset = 14;
constexpr int kChipHeight = 18;
constexpr int kChipPaddingX = 8;
// Below this bar width the key hints at the right are left out.
constexpr int kMinWidthForHints = 640;

const gfx::FontList& ModeFont() {
  return style::UiFont(-2, gfx::Font::Weight::SEMIBOLD);
}
const gfx::FontList& PendingFont() {
  return style::MonoFont(-1, gfx::Font::Weight::SEMIBOLD);
}
const gfx::FontList& MessageFont() {
  return style::UiFont(-1);
}
const gfx::FontList& BarTitleFont() {
  return style::UiFont(-1, gfx::Font::Weight::MEDIUM);
}

std::u16string FirstLine(const std::u16string& text) {
  return text.substr(0, text.find(u'\n'));
}

bool IsMultiline(const std::u16string& text) {
  return text.find(u'\n') != std::u16string::npos;
}

}  // namespace

StatusView::StatusView() {
  GetViewAccessibility().SetRole(ax::mojom::Role::kStatus);
  GetViewAccessibility().SetName(u"Mode status");
}

StatusView::~StatusView() = default;

void StatusView::SetState(State state) {
  const bool new_message =
      !state.message.empty() && state.message != state_.message;
  state_ = std::move(state);
  std::u16string name = state_.indicator;
  if (!state_.pending.empty()) {
    name += u" " + state_.pending;
  }
  if (!state_.message.empty()) {
    name += u". " + state_.message;
  }
  GetViewAccessibility().SetName(name);
  if (new_message) {
    GetViewAccessibility().AnnouncePolitely(state_.message);
  }
  PreferredSizeChanged();
  SchedulePaint();
}

// static
bool StatusView::HasContent(const State& state) {
  return state.bar || state.mode != ffi::Mode::Normal || !state.pending.empty() ||
         !state.message.empty();
}

bool StatusView::HasContent() const {
  return HasContent(state_);
}

bool StatusView::PanelVisible() const {
  return !PanelLines().empty() ||
         (state_.show_which_key && !state_.which_key.empty());
}

std::vector<std::u16string> StatusView::PanelLines() const {
  if (!IsMultiline(state_.message)) {
    return {};
  }
  std::vector<std::u16string> lines = base::SplitString(
      state_.message, u"\n", base::KEEP_WHITESPACE, base::SPLIT_WANT_ALL);
  // The first line is in the pill.
  lines.erase(lines.begin());
  while (!lines.empty() && lines.back().empty()) {
    lines.pop_back();
  }
  if (lines.size() > kMaxPanelLines) {
    lines.resize(kMaxPanelLines);
  }
  return lines;
}

gfx::Size StatusView::PillSize() const {
  int width = kPillPaddingX + kDot + kGap +
              gfx::Canvas::GetStringWidth(state_.indicator, ModeFont());
  if (!state_.pending.empty()) {
    width += kGap + gfx::Canvas::GetStringWidth(state_.pending, PendingFont());
  }
  if (!state_.message.empty()) {
    width += kGap * 2 + 1 +
             std::min(kMaxMessageWidth,
                      gfx::Canvas::GetStringWidth(FirstLine(state_.message),
                                                  MessageFont()));
  }
  width += kPillPaddingX;
  return gfx::Size(width, style::kPillHeight);
}

gfx::Size StatusView::PanelSize() const {
  std::vector<std::u16string> lines = PanelLines();
  if (!lines.empty()) {
    int width = 0;
    for (const std::u16string& line : lines) {
      width = std::max(width, gfx::Canvas::GetStringWidth(line, MessageFont()));
    }
    return gfx::Size(std::min(width, kMaxMessageWidth) + 2 * kPanelPadding,
                     static_cast<int>(lines.size()) * kPanelLineHeight +
                         2 * kPanelPadding);
  }
  if (!state_.show_which_key || state_.which_key.empty()) {
    return gfx::Size();
  }
  const int n = static_cast<int>(state_.which_key.size());
  const int columns = (n + kPanelMaxRows - 1) / kPanelMaxRows;
  const int rows = std::min(n, kPanelMaxRows);
  return gfx::Size(columns * kPanelColumnWidth + 2 * kPanelPadding,
                   rows * kPanelLineHeight + 2 * kPanelPadding);
}

gfx::Size StatusView::CalculatePreferredSize(
    const views::SizeBounds& available_size) const {
  const gfx::Size panel = PanelSize();
  if (state_.bar) {
    // The host sets the width (the whole page area). The height covers the
    // bar and, when shown, the panel above it inside the card.
    int height = kBarHeight + kBarGap;
    if (!panel.IsEmpty()) {
      height += kBarGap + kPanelInset + panel.height() + style::kShadowMargin;
    }
    return gfx::Size(panel.width() + 2 * style::kShadowMargin, height);
  }
  const gfx::Size pill = PillSize();
  const int width = std::max(pill.width(), panel.width());
  const int height =
      pill.height() + (panel.IsEmpty() ? 0 : panel.height() + kGap);
  return gfx::Size(width + 2 * style::kShadowMargin,
                   height + 2 * style::kShadowMargin);
}

void StatusView::OnPaint(gfx::Canvas* canvas) {
  const bool dark = style::IsDark(this);
  const style::Colors& colors = style::ColorsFor(dark);
  if (state_.bar) {
    const gfx::Rect bar(kCardSide, height() - kBarGap - kBarHeight,
                        width() - 2 * kCardSide, kBarHeight);
    const gfx::Size panel_size = PanelSize();
    if (!panel_size.IsEmpty()) {
      PaintPanel(canvas,
                 gfx::Rect(style::kShadowMargin,
                           bar.y() - kBarGap - kPanelInset - panel_size.height(),
                           panel_size.width(), panel_size.height()),
                 colors);
    }
    PaintBar(canvas, bar, dark);
    return;
  }
  const gfx::Size pill_size = PillSize();
  const gfx::Size panel_size = PanelSize();
  const int left = style::kShadowMargin;
  const int pill_top = height() - style::kShadowMargin - pill_size.height();

  // Panel above the pill.
  if (!panel_size.IsEmpty()) {
    PaintPanel(canvas,
               gfx::Rect(left, pill_top - kGap - panel_size.height(),
                         panel_size.width(), panel_size.height()),
               colors);
  }

  // The pill.
  gfx::Rect pill(left, pill_top, pill_size.width(), pill_size.height());
  paint::DrawCard(canvas, pill, style::kPillRadius, colors, colors.surface);
  int x = pill.x() + kPillPaddingX;
  const SkColor mode_color = style::ModeColor(state_.mode, dark);
  cc::PaintFlags dot;
  dot.setAntiAlias(true);
  dot.setColor(mode_color);
  canvas->DrawCircle(gfx::PointF(x + kDot / 2.f, pill.CenterPoint().y()),
                     kDot / 2.f, dot);
  x += kDot + kGap;
  const int mode_width =
      gfx::Canvas::GetStringWidth(state_.indicator, ModeFont());
  canvas->DrawStringRect(state_.indicator, ModeFont(),
                         state_.mode == ffi::Mode::Normal ? colors.text_secondary
                                                          : mode_color,
                         gfx::Rect(x, pill.y(), mode_width + 1, pill.height()));
  x += mode_width;
  if (!state_.pending.empty()) {
    x += kGap;
    const int w = gfx::Canvas::GetStringWidth(state_.pending, PendingFont());
    canvas->DrawStringRect(state_.pending, PendingFont(), colors.text,
                           gfx::Rect(x, pill.y(), w + 1, pill.height()));
    x += w;
  }
  if (!state_.message.empty()) {
    x += kGap;
    cc::PaintFlags rule;
    rule.setColor(colors.border);
    canvas->DrawRect(gfx::Rect(x, pill.y() + 7, 1, pill.height() - 14), rule);
    x += 1 + kGap;
    canvas->DrawStringRect(
        FirstLine(state_.message), MessageFont(),
        state_.message_is_error ? colors.error : colors.text,
        gfx::Rect(x, pill.y(), pill.right() - kPillPaddingX - x + 1,
                  pill.height()));
  }
}

void StatusView::PaintPanel(gfx::Canvas* canvas,
                            const gfx::Rect& panel,
                            const style::Colors& colors) {
  paint::DrawCard(canvas, panel, 10, colors, colors.surface);
  std::vector<std::u16string> lines = PanelLines();
  if (!lines.empty()) {
    int y = panel.y() + kPanelPadding;
    for (const std::u16string& line : lines) {
      canvas->DrawStringRect(
          line, MessageFont(), colors.text,
          gfx::Rect(panel.x() + kPanelPadding, y,
                    panel.width() - 2 * kPanelPadding, kPanelLineHeight));
      y += kPanelLineHeight;
    }
    return;
  }
  for (size_t i = 0; i < state_.which_key.size(); ++i) {
    const int column = static_cast<int>(i) / kPanelMaxRows;
    const int row = static_cast<int>(i) % kPanelMaxRows;
    const int x = panel.x() + kPanelPadding + column * kPanelColumnWidth;
    const int y = panel.y() + kPanelPadding + row * kPanelLineHeight;
    std::vector<std::u16string> keys = {state_.pending +
                                        state_.which_key[i].first};
    const int caps = paint::KeycapsWidth(keys);
    paint::DrawKeycaps(canvas, keys, x + caps, y + kPanelLineHeight / 2,
                       colors);
    canvas->DrawStringRect(
        state_.which_key[i].second, MessageFont(), colors.text,
        gfx::Rect(x + caps + kGap, y, kPanelColumnWidth - caps - 2 * kGap,
                  kPanelLineHeight));
  }
}

void StatusView::PaintBar(gfx::Canvas* canvas,
                          const gfx::Rect& bar,
                          bool dark) {
  const style::Colors& colors = style::ColorsFor(dark);
  const int cy = bar.CenterPoint().y();

  // Mode chip: Merlin yellow in Normal mode, the mode's own color
  // otherwise.
  int x = bar.x() + 2;
  {
    const bool normal = state_.mode == ffi::Mode::Normal;
    const SkColor fill =
        normal ? colors.hint_bg : style::ModeColor(state_.mode, dark);
    const SkColor ink = normal || dark ? colors.hint_text : SK_ColorWHITE;
    const int text_width =
        gfx::Canvas::GetStringWidth(state_.indicator, ModeFont());
    const gfx::Rect chip(x, cy - kChipHeight / 2,
                         text_width + 2 * kChipPaddingX, kChipHeight);
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    flags.setColor(fill);
    canvas->DrawRoundRect(gfx::RectF(chip), 5, flags);
    canvas->DrawStringRectWithFlags(state_.indicator, ModeFont(), ink, chip,
                                    gfx::Canvas::TEXT_ALIGN_CENTER);
    x = chip.right() + 10;
  }
  if (!state_.pending.empty()) {
    const int w = gfx::Canvas::GetStringWidth(state_.pending, PendingFont());
    canvas->DrawStringRect(state_.pending, PendingFont(), colors.text,
                           gfx::Rect(x, bar.y(), w + 1, bar.height()));
    x += w + 10;
  }

  // Right side: running downloads, then the address in sidebar mode, else
  // a few key hints.
  int right = bar.right() - 4;
  if (!state_.downloads.empty()) {
    const int w =
        gfx::Canvas::GetStringWidth(state_.downloads, PendingFont()) + 1;
    const gfx::Rect chip(right - w - 2 * kChipPaddingX, cy - kChipHeight / 2,
                         w + 2 * kChipPaddingX, kChipHeight);
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    flags.setColor(SkColorSetA(colors.text, 0x18));
    canvas->DrawRoundRect(gfx::RectF(chip), 5, flags);
    canvas->DrawStringRectWithFlags(state_.downloads, PendingFont(),
                                    colors.text, chip,
                                    gfx::Canvas::TEXT_ALIGN_CENTER);
    right = chip.x() - 14;
  }
  if (!state_.url.empty()) {
    const int w = std::min(
        bar.width() * 2 / 5,
        gfx::Canvas::GetStringWidth(state_.url, MessageFont()) + 1);
    paint::DrawMarkedText(canvas, state_.url, {},
                          gfx::Rect(right - w, bar.y(), w, bar.height()),
                          MessageFont(), MessageFont(), colors.text_secondary,
                          colors.text_secondary);
    right -= w + 16;
  } else if (bar.width() >= kMinWidthForHints && state_.message.empty()) {
    static const std::pair<const char16_t*, const char16_t*> kHints[] = {
        {u"?", u"help"}, {u"f", u"hints"}, {u":", u"command"}};
    for (const auto& [key, desc] : kHints) {
      const int w = gfx::Canvas::GetStringWidth(desc, MessageFont());
      canvas->DrawStringRect(desc, MessageFont(), colors.text_tertiary,
                             gfx::Rect(right - w, bar.y(), w + 1, bar.height()));
      right = paint::DrawKeycaps(canvas, {key}, right - w - 6, cy, colors) -
              14;
    }
  }

  // Middle: the latest message, or workspace › page.
  const int avail = right - x;
  if (avail <= 0) {
    return;
  }
  if (!state_.message.empty()) {
    paint::DrawMarkedText(canvas, FirstLine(state_.message), {},
                          gfx::Rect(x, bar.y(), avail, bar.height()),
                          MessageFont(), MessageFont(),
                          state_.message_is_error ? colors.error : colors.text,
                          colors.text);
    return;
  }
  if (!state_.workspace.empty()) {
    const std::u16string sep = u"  \u203A  ";
    const int ws = std::min(
        avail / 3, gfx::Canvas::GetStringWidth(state_.workspace, MessageFont()) +
                       1);
    paint::DrawMarkedText(canvas, state_.workspace, {},
                          gfx::Rect(x, bar.y(), ws, bar.height()),
                          MessageFont(), MessageFont(), colors.text_secondary,
                          colors.text_secondary);
    x += ws;
    const int sw = gfx::Canvas::GetStringWidth(sep, MessageFont());
    canvas->DrawStringRect(sep, MessageFont(), colors.text_tertiary,
                           gfx::Rect(x, bar.y(), sw + 1, bar.height()));
    x += sw;
  }
  if (right - x > 0 && !state_.title.empty()) {
    paint::DrawMarkedText(canvas, state_.title, {},
                          gfx::Rect(x, bar.y(), right - x, bar.height()),
                          BarTitleFont(), BarTitleFont(), colors.text,
                          colors.text);
  }
}

void StatusView::OnThemeChanged() {
  views::View::OnThemeChanged();
  SchedulePaint();
}

BEGIN_METADATA(StatusView)
END_METADATA

// -- StatusHost ---------------------------------------------------------------

StatusHost::StatusHost(BrowserView* browser_view)
    : host_(browser_view, {.name = "ModalBrowserStatus", .accept_events = false}) {
  host_.set_on_parent_bounds_changed(
      base::BindRepeating(&StatusHost::Relayout, base::Unretained(this)));
}

StatusHost::~StatusHost() = default;

void StatusHost::UpdateStatus(
    ffi::Mode mode,
    std::u16string indicator,
    std::u16string pending,
    std::vector<std::pair<std::u16string, std::u16string>> which_key) {
  const bool prefix_changed = pending != state_.pending;
  state_.mode = mode;
  state_.indicator = std::move(indicator);
  state_.pending = std::move(pending);
  state_.which_key = std::move(which_key);
  if (state_.which_key.empty()) {
    which_key_timer_.Stop();
    state_.show_which_key = false;
  } else if (prefix_changed) {
    // Show continuations only after a pause, so `gg` never flashes them.
    state_.show_which_key = false;
    which_key_timer_.Start(FROM_HERE,
                           base::Milliseconds(style::kWhichKeyDelayMs),
                           base::BindOnce(
                               [](StatusHost* self) {
                                 self->state_.show_which_key = true;
                                 self->Apply();
                               },
                               base::Unretained(this)));
  }
  Apply();
}

void StatusHost::ShowMessage(std::u16string text, bool is_error) {
  state_.message = std::move(text);
  state_.message_is_error = is_error;
  Apply();
}

void StatusHost::ClearMessage() {
  if (state_.message.empty()) {
    return;
  }
  state_.message.clear();
  Apply();
}

void StatusHost::SetSuppressed(bool suppressed) {
  if (suppressed_ == suppressed) {
    return;
  }
  suppressed_ = suppressed;
  Apply();
}

void StatusHost::SetCardMode(bool on) {
  card_mode_ = on;
  if (MultiContentsView* mcv = host_.browser_view()->multi_contents_view()) {
    if (on && !contents_observation_.IsObserving()) {
      contents_observation_.Observe(mcv);
    } else if (!on) {
      contents_observation_.Reset();
    }
  }
  Relayout();
}

void StatusHost::SetContext(std::u16string workspace,
                            std::u16string title,
                            std::u16string url) {
  if (state_.workspace == workspace && state_.title == title &&
      state_.url == url) {
    return;
  }
  state_.workspace = std::move(workspace);
  state_.title = std::move(title);
  state_.url = std::move(url);
  Apply();
}

void StatusHost::SetDownloads(std::u16string text) {
  if (state_.downloads == text) {
    return;
  }
  state_.downloads = std::move(text);
  Apply();
}

void StatusHost::Relayout() {
  UpdateCard();
  Apply();
}

bool StatusHost::BarActive() {
  BrowserView* browser_view = host_.browser_view();
  // IsFullscreen() needs the widget, which BrowserView gets after the
  // controller is built.
  return card_mode_ && browser_view->multi_contents_view() &&
         !(browser_view->GetWidget() && browser_view->IsFullscreen());
}

void StatusHost::UpdateCard() {
  MultiContentsView* mcv = host_.browser_view()->multi_contents_view();
  if (!mcv) {
    return;
  }
  const bool card = BarActive();
  mcv->SetCardInsets(card ? gfx::Insets::TLBR(kCardTop, kCardSide, kCardBottom,
                                              kCardSide)
                          : gfx::Insets(),
                     kCardRadius);
  state_.bar = card;
}

void StatusHost::Apply() {
  if (!view_) {
    // Create the widget on first content only.
    if (!StatusView::HasContent(state_)) {
      return;
    }
    view_ = static_cast<StatusView*>(host_.EnsureWidget(base::BindOnce(
        []() -> std::unique_ptr<views::View> {
          return std::make_unique<StatusView>();
        })));
    if (!view_) {
      return;  // Too early; the next update tries again.
    }
  }
  view_->SetState(state_);
  Layout();
}

void StatusHost::Layout() {
  if (!view_) {
    return;
  }
  if (!view_->HasContent()) {
    host_.Hide();
    return;
  }
  if (state_.bar) {
    // The bar stays while the palette is open: the palette floats over the
    // page, the bar is part of the window.
    MultiContentsView* mcv = host_.browser_view()->multi_contents_view();
    if (!mcv->GetVisible() || mcv->bounds().IsEmpty()) {
      host_.Hide();
      return;
    }
    const gfx::Rect area = mcv->ConvertRectToWidget(mcv->GetLocalBounds());
    const int height =
        std::min(view_->GetPreferredSize().height(), area.height());
    host_.ShowAt(gfx::Rect(area.x(), area.bottom() - height, area.width(),
                           height));
    return;
  }
  if (suppressed_) {
    host_.Hide();
    return;
  }
  const gfx::Rect area = host_.ContentsArea();
  const gfx::Size size = view_->GetPreferredSize();
  const int width = std::min(size.width(), area.width());
  gfx::Rect bounds(area.x() + style::kEdgeMargin - style::kShadowMargin,
                   area.bottom() - style::kEdgeMargin + style::kShadowMargin -
                       size.height(),
                   width, size.height());
  host_.ShowAt(bounds);
}

void StatusHost::OnViewBoundsChanged(views::View* observed_view) {
  // The tab strip moved between top and side, the window resized, or it
  // entered or left fullscreen.
  Relayout();
}

void StatusHost::OnViewIsDeleting(views::View* observed_view) {
  contents_observation_.Reset();
}

}  // namespace modal_browser
