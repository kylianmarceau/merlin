// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_ctrl_tab.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "build/build_config.h"
#include "cc/paint/paint_flags.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/modal_browser/merlin_urls.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/browser/ui/modal_browser/paint_util.h"
#include "chrome/browser/ui/tabs/tab_change_type.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/tabs/tab_strip_user_gesture_details.h"
#include "chrome/browser/ui/thumbnails/thumbnail_image.h"
#include "chrome/browser/ui/thumbnails/thumbnail_tab_helper.h"
#include "chrome/common/pref_names.h"
#include "components/favicon/content/content_favicon_driver.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/web_contents.h"
#include "third_party/skia/include/core/SkRRect.h"
#include "ui/accessibility/ax_enums.mojom.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/events/event_constants.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/skia_conversions.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/controls/button/button.h"
#include "ui/views/view.h"

namespace modal_browser {

namespace {

// A card: the page's thumbnail (16:10) above its icon, title and address.
constexpr int kCardWidth = 200;
constexpr int kThumbInset = 6;
constexpr int kThumbHeight = 118;
constexpr int kTextHeight = 42;
constexpr int kCardHeight = kThumbInset + kThumbHeight + kTextHeight;
constexpr int kCardRadius = 12;
constexpr int kThumbRadius = 8;
constexpr int kIconSize = 16;
// The panel around the cards.
constexpr int kGap = 10;
constexpr int kPadding = 14;
constexpr int kHeaderHeight = 28;
constexpr int kMaxColumns = 6;
constexpr int kMaxRows = 3;

std::optional<bool>& ControlDownOverride() {
  static std::optional<bool> down;
  return down;
}

void DrawLetter(gfx::Canvas* canvas,
                const gfx::Rect& rect,
                const std::u16string& title,
                const style::Colors& colors,
                const gfx::FontList& font) {
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setColor(colors.accent_soft);
  canvas->DrawRoundRect(gfx::RectF(rect), rect.width() / 4.0f, flags);
  const std::u16string letter =
      title.empty() ? u"?" : base::ToUpperASCII(title.substr(0, 1));
  canvas->DrawStringRectWithFlags(letter, font, colors.text, rect,
                                  gfx::Canvas::TEXT_ALIGN_CENTER);
}

}  // namespace

// -- CtrlTabCard --------------------------------------------------------------

class CtrlTabCard : public views::Button {
  METADATA_HEADER(CtrlTabCard, views::Button)

 public:
  explicit CtrlTabCard(base::RepeatingCallback<void(int)> on_pressed)
      : views::Button(base::BindRepeating(&CtrlTabCard::OnPressed,
                                          base::Unretained(this))),
        on_pressed_(std::move(on_pressed)) {
    // The page keeps keyboard focus; cards are for the mouse and for screen
    // readers. Ctrl is held while the cards are up, and Ctrl-click is a
    // right click on macOS, so both buttons switch.
    SetFocusBehavior(FocusBehavior::NEVER);
    SetTriggerableEventFlags(ui::EF_LEFT_MOUSE_BUTTON |
                             ui::EF_RIGHT_MOUSE_BUTTON);
    GetViewAccessibility().SetRole(ax::mojom::Role::kListBoxOption);
  }

  void SetTab(tabs::TabInterface* tab, int index, bool selected) {
    index_ = index;
    selected_ = selected;
    current_ = tab->IsActivated();
    content::WebContents* contents = tab->GetContents();
    host_ = base::UTF8ToUTF16(MerlinDisplayUrl(contents->GetVisibleURL()));
    title_ = contents->GetTitle();
    if (title_.empty()) {
      title_ = host_;
    }
    favicon_ = gfx::ImageSkia();
    if (auto* driver =
            favicon::ContentFaviconDriver::FromWebContents(contents);
        driver && driver->FaviconIsValid()) {
      favicon_ = driver->GetFavicon().AsImageSkia();
    }
    if (tab->GetHandle() != handle_) {
      handle_ = tab->GetHandle();
      Subscribe(tab);
    }
    std::u16string name = title_;
    if (current_) {
      name += u", current tab";
    }
    GetViewAccessibility().SetName(name);
    GetViewAccessibility().SetIsSelected(selected);
    SchedulePaint();
  }

