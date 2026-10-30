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

// The page card: the same margin on three sides (sizes in modal_style.h);
// its top meets the toolbar, which carries the card's top corners.
constexpr int kCardSide = style::kCardSide;
constexpr float kCardRadius = style::kCardRadius;

const gfx::FontList& ModeFont() {
  return style::UiFont(-2, gfx::Font::Weight::SEMIBOLD);
}
const gfx::FontList& PendingFont() {
  return style::MonoFont(-1, gfx::Font::Weight::SEMIBOLD);
}
const gfx::FontList& MessageFont() {
  return style::UiFont(-1);
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
  return state.mode != ffi::Mode::Normal || !state.pending.empty() ||
         !state.message.empty() || !state.downloads.empty();
}

bool StatusView::ShowsMode() const {
  // Normal mode is the quiet default: its name shows only in front of keys
  // being typed, not in front of a message or downloads.
  return !state_.indicator.empty() &&
         (state_.mode != ffi::Mode::Normal || !state_.pending.empty());
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

int StatusView::MessageWidth() const {
  return std::min(kMaxMessageWidth,
                  gfx::Canvas::GetStringWidth(FirstLine(state_.message),
                                              MessageFont()));
}

gfx::Size StatusView::PillSize() const {
  int width = kPillPaddingX;
  bool first = true;
  if (ShowsMode()) {
    width += kDot + kGap +
             gfx::Canvas::GetStringWidth(state_.indicator, ModeFont());
    first = false;
  }
  if (!state_.pending.empty()) {
    width += (first ? 0 : kGap) +
             gfx::Canvas::GetStringWidth(state_.pending, PendingFont());
    first = false;
  }
  if (!state_.message.empty()) {
    width += (first ? 0 : kGap * 2 + 1) + MessageWidth();
    first = false;
  }
  if (!state_.downloads.empty()) {
    width += (first ? 0 : kGap * 2 + 1) +
             gfx::Canvas::GetStringWidth(state_.downloads, PendingFont());
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

  // The pill: the mode and its dot, the keys typed so far, the latest
  // message, running downloads; each only when there is one.
  gfx::Rect pill(left, pill_top, pill_size.width(), pill_size.height());
  paint::DrawCard(canvas, pill, style::kPillRadius, colors, colors.surface);
  int x = pill.x() + kPillPaddingX;
  bool first = true;
  auto rule = [&] {
    x += kGap;
    cc::PaintFlags flags;
    flags.setColor(colors.border);
    canvas->DrawRect(gfx::Rect(x, pill.y() + 7, 1, pill.height() - 14), flags);
    x += 1 + kGap;
  };
  if (ShowsMode()) {
    const SkColor mode_color = style::ModeColor(state_.mode, dark);
    cc::PaintFlags dot;
    dot.setAntiAlias(true);
    dot.setColor(mode_color);
    canvas->DrawCircle(gfx::PointF(x + kDot / 2.f, pill.CenterPoint().y()),
                       kDot / 2.f, dot);
    x += kDot + kGap;
    const int mode_width =
        gfx::Canvas::GetStringWidth(state_.indicator, ModeFont());
    canvas->DrawStringRect(
        state_.indicator, ModeFont(),
        state_.mode == ffi::Mode::Normal ? colors.text_secondary : mode_color,
        gfx::Rect(x, pill.y(), mode_width + 1, pill.height()));
    x += mode_width;
    first = false;
  }
  if (!state_.pending.empty()) {
    x += first ? 0 : kGap;
    const int w = gfx::Canvas::GetStringWidth(state_.pending, PendingFont());
    canvas->DrawStringRect(state_.pending, PendingFont(), colors.text,
                           gfx::Rect(x, pill.y(), w + 1, pill.height()));
    x += w;
    first = false;
  }
  if (!state_.message.empty()) {
    if (!first) {
      rule();
    }
    const int w = MessageWidth();
    canvas->DrawStringRect(
        FirstLine(state_.message), MessageFont(),
        state_.message_is_error ? colors.error : colors.text,
        gfx::Rect(x, pill.y(), w + 1, pill.height()));
    x += w;
    first = false;
  }
  if (!state_.downloads.empty()) {
    if (!first) {
      rule();
    }
    const int w = gfx::Canvas::GetStringWidth(state_.downloads, PendingFont());
    canvas->DrawStringRect(state_.downloads, PendingFont(),
                           colors.text_secondary,
                           gfx::Rect(x, pill.y(), w + 1, pill.height()));
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

bool StatusHost::CardActive() {
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
  const bool card = CardActive();
  mcv->SetCardInsets(
      card ? gfx::Insets::TLBR(0, kCardSide, kCardSide, kCardSide)
           : gfx::Insets(),
      gfx::RoundedCornersF(0, 0, kCardRadius, kCardRadius));
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