  // Drops the thumbnail subscription, which also lets Chromium stop any
  // capture it started for this card.
  void Clear() {
    handle_ = tabs::TabHandle();
    subscription_.reset();
    thumbnail_ = gfx::ImageSkia();
  }

  bool has_thumbnail() const { return !thumbnail_.isNull(); }

  // views::Button:
  void PaintButtonContents(gfx::Canvas* canvas) override {
    const style::Colors& colors = style::ColorsFor(this);
    const gfx::Rect bounds = GetLocalBounds();
    cc::PaintFlags fill;
    fill.setAntiAlias(true);
    if (selected_ || GetState() == STATE_HOVERED) {
      fill.setColor(selected_ ? colors.accent_soft : colors.surface_raised);
      canvas->DrawRoundRect(gfx::RectF(bounds), kCardRadius, fill);
    }

    // The thumbnail, cropped to fill its frame from the top of the page.
    const gfx::Rect thumb(kThumbInset, kThumbInset,
                          bounds.width() - 2 * kThumbInset, kThumbHeight);
    canvas->Save();
    canvas->sk_canvas()->clipRRect(
        SkRRect::MakeRectXY(gfx::RectToSkRect(thumb), kThumbRadius,
                            kThumbRadius),
        /*do_anti_alias=*/true);
    fill.setColor(colors.surface_raised);
    canvas->DrawRect(thumb, fill);
    if (!thumbnail_.isNull()) {
      const float scale =
          std::max(static_cast<float>(thumb.width()) / thumbnail_.width(),
                   static_cast<float>(thumb.height()) / thumbnail_.height());
      const int src_w = std::min(
          thumbnail_.width(),
          static_cast<int>(std::round(thumb.width() / scale)));
      const int src_h = std::min(
          thumbnail_.height(),
          static_cast<int>(std::round(thumb.height() / scale)));
      canvas->DrawImageInt(thumbnail_, (thumbnail_.width() - src_w) / 2, 0,
                           src_w, src_h, thumb.x(), thumb.y(), thumb.width(),
                           thumb.height(), /*filter=*/true);
    } else {
      // No capture yet (a tab not shown since it opened): its icon.
      const int size = 2 * kIconSize;
      const gfx::Rect icon(thumb.CenterPoint().x() - size / 2,
                           thumb.CenterPoint().y() - size / 2, size, size);
      if (!favicon_.isNull()) {
        canvas->DrawImageInt(favicon_, 0, 0, favicon_.width(),
                             favicon_.height(), icon.x(), icon.y(), size, size,
                             /*filter=*/true);
      } else {
        DrawLetter(canvas, icon, title_, colors,
                   style::UiFont(4, gfx::Font::Weight::SEMIBOLD));
      }
    }
    canvas->Restore();
    cc::PaintFlags line;
    line.setAntiAlias(true);
    line.setStyle(cc::PaintFlags::kStroke_Style);
    line.setStrokeWidth(1);
    line.setColor(colors.border);
    gfx::RectF hairline(thumb);
    hairline.Inset(0.5f);
    canvas->DrawRoundRect(hairline, kThumbRadius, line);

    if (selected_) {
      line.setStrokeWidth(2);
      line.setColor(colors.accent);
      gfx::RectF ring(bounds);
      ring.Inset(1);
      canvas->DrawRoundRect(ring, kCardRadius - 1, line);
    }

    // Icon and title, then the address (or "Current tab").
    const int text_x = kThumbInset + 2;
    const int top = thumb.bottom() + 6;
    const gfx::Rect icon(text_x, top + 2, kIconSize, kIconSize);
    if (!favicon_.isNull()) {
      canvas->DrawImageInt(favicon_, 0, 0, favicon_.width(), favicon_.height(),
                           icon.x(), icon.y(), kIconSize, kIconSize,
                           /*filter=*/true);
    } else {
      DrawLetter(canvas, icon, title_, colors,
                 style::UiFont(-3, gfx::Font::Weight::SEMIBOLD));
    }
    const int title_x = icon.right() + 7;
    const int right = bounds.width() - kThumbInset - 2;
    const gfx::FontList& title_font =
        style::UiFont(0, gfx::Font::Weight::MEDIUM);
    paint::DrawMarkedText(canvas, title_, {},
                          gfx::Rect(title_x, top, right - title_x, 20),
                          title_font, title_font, colors.text, colors.text);
    const gfx::FontList& small = style::UiFont(-2);
    paint::DrawMarkedText(canvas, current_ ? u"Current tab" : host_, {},
                          gfx::Rect(text_x, top + 20, right - text_x, 16),
                          small, small, colors.text_secondary,
                          colors.text_secondary);
  }

 private:
  void OnPressed() { on_pressed_.Run(index_); }

  void Subscribe(tabs::TabInterface* tab) {
    subscription_.reset();
    thumbnail_ = gfx::ImageSkia();
    ThumbnailTabHelper* helper = ThumbnailTabHelper::From(tab);
    scoped_refptr<ThumbnailImage> image =
        helper ? helper->thumbnail() : nullptr;
    if (!image) {
      return;
    }
    subscription_ = image->Subscribe();
    subscription_->SetSizeHint(gfx::Size(kCardWidth - 2 * kThumbInset,
                                         kThumbHeight));
    // The subscription is ours, so it never outlives this card.
    subscription_->SetUncompressedImageCallback(base::BindRepeating(
        &CtrlTabCard::OnThumbnail, base::Unretained(this)));
    image->RequestThumbnailImage();
  }

  void OnThumbnail(gfx::ImageSkia image) {
    thumbnail_ = std::move(image);
    SchedulePaint();
  }

  base::RepeatingCallback<void(int)> on_pressed_;
  int index_ = 0;
  bool selected_ = false;
  bool current_ = false;
  tabs::TabHandle handle_;
  std::u16string title_;
  std::u16string host_;
  gfx::ImageSkia favicon_;
  gfx::ImageSkia thumbnail_;
  std::unique_ptr<ThumbnailImage::Subscription> subscription_;
};

BEGIN_METADATA(CtrlTabCard)
END_METADATA

// -- CtrlTabView --------------------------------------------------------------

// The floating panel: a header line and a grid of cards that scrolls by rows
// to keep the selected card on screen.
class CtrlTabView : public views::View {
  METADATA_HEADER(CtrlTabView, views::View)

 public:
  explicit CtrlTabView(base::RepeatingCallback<void(int)> on_pressed)
      : on_pressed_(std::move(on_pressed)) {
    GetViewAccessibility().SetRole(ax::mojom::Role::kListBox);
    GetViewAccessibility().SetName(u"Open tabs");
  }

  // How many columns fit in `width` (the web contents' width) for `count`
  // tabs, and how many rows in `height`.
  static int ColumnsFor(int width, int count) {
    const int usable = width - 2 * (style::kShadowMargin + kPadding);
    const int fit = (usable + kGap) / (kCardWidth + kGap);
    return std::clamp(std::min(fit, count), 1, kMaxColumns);
  }
  static int RowsFor(int height, int count, int columns) {
    const int usable =
        height - 2 * (style::kShadowMargin + kPadding) - kHeaderHeight;
    const int fit = (usable + kGap) / (kCardHeight + kGap);
    const int needed = (count + columns - 1) / columns;
    return std::clamp(std::min(fit, needed), 1, kMaxRows);
  }

  void SetTabs(const std::vector<tabs::TabInterface*>& tabs,
               int selected,
               bool recent,
               int columns,
               int rows) {
    const int count = static_cast<int>(tabs.size());
    columns_ = columns;
    rows_ = rows;
    header_ = recent ? u"Recent tabs" : u"Tabs";
    // Scroll by whole rows, only as far as the selection needs.
    const int selected_row = selected / columns_;
    if (selected_row < first_row_) {
      first_row_ = selected_row;
    } else if (selected_row >= first_row_ + rows_) {
      first_row_ = selected_row - rows_ + 1;
    }
    const int total_rows = (count + columns_ - 1) / columns_;
    first_row_ = std::clamp(first_row_, 0, std::max(0, total_rows - rows_));

    const int first = first_row_ * columns_;
    const int shown = std::min(count - first, columns_ * rows_);
    while (static_cast<int>(cards_.size()) < shown) {
      cards_.push_back(AddChildView(std::make_unique<CtrlTabCard>(on_pressed_)));
    }
    for (int i = 0; i < static_cast<int>(cards_.size()); ++i) {
      CtrlTabCard* card = cards_[i];
      if (i < shown) {
        card->SetTab(tabs[first + i], first + i, first + i == selected);
        card->SetVisible(true);
      } else {
        card->Clear();
        card->SetVisible(false);
      }
    }
    more_above_ = first > 0;
    more_below_ = first + shown < count;
    InvalidateLayout();
    SchedulePaint();
  }

  void Clear() {
    for (CtrlTabCard* card : cards_) {
      card->Clear();
    }
    first_row_ = 0;
  }

  // The widget's size: the panel plus room for its shadow.
  gfx::Size WidgetSize() const {
    const int width = 2 * kPadding + columns_ * kCardWidth +
                      (columns_ - 1) * kGap + 2 * style::kShadowMargin;
    const int height = 2 * kPadding + kHeaderHeight + rows_ * kCardHeight +
                       (rows_ - 1) * kGap + 2 * style::kShadowMargin;
    return gfx::Size(width, height);
  }

  int columns() const { return columns_; }
  std::vector<CtrlTabCard*> visible_cards() const {
    std::vector<CtrlTabCard*> out;
    for (CtrlTabCard* card : cards_) {
      if (card->GetVisible()) {
        out.push_back(card);
      }
    }
    return out;
  }

  // views::View:
  void Layout(PassKey) override {
    const gfx::Rect panel = Panel();
    int i = 0;
    for (CtrlTabCard* card : cards_) {
      if (!card->GetVisible()) {
        continue;
      }
      const int col = i % columns_;
      const int row = i / columns_;
      card->SetBounds(panel.x() + kPadding + col * (kCardWidth + kGap),
                      panel.y() + kPadding + kHeaderHeight +
                          row * (kCardHeight + kGap),
                      kCardWidth, kCardHeight);
      ++i;
    }
  }

  void OnPaint(gfx::Canvas* canvas) override {
    const style::Colors& colors = style::ColorsFor(this);
    const gfx::Rect panel = Panel();
    paint::DrawCard(canvas, panel, style::kPaletteRadius, colors,
                    colors.surface);
    const gfx::FontList& label = style::UiFont(-1, gfx::Font::Weight::SEMIBOLD);
    const gfx::FontList& hint = style::UiFont(-2);
    const gfx::Rect header(panel.x() + kPadding + 4, panel.y() + kPadding - 4,
                           panel.width() - 2 * kPadding - 8, kHeaderHeight);
    std::u16string title = header_;
    if (more_above_ || more_below_) {
      title += more_above_ && more_below_ ? u"  ↑↓"
               : more_above_              ? u"  ↑"
                                          : u"  ↓";
    }
    const int title_width = paint::DrawMarkedText(
        canvas, title, {}, header, label, label, colors.text_secondary,
        colors.text_secondary);
    const std::u16string keys = u"Release Ctrl to switch · Esc to cancel";
    const int keys_width = gfx::Canvas::GetStringWidth(keys, hint);
    if (title_width + 24 + keys_width <= header.width()) {
      canvas->DrawStringRectWithFlags(keys, hint, colors.text_tertiary, header,
                                      gfx::Canvas::TEXT_ALIGN_RIGHT);
    }
  }

  void OnThemeChanged() override {
    views::View::OnThemeChanged();
    SchedulePaint();
  }

 private:
  gfx::Rect Panel() const {
    gfx::Rect panel = GetLocalBounds();
    panel.Inset(style::kShadowMargin);
    return panel;
  }

  base::RepeatingCallback<void(int)> on_pressed_;
  std::vector<raw_ptr<CtrlTabCard>> cards_;
  int columns_ = 1;
  int rows_ = 1;
  int first_row_ = 0;
  bool more_above_ = false;
  bool more_below_ = false;
  std::u16string header_;
};

BEGIN_METADATA(CtrlTabView)
END_METADATA

// -- CtrlTabSwitcher ----------------------------------------------------------

CtrlTabSwitcher::CtrlTabSwitcher(BrowserWindowInterface* browser,
                                 BrowserView* browser_view)
    : browser_(browser),
      host_(browser_view, {.name = "MerlinCtrlTab", .accept_events = true}) {
  browser_->GetTabStripModel()->AddObserver(this);
  if (tabs::TabInterface* tab = browser_->GetActiveTabInterface()) {
    TouchRecent(tab);
  }
  host_.set_on_parent_bounds_changed(base::BindRepeating(
      [](CtrlTabSwitcher* self) {
        if (self->host_.IsVisible()) {
          self->Layout();
        }
      },
      base::Unretained(this)));
}

CtrlTabSwitcher::~CtrlTabSwitcher() {
  browser_->GetTabStripModel()->RemoveObserver(this);
}

// static
void CtrlTabSwitcher::SetDefaultOrder(PrefService* prefs) {
  prefs->SetDefaultPrefValue(prefs::kCtrlTabMru, base::Value(true));
}

// static
bool CtrlTabSwitcher::RecentOrder(const PrefService* prefs) {
  return prefs->GetBoolean(prefs::kCtrlTabMru);
}

// static
void CtrlTabSwitcher::SetControlDownForTesting(std::optional<bool> down) {
  ControlDownOverride() = down;
}

// static
bool CtrlTabSwitcher::ControlDown() {
  if (ControlDownOverride().has_value()) {
    return *ControlDownOverride();
  }
  return CtrlTabKeyWatch::IsControlDown();
}

void CtrlTabSwitcher::Cycle(bool forward) {
  if (open_) {
    Move(forward ? 1 : -1);
  } else {
    Open(forward);
  }
}

void CtrlTabSwitcher::Open(bool forward) {
  std::vector<tabs::TabHandle> order = OrderedTabs();
  if (order.size() < 2) {
    return;
  }
  const int target = forward ? 1 : static_cast<int>(order.size()) - 1;
  // A tap (or the menu, or a remapped key): switch at once, nothing shown.
  if (!ControlDown()) {
    Activate(order[target]);
    return;
  }
  order_ = std::move(order);
  selected_ = target;
  open_ = true;
  key_watch_ = CtrlTabKeyWatch::Start(
      {.control_released = base::BindRepeating(&CtrlTabSwitcher::CheckControl,
                                               weak_factory_.GetWeakPtr()),
       .key = base::BindRepeating(&CtrlTabSwitcher::OnKey,
                                  weak_factory_.GetWeakPtr())});
  control_poll_.Start(FROM_HERE, base::Milliseconds(100), this,
                      &CtrlTabSwitcher::CheckControl);
  show_timer_.Start(FROM_HERE, kShowDelay, this, &CtrlTabSwitcher::ShowCards);
}

void CtrlTabSwitcher::Move(int delta) {
  const int n = static_cast<int>(order_.size());
  if (n == 0) {
    return;
  }
  selected_ = ((selected_ + delta) % n + n) % n;
  if (host_.IsVisible()) {
    Layout();
  }
}

void CtrlTabSwitcher::OnKey(CtrlTabKeyWatch::Key key) {
  if (!open_) {
    return;
  }
  const int columns = view_ && host_.IsVisible() ? view_->columns() : 1;
  const int last = static_cast<int>(order_.size()) - 1;
  switch (key) {
    case CtrlTabKeyWatch::Key::kEscape:
      Cancel();
      return;
    case CtrlTabKeyWatch::Key::kReturn:
      Commit();
      return;
    case CtrlTabKeyWatch::Key::kLeft:
      Move(-1);
      return;
    case CtrlTabKeyWatch::Key::kRight:
      Move(1);
      return;
    case CtrlTabKeyWatch::Key::kUp:
      Move(std::max(0, selected_ - columns) - selected_);
      return;
    case CtrlTabKeyWatch::Key::kDown:
      Move(std::min(last, selected_ + columns) - selected_);
      return;
  }
}

void CtrlTabSwitcher::CheckControl() {
  if (open_ && !ControlDown()) {
    Commit();
  }
}

void CtrlTabSwitcher::Commit() {
  if (!open_) {
    return;
  }
  const tabs::TabHandle target = order_[selected_];
  // Close first: the switch notifies observers, this one included.
  Close();
  Activate(target);
}

void CtrlTabSwitcher::CommitIndex(int index) {
  if (open_ && index >= 0 && index < static_cast<int>(order_.size())) {
    selected_ = index;
    Commit();
  }
}

void CtrlTabSwitcher::Cancel() {
  Close();
}

void CtrlTabSwitcher::Close() {
  open_ = false;
  show_timer_.Stop();
  control_poll_.Stop();
  key_watch_.reset();
  order_.clear();
  selected_ = 0;
  host_.Hide();
  if (view_) {
    view_->Clear();
  }
}

void CtrlTabSwitcher::ShowCards() {
  if (!open_) {
    return;
  }
  if (!view_) {
    view_ = static_cast<CtrlTabView*>(host_.EnsureWidget(base::BindOnce(
        [](base::WeakPtr<CtrlTabSwitcher> self) -> std::unique_ptr<views::View> {
          return std::make_unique<CtrlTabView>(base::BindRepeating(
              &CtrlTabSwitcher::CommitIndex, self));
        },
        weak_factory_.GetWeakPtr())));
    if (!view_) {
      return;
    }
  }
  Layout();
}

void CtrlTabSwitcher::Layout() {
  if (!open_ || !view_) {
    return;
  }
  std::vector<tabs::TabInterface*> tabs = LiveTabs();
  if (tabs.size() != order_.size()) {
    // A tab went away without a strip notification reaching us yet.
    Cancel();
    return;
  }
  const gfx::Rect area = host_.ContentsArea();
  const int count = static_cast<int>(tabs.size());
  const int columns = CtrlTabView::ColumnsFor(area.width(), count);
  const int rows = CtrlTabView::RowsFor(area.height(), count, columns);
  view_->SetTabs(tabs, selected_,
                 RecentOrder(browser_->GetProfile()->GetPrefs()), columns,
                 rows);
  const gfx::Size size = view_->WidgetSize();
  // Centered, a little above the middle, like a system switcher.
  const int x = area.x() + (area.width() - size.width()) / 2;
  const int y = area.y() + std::max(0, (area.height() - size.height()) * 2 / 5);
  host_.ShowAt(gfx::Rect(x, y, size.width(), size.height()));
}

std::vector<tabs::TabHandle> CtrlTabSwitcher::OrderedTabs() const {
  TabStripModel* strip = browser_->GetTabStripModel();
  std::vector<tabs::TabHandle> out;
  const int count = strip->count();
  if (count == 0) {
    return out;
  }
  if (!RecentOrder(browser_->GetProfile()->GetPrefs())) {
    const int start = std::max(0, strip->active_index());
    for (int k = 0; k < count; ++k) {
      out.push_back(strip->GetTabAtIndex((start + k) % count)->GetHandle());
    }
    return out;
  }
  auto listed = [&out](tabs::TabHandle handle) {
    return std::find(out.begin(), out.end(), handle) != out.end();
  };
  if (tabs::TabInterface* active = browser_->GetActiveTabInterface()) {
    out.push_back(active->GetHandle());
  }
  for (tabs::TabHandle handle : recent_) {
    tabs::TabInterface* tab = handle.Get();
    if (tab && strip->GetIndexOfTab(tab) != TabStripModel::kNoTab &&
        !listed(handle)) {
      out.push_back(handle);
    }
  }
  for (int i = 0; i < count; ++i) {
    const tabs::TabHandle handle = strip->GetTabAtIndex(i)->GetHandle();
    if (!listed(handle)) {
      out.push_back(handle);
    }
  }
  return out;
}

void CtrlTabSwitcher::Activate(tabs::TabHandle handle) {
  tabs::TabInterface* tab = handle.Get();
  TabStripModel* strip = browser_->GetTabStripModel();
  if (!tab || strip->GetIndexOfTab(tab) == TabStripModel::kNoTab) {
    return;
  }
  strip->ActivateTab(tab, TabStripUserGestureDetails(
                              TabStripUserGestureDetails::GestureType::kKeyboard));
}

void CtrlTabSwitcher::TouchRecent(tabs::TabInterface* tab) {
  const tabs::TabHandle handle = tab->GetHandle();
  std::erase_if(recent_, [handle](tabs::TabHandle h) {
    return h == handle || !h.Get();
  });
  recent_.insert(recent_.begin(), handle);
  constexpr size_t kMaxRecent = 200;
  if (recent_.size() > kMaxRecent) {
    recent_.resize(kMaxRecent);
  }
}

std::vector<tabs::TabInterface*> CtrlTabSwitcher::tabs_for_testing() const {
  return LiveTabs();
}

std::vector<tabs::TabInterface*> CtrlTabSwitcher::LiveTabs() const {
  std::vector<tabs::TabInterface*> out;
  TabStripModel* strip = browser_->GetTabStripModel();
  for (tabs::TabHandle handle : order_) {
    tabs::TabInterface* tab = handle.Get();
    if (tab && strip->GetIndexOfTab(tab) != TabStripModel::kNoTab) {
      out.push_back(tab);
    }
  }
  return out;
}

bool CtrlTabSwitcher::cards_visible_for_testing() const {
  return host_.IsVisible();
}

void CtrlTabSwitcher::ShowCardsNowForTesting() {
  show_timer_.Stop();
  ShowCards();
}

void CtrlTabSwitcher::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  if (selection.active_tab_changed() && selection.new_tab) {
    TouchRecent(selection.new_tab);
  }
  // Something else changed the tabs while the switcher was up (a page closed
  // itself, a link opened a tab): start over rather than switch to a stale
  // choice.
  if (open_ && (change.type() != TabStripModelChange::kSelectionOnly ||
                selection.active_tab_changed())) {
    Cancel();
  }
}

void CtrlTabSwitcher::OnTabChangedAt(tabs::TabInterface* tab,
                                     TabChangeType change_type) {
  if (change_type != TabChangeType::kLoadingOnly && host_.IsVisible()) {
    Layout();  // a title or icon changed
  }
}

#if !BUILDFLAG(IS_MAC)
// static
std::unique_ptr<CtrlTabKeyWatch> CtrlTabKeyWatch::Start(Callbacks callbacks) {
  return nullptr;
}

// static
bool CtrlTabKeyWatch::IsControlDown() {
  return false;
}
#endif

}  // namespace modal_browser
