// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_tab_bar.h"

#include <algorithm>
#include <cstdlib>
#include <utility>

#include "base/auto_reset.h"
#include "base/functional/bind.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "cc/paint/paint_flags.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/color/chrome_color_id.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/browser/ui/tab_ui_helper.h"
#include "chrome/browser/ui/tabs/alert/tab_alert_controller.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_menu_model.h"
#include "chrome/browser/ui/tabs/tab_menu_model_delegate.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/tabs/tab_strip_user_gesture_details.h"
#include "chrome/browser/ui/tabs/vertical_tab_strip_state_controller.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
// Part of //chrome/browser/ui/views/frame:frame, which depends on this target.
#include "chrome/browser/ui/views/frame/tab_strip_region_view.h"  // nogncheck
#include "chrome/browser/ui/views/toolbar/toolbar_view.h"  // nogncheck
#include "components/tabs/public/tab_context_menu_command.h"
#include "components/vector_icons/vector_icons.h"
#include "content/public/browser/web_contents.h"
#include "third_party/skia/include/core/SkPath.h"
#include "third_party/skia/include/core/SkPathBuilder.h"
#include "third_party/skia/include/core/SkRRect.h"
#include "ui/accessibility/ax_enums.mojom.h"
#include "ui/compositor/layer.h"
#include "ui/base/hit_test.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/color/color_provider.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/skia_conversions.h"
#include "ui/gfx/image/image_skia_operations.h"
#include "ui/gfx/paint_throbber.h"
#include "ui/gfx/paint_vector_icon.h"
#include "ui/gfx/render_text.h"
#include "ui/gfx/shadow_value.h"
#include "ui/gfx/skia_paint_util.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/controls/menu/menu_runner.h"
#include "ui/views/view_class_properties.h"
#include "ui/views/view_targeter.h"
#include "ui/views/view_utils.h"
#include "ui/views/widget/widget.h"

namespace modal_browser {

namespace {

// Geometry, in DIPs, after Dia's tab bar. The active tab is cut from the
// toolbar: the same color, a rounded top, and the bottom flaring out into
// the toolbar. The others sit flat on the frame with no separators and take
// a rounded fill on hover. Pinned tabs are icons in one capsule.
constexpr int kTopInset = 5;          // frame above the tabs
constexpr int kActiveRadius = 10;     // the active tab's top corners
constexpr int kFlare = 8;             // its bottom corners, flaring out
constexpr int kHoverRadius = 8;
constexpr int kTabGap = 2;
constexpr int kSplitGap = 1;
constexpr int kTabPadding = 12;
constexpr int kIconSize = 16;
constexpr int kIconGap = 8;
constexpr int kCloseSize = 18;
constexpr int kCloseInset = 7;
constexpr int kAlertSize = 14;
constexpr int kMaxTabWidth = 160;
// Below this a tab shows only its icon.
constexpr int kCompactWidth = 72;
constexpr int kMinTabWidth = 44;
constexpr int kActiveMinWidth = 136;
constexpr int kPinnedWidth = 36;
constexpr int kCapsulePad = 3;
constexpr int kCapsuleHeight = 32;
constexpr int kCapsuleRadius = 10;
constexpr int kAfterCapsule = 12;     // room for the divider
constexpr int kLeadingPad = 6;
constexpr int kTrailingPad = 10;
constexpr int kNewTabSize = 28;
constexpr int kNewTabRadius = 8;
constexpr int kDragThreshold = 4;

// The sidebar: tabs as rows, the active one a card in the page's color.
constexpr int kSidePad = 8;
constexpr int kRowHeight = 32;
constexpr int kRowGap = 2;
constexpr int kRowRadius = 9;
constexpr int kPinnedTileHeight = 36;
constexpr int kPinnedMinTile = 44;
constexpr int kSidebarBottomPad = 8;
// One wheel step of this many pixels scrolls one row.
constexpr int kWheelPerRow = 40;

constexpr base::TimeDelta kLayoutDuration = base::Milliseconds(180);
constexpr base::TimeDelta kHoverDuration = base::Milliseconds(120);
constexpr base::TimeDelta kLoadingFrame = base::Milliseconds(30);

// The tab bar's colors, from Merlin's palette (merlin_theme.cc). The active
// tab takes the toolbar's own color (kColorToolbar), so it always matches
// the row below it.
struct TabColors {
  SkColor active_border;
  SkColor capsule_fill;
  SkColor capsule_border;
  SkColor hover_fill;
  SkColor pressed_fill;
  SkColor text_active;
  SkColor text;
  SkColor icon_subtle;
  SkColor close_hover;
  SkColor divider;
  SkColor recording;
};

const TabColors& ColorsFor(const views::View* view) {
  static constexpr TabColors kLight = {
      .active_border = SkColorSetARGB(0x1C, 0x28, 0x1E, 0x0A),
      .capsule_fill = SkColorSetARGB(0x0D, 0x28, 0x1E, 0x0A),
      .capsule_border = SkColorSetARGB(0x14, 0x28, 0x1E, 0x0A),
      .hover_fill = SkColorSetARGB(0x12, 0x28, 0x1E, 0x0A),
      .pressed_fill = SkColorSetARGB(0x1C, 0x28, 0x1E, 0x0A),
      .text_active = SkColorSetRGB(0x1C, 0x1B, 0x18),
      .text = SkColorSetRGB(0x47, 0x43, 0x3A),
      .icon_subtle = SkColorSetRGB(0x85, 0x7F, 0x70),
      .close_hover = SkColorSetARGB(0x17, 0x28, 0x1E, 0x0A),
      .divider = SkColorSetARGB(0x26, 0x28, 0x1E, 0x0A),
      .recording = SkColorSetRGB(0xD9, 0x3A, 0x2B),
  };
  static constexpr TabColors kDark = {
      .active_border = SkColorSetARGB(0x1A, 0xFF, 0xFF, 0xFF),
      .capsule_fill = SkColorSetARGB(0x0C, 0xFF, 0xFF, 0xFF),
      .capsule_border = SkColorSetARGB(0x14, 0xFF, 0xFF, 0xFF),
      .hover_fill = SkColorSetARGB(0x10, 0xFF, 0xFF, 0xFF),
      .pressed_fill = SkColorSetARGB(0x1A, 0xFF, 0xFF, 0xFF),
      .text_active = SkColorSetRGB(0xEC, 0xE8, 0xDD),
      .text = SkColorSetRGB(0xCB, 0xC6, 0xB9),
      .icon_subtle = SkColorSetRGB(0x8C, 0x87, 0x7A),
      .close_hover = SkColorSetARGB(0x1C, 0xFF, 0xFF, 0xFF),
      .divider = SkColorSetARGB(0x24, 0xFF, 0xFF, 0xFF),
      .recording = SkColorSetRGB(0xFF, 0x6B, 0x5C),
  };
  return style::IsDark(view) ? kDark : kLight;
}

SkColor ToolbarColor(const views::View* view) {
  const ui::ColorProvider* provider = view->GetColorProvider();
  return provider ? provider->GetColor(kColorToolbar) : SK_ColorWHITE;
}

// The active tab's fill: the page's color when known.
SkColor ActiveFillFor(const views::View* view) {
  for (const views::View* v = view; v; v = v->parent()) {
    if (const auto* bar = views::AsViewClass<MerlinTabBar>(v)) {
      return bar->ActiveFill();
    }
  }
  return ToolbarColor(view);
}

// A hairline that shows against both the frame and the active fill.
SkColor ActiveBorder(const views::View* view, SkColor fill) {
  return style::InkOn(fill).hover;
}

cc::PaintFlags Fill(SkColor color) {
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setColor(color);
  return flags;
}

cc::PaintFlags Hairline(SkColor color) {
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setStyle(cc::PaintFlags::kStroke_Style);
  flags.setStrokeWidth(1);
  flags.setColor(color);
  return flags;
}

// The active tab's outline: up the left side, across the rounded top, down
// the right side. With `flares`, both ends curve outward into the toolbar.
// `closed` closes it along the bottom, for filling.
SkPath AttachedTabPath(const gfx::RectF& r, bool flares, bool closed) {
  const float top_r = std::min<float>(kActiveRadius, r.height() / 2);
  const float f = flares ? kFlare : 0;
  SkPathBuilder b;
  if (flares) {
    b.moveTo(r.x() - f, r.bottom());
    b.arcTo(SkRect::MakeXYWH(r.x() - 2 * f, r.bottom() - 2 * f, 2 * f, 2 * f),
            90, -90, false);
  } else {
    b.moveTo(r.x(), r.bottom());
  }
  b.lineTo(r.x(), r.y() + top_r);
  b.arcTo(SkRect::MakeXYWH(r.x(), r.y(), 2 * top_r, 2 * top_r), 180, 90,
          false);
  b.lineTo(r.right() - top_r, r.y());
  b.arcTo(SkRect::MakeXYWH(r.right() - 2 * top_r, r.y(), 2 * top_r, 2 * top_r),
          270, 90, false);
  b.lineTo(r.right(), r.bottom() - f);
  if (flares) {
    b.arcTo(SkRect::MakeXYWH(r.right(), r.bottom() - 2 * f, 2 * f, 2 * f), 180,
            -90, false);
  } else {
    b.lineTo(r.right(), r.bottom());
  }
  if (closed) {
    b.close();
  }
  return b.detach();
}

void PaintAttachedTab(gfx::Canvas* canvas,
                      const gfx::Rect& rect,
                      bool flares,
                      SkColor fill,
                      SkColor border) {
  const gfx::RectF r(rect);
  canvas->DrawPath(AttachedTabPath(r, flares, /*closed=*/true), Fill(fill));
  // The outline sits half a pixel inside, so it stays crisp.
  gfx::RectF line = r;
  line.Inset(gfx::InsetsF::TLBR(0.5f, 0.5f, 0, 0.5f));
  canvas->DrawPath(AttachedTabPath(line, flares, /*closed=*/false),
                   Hairline(border));
}

void PaintRoundRect(gfx::Canvas* canvas,
                    const gfx::Rect& rect,
                    int radius,
                    SkColor fill,
                    SkColor border = SK_ColorTRANSPARENT) {
  canvas->DrawRoundRect(gfx::RectF(rect), radius, Fill(fill));
  if (SkColorGetA(border)) {
    gfx::RectF line(rect);
    line.Inset(0.5f);
    canvas->DrawRoundRect(line, radius, Hairline(border));
  }
}

// The active row in the sidebar: a card in the page's color.
void PaintActiveRow(gfx::Canvas* canvas,
                    const gfx::Rect& rect,
                    SkColor fill,
                    SkColor border) {
  // A soft shadow lifts it off the frame, as a tab does from the toolbar.
  gfx::RectF shadow(rect);
  shadow.Offset(0, 1);
  canvas->DrawRoundRect(shadow, kRowRadius,
                        Fill(SkColorSetA(SK_ColorBLACK, 0x14)));
  PaintRoundRect(canvas, rect, kRowRadius, fill, border);
}

bool SameSplit(const MerlinTab* a, const MerlinTab* b) {
  return a && b && a->data().split && a->data().split == b->data().split;
}

// Deletes a closed tab's view once it has shrunk away. Posted, so the
// animator is done with the view first.
class RemoveTabDelegate : public gfx::AnimationDelegate {
 public:
  RemoveTabDelegate(base::WeakPtr<MerlinTabBar> bar, tabs::TabHandle tab)
      : bar_(std::move(bar)), tab_(tab) {}
  void AnimationEnded(const gfx::Animation* animation) override { Remove(); }
  void AnimationCanceled(const gfx::Animation* animation) override {
    Remove();
  }

 private:
  void Remove() {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&MerlinTabBar::RemoveClosedTab, bar_, tab_));
  }
  base::WeakPtr<MerlinTabBar> bar_;
  const tabs::TabHandle tab_;
};

}  // namespace

// MerlinTab -----------------------------------------------------------------

MerlinTab::MerlinTab(MerlinTabBar* bar, tabs::TabHandle handle)
    : AnimationDelegateViews(this), bar_(bar), handle_(handle) {
  // The tab is client area; the space around its pill belongs to the bar,
  // which is window caption.
  SetProperty(views::kHitTestComponentKey, static_cast<int>(HTCLIENT));
  hover_animation_.SetSlideDuration(kHoverDuration);
  title_text_ = gfx::RenderText::CreateRenderText();
  title_text_->SetElideBehavior(gfx::FADE_TAIL);
  title_text_->SetCursorEnabled(false);
  title_text_->SetFontList(style::UiFont());
  set_context_menu_controller(bar);
  GetViewAccessibility().SetRole(ax::mojom::Role::kTab);
}

MerlinTab::~MerlinTab() = default;

void MerlinTab::SetData(MerlinTabData data) {
  const bool weight_changed = data.active != data_.active;
  data_ = std::move(data);
  if (weight_changed || title_text_->text() != data_.title) {
    title_text_->SetText(data_.title);
    title_text_->SetFontList(style::UiFont(
        0, data_.active ? gfx::Font::Weight::MEDIUM : gfx::Font::Weight::NORMAL));
  }
  UpdateAccessibleName();
  GetViewAccessibility().SetIsSelected(data_.active);
  SchedulePaint();
}

void MerlinTab::SetJoin(Join join) {
  if (join_ != join) {
    join_ = join;
    SchedulePaint();
  }
}

bool MerlinTab::loading() const {
  return data_.network_state == tabs::TabNetworkState::kLoading ||
         data_.network_state == tabs::TabNetworkState::kWaiting;
}

bool MerlinTab::AdvanceLoadingAnimation(base::TimeDelta elapsed) {
  if (!loading()) {
    return false;
  }
  loading_elapsed_ = elapsed;
  SchedulePaint();
  return true;
}

void MerlinTab::SetDragging(bool dragging) {
  dragging_ = dragging;
  if (!dragging) {
    press_point_.reset();
  }
  SchedulePaint();
}

void MerlinTab::SetClosing() {
  closing_ = true;
  SetCanProcessEventsWithinSubtree(false);
  hover_animation_.Reset();
}

bool MerlinTab::Vertical() const {
  return bar_ && bar_->vertical();
}

gfx::Rect MerlinTab::PillBounds() const {
  if (Vertical()) {
    return GetLocalBounds();
  }
  // The tab's body: from below the frame's top margin down to the toolbar.
  return gfx::Rect(0, kTopInset, width(), std::max(0, height() - kTopInset));
}

bool MerlinTab::ShowsTitle() const {
  return !data_.pinned && width() >= kCompactWidth;
}

bool MerlinTab::ShowsClose() const {
  // Like Dia: only under the mouse, so a row of tabs stays quiet.
  return ShowsTitle() && !closing_ &&
         (hover_animation_.IsShowing() || dragging_);
}

gfx::Rect MerlinTab::CloseBounds() const {
  const gfx::Rect body = PillBounds();
  return gfx::Rect(body.right() - kCloseInset - kCloseSize,
                   body.y() + (body.height() - kCloseSize) / 2, kCloseSize,
                   kCloseSize);
}

gfx::Rect MerlinTab::AlertBounds() const {
  // After the favicon, before the title, as in Dia.
  if (!data_.alert || !ShowsTitle()) {
    return gfx::Rect();
  }
  const gfx::Rect body = PillBounds();
  return gfx::Rect(body.x() + kTabPadding + kIconSize + kIconGap,
                   body.y() + (body.height() - kAlertSize) / 2, kAlertSize,
                   kAlertSize);
}

SkColor MerlinTab::TextColor() const {
  return Highlighted() ? style::InkOn(ActiveFillFor(this)).text
                       : ColorsFor(this).text;
}

bool MerlinTab::Highlighted() const {
  if (data_.active) {
    return true;
  }
  if (join_ == Join::kNone || !bar_) {
    return false;
  }
  for (MerlinTab* other : bar_->tabs_for_testing()) {
    if (other != this && SameSplit(this, other) && other->data().active) {
      return true;
    }
  }
  return false;
}

void MerlinTab::OnPaint(gfx::Canvas* canvas) {
  const gfx::Rect body = PillBounds();
  PaintBackground(canvas, body);

  gfx::Rect icon(0, body.y() + (body.height() - kIconSize) / 2, kIconSize,
                 kIconSize);
  icon.set_x(ShowsTitle() ? body.x() + kTabPadding
                          : body.x() + (body.width() - kIconSize) / 2);
  const bool has_icon = loading() || data_.show_favicon || data_.crashed;
  if (has_icon) {
    PaintIcon(canvas, icon);
  }
  if (!ShowsTitle()) {
    return;
  }

  int title_x = has_icon ? icon.right() + kIconGap : body.x() + kTabPadding;
  const gfx::Rect alert = AlertBounds();
  if (!alert.IsEmpty()) {
    PaintAlert(canvas, alert);
    title_x = alert.right() + kIconGap;
  }
  const int title_right =
      ShowsClose() ? CloseBounds().x() - 4 : body.right() - kTabPadding;
  if (title_right > title_x) {
    title_text_->SetColor(TextColor());
    title_text_->SetDisplayRect(
        gfx::Rect(title_x, body.y(), title_right - title_x, body.height()));
    title_text_->Draw(canvas);
  }
  if (ShowsClose()) {
    PaintClose(canvas, CloseBounds());
  }
}

void MerlinTab::PaintBackground(gfx::Canvas* canvas, const gfx::Rect& body) {
  const TabColors& c = ColorsFor(this);
  if (Highlighted()) {
    // The bar paints the active tab's shape under the tabs, so its flares
    // can reach past this view. A dragged one carries its own, flareless.
    if (dragging_ && !data_.pinned) {
      const SkColor fill = ActiveFillFor(this);
      if (Vertical()) {
        PaintActiveRow(canvas, body, fill, ActiveBorder(this, fill));
      } else {
        PaintAttachedTab(canvas, body, /*flares=*/false, fill,
                         ActiveBorder(this, fill));
      }
    }
    return;
  }
  const double hover = dragging_ ? 1.0 : hover_animation_.GetCurrentValue();
  if (hover <= 0) {
    return;
  }
  const SkColor base = dragging_ ? c.pressed_fill : c.hover_fill;
  const SkColor fill =
      SkColorSetA(base, static_cast<U8CPU>(SkColorGetA(base) * hover));
  gfx::Rect pill = body;
  if (Vertical()) {
    if (data_.pinned) {
      pill.Inset(3);
    }
    PaintRoundRect(canvas, pill, data_.pinned ? kHoverRadius - 1 : kRowRadius,
                   fill);
    return;
  }
  if (data_.pinned) {
    // Inside the capsule.
    pill = gfx::Rect(body.x() + 2,
                     body.y() + (body.height() - kCapsuleHeight) / 2 + 3,
                     body.width() - 4, kCapsuleHeight - 6);
    PaintRoundRect(canvas, pill, kHoverRadius - 1, fill);
    return;
  }
  pill.Inset(gfx::Insets::TLBR(1, join_ == Join::kRight ? 0 : 1, 4,
                               join_ == Join::kLeft ? 0 : 1));
  PaintRoundRect(canvas, pill, kHoverRadius, fill);
}

void MerlinTab::PaintIcon(gfx::Canvas* canvas, const gfx::Rect& icon) {
  const TabColors& c = ColorsFor(this);
  if (loading()) {
    const bool waiting = data_.network_state == tabs::TabNetworkState::kWaiting;
    gfx::Rect spinner = icon;
    spinner.Inset(1);
    gfx::PaintThrobberSpinning(canvas, spinner,
                               waiting ? c.icon_subtle : TextColor(),
                               loading_elapsed_, 1.6f);
    return;
  }
  if (data_.favicon.IsEmpty() || !GetColorProvider()) {
    return;
  }
  gfx::ImageSkia image = data_.favicon.Rasterize(GetColorProvider());
  if (image.isNull()) {
    return;
  }
  if (data_.themify_favicon) {
    image = gfx::ImageSkiaOperations::CreateColorMask(
        image, TextColor());
  }
  const bool dim = data_.discarded || data_.crashed;
  if (dim) {
    canvas->SaveLayerAlpha(0x80);
  }
  canvas->DrawImageInt(image, 0, 0, image.width(), image.height(), icon.x(),
                       icon.y(), icon.width(), icon.height(), true);
  if (dim) {
    canvas->Restore();
  }
}

void MerlinTab::PaintClose(gfx::Canvas* canvas, const gfx::Rect& close) {
  const TabColors& c = ColorsFor(this);
  const style::Ink ink = style::InkOn(
      Highlighted() ? ActiveFillFor(this) : SK_ColorTRANSPARENT);
  if (close_hovered_) {
    PaintRoundRect(canvas, close, 5,
                   Highlighted() ? (close_pressed_ ? ink.pressed : ink.hover)
                                 : (close_pressed_ ? c.pressed_fill
                                                   : c.close_hover));
  }
  cc::PaintFlags stroke = Hairline(TextColor());
  stroke.setStrokeWidth(1.4f);
  stroke.setStrokeCap(cc::PaintFlags::kRound_Cap);
  const gfx::PointF center = gfx::RectF(close).CenterPoint();
  constexpr float kArm = 3.5f;
  canvas->DrawLine(center + gfx::Vector2dF(-kArm, -kArm),
                   center + gfx::Vector2dF(kArm, kArm), stroke);
  canvas->DrawLine(center + gfx::Vector2dF(kArm, -kArm),
                   center + gfx::Vector2dF(-kArm, kArm), stroke);
}

void MerlinTab::PaintAlert(gfx::Canvas* canvas, const gfx::Rect& alert) {
  const TabColors& c = ColorsFor(this);
  switch (*data_.alert) {
    case tabs::TabAlert::kAudioPlaying:
    case tabs::TabAlert::kAudioMuting: {
      const gfx::ImageSkia icon = gfx::CreateVectorIcon(
          *data_.alert == tabs::TabAlert::kAudioPlaying
              ? vector_icons::kVolumeUpIcon
              : vector_icons::kVolumeOffIcon,
          kAlertSize, TextColor());
      canvas->DrawImageInt(icon, alert.x(), alert.y());
      return;
    }
    case tabs::TabAlert::kMediaRecording:
    case tabs::TabAlert::kAudioRecording:
    case tabs::TabAlert::kVideoRecording:
    case tabs::TabAlert::kTabCapturing:
    case tabs::TabAlert::kDesktopCapturing:
      canvas->DrawCircle(gfx::RectF(alert).CenterPoint(), 3.5f,
                         Fill(c.recording));
      return;
    default:
      return;
  }
}

bool MerlinTab::OnMousePressed(const ui::MouseEvent& event) {
  if (closing_ || !bar_) {
    return false;
  }
  if (event.IsMiddleMouseButton()) {
    return true;
  }
  if (!event.IsOnlyLeftMouseButton()) {
    return false;
  }
  if (ShowsClose() && CloseBounds().Contains(event.location())) {
    close_pressed_ = true;
    SchedulePaint();
    return true;
  }
  const gfx::Rect alert = AlertBounds();
  if (!alert.IsEmpty() && alert.Contains(event.location()) &&
      (*data_.alert == tabs::TabAlert::kAudioPlaying ||
       *data_.alert == tabs::TabAlert::kAudioMuting)) {
    bar_->ToggleMute(this);
    return true;
  }
  press_point_ = event.location();
  bar_->ActivateTab(this);
  return true;
}

bool MerlinTab::OnMouseDragged(const ui::MouseEvent& event) {
  if (!press_point_ || closing_ || data_.split) {
    return true;
  }
  // Pinned tiles in the sidebar move along their row.
  const bool vertical = Vertical() && !data_.pinned;
  const int moved = vertical ? event.location().y() - press_point_->y()
                             : event.location().x() - press_point_->x();
  if (!dragging_ && std::abs(moved) < kDragThreshold) {
    return true;
  }
  gfx::Point in_bar = event.location();
  views::View::ConvertPointToTarget(this, parent(), &in_bar);
  bar_->DragTab(this, vertical ? in_bar.y() : in_bar.x(),
                vertical ? press_point_->y() : press_point_->x());
  return true;
}

void MerlinTab::OnMouseReleased(const ui::MouseEvent& event) {
  if (dragging_) {
    bar_->EndDrag(/*cancel=*/false);
    return;
  }
  press_point_.reset();
  if (closing_) {
    return;
  }
  if (event.IsMiddleMouseButton() && HitTestPoint(event.location())) {
    bar_->CloseTab(this);
    return;
  }
  if (close_pressed_) {
    close_pressed_ = false;
    SchedulePaint();
    if (ShowsClose() && CloseBounds().Contains(event.location())) {
      bar_->CloseTab(this);
    }
  }
}

void MerlinTab::OnMouseCaptureLost() {
  close_pressed_ = false;
  if (dragging_) {
    bar_->EndDrag(/*cancel=*/true);
  }
  press_point_.reset();
}

void MerlinTab::OnMouseEntered(const ui::MouseEvent& event) {
  if (!closing_) {
    hover_animation_.Show();
  }
  SetCloseHovered(ShowsClose() && CloseBounds().Contains(event.location()));
}

void MerlinTab::OnMouseMoved(const ui::MouseEvent& event) {
  SetCloseHovered(ShowsClose() && CloseBounds().Contains(event.location()));
}

void MerlinTab::OnMouseExited(const ui::MouseEvent& event) {
  hover_animation_.Hide();
  SetCloseHovered(false);
}

void MerlinTab::SetCloseHovered(bool hovered) {
  if (close_hovered_ != hovered) {
    close_hovered_ = hovered;
    SchedulePaint();
  }
}

std::u16string MerlinTab::GetRenderedTooltipText(const gfx::Point& p) const {
  if (ShowsClose() && CloseBounds().Contains(p)) {
    return u"Close tab";
  }
  return data_.title;
}

void MerlinTab::OnBoundsChanged(const gfx::Rect& previous_bounds) {
  // The bar paints the active card under this tab.
  if (parent()) {
    parent()->SchedulePaint();
  }
}

void MerlinTab::OnThemeChanged() {
  views::View::OnThemeChanged();
  SchedulePaint();
}

void MerlinTab::AnimationProgressed(const gfx::Animation* animation) {
  SchedulePaint();
}

void MerlinTab::UpdateAccessibleName() {
  GetViewAccessibility().SetName(data_.title.empty() ? std::u16string(u"Tab")
                                                     : data_.title);
}

BEGIN_METADATA(MerlinTab)
END_METADATA

// MerlinNewTabButton --------------------------------------------------------

MerlinNewTabButton::MerlinNewTabButton(PressedCallback callback)
    : views::Button(std::move(callback)) {
  SetProperty(views::kHitTestComponentKey, static_cast<int>(HTCLIENT));
  SetTooltipText(u"New tab");
  GetViewAccessibility().SetName(u"New tab");
  SetFocusBehavior(FocusBehavior::NEVER);
}

MerlinNewTabButton::~MerlinNewTabButton() = default;

void MerlinNewTabButton::PaintButtonContents(gfx::Canvas* canvas) {
  const TabColors& c = ColorsFor(this);
  const gfx::RectF bounds(GetLocalBounds());
  const ButtonState state = GetState();
  if (state == STATE_HOVERED || state == STATE_PRESSED) {
    canvas->DrawRoundRect(
        bounds, width() > 2 * kNewTabSize ? kRowRadius : kNewTabRadius,
        Fill(state == STATE_PRESSED ? c.pressed_fill : c.close_hover));
  }
  cc::PaintFlags stroke;
  stroke.setAntiAlias(true);
  stroke.setStyle(cc::PaintFlags::kStroke_Style);
  stroke.setStrokeWidth(1.5f);
  stroke.setStrokeCap(cc::PaintFlags::kRound_Cap);
  const SkColor ink = state == STATE_HOVERED || state == STATE_PRESSED
                          ? c.text_active
                          : c.icon_subtle;
  stroke.setColor(ink);
  // Wide (the sidebar's row): the + where a favicon goes, then a label.
  const bool row = width() > 2 * kNewTabSize;
  gfx::PointF center = bounds.CenterPoint();
  if (row) {
    center.set_x(kTabPadding + kIconSize / 2.0f);
    const int text_x = kTabPadding + kIconSize + kIconGap;
    canvas->DrawStringRect(u"New tab", style::UiFont(), ink,
                           gfx::Rect(text_x, 0, width() - text_x, height()));
  }
  constexpr float kArm = 5.5f;
  canvas->DrawLine(center + gfx::Vector2dF(-kArm, 0),
                   center + gfx::Vector2dF(kArm, 0), stroke);
  canvas->DrawLine(center + gfx::Vector2dF(0, -kArm),
                   center + gfx::Vector2dF(0, kArm), stroke);
}

void MerlinNewTabButton::StateChanged(ButtonState old_state) {
  views::Button::StateChanged(old_state);
  SchedulePaint();
}

BEGIN_METADATA(MerlinNewTabButton)
END_METADATA

// MerlinTabBar --------------------------------------------------------------

MerlinTabBar::MerlinTabBar(BrowserWindowInterface* browser)
    : browser_(browser), model_(browser->GetTabStripModel()) {
  // Empty space drags the window, as Chromium's tab strip does.
  SetProperty(views::kHitTestComponentKey, static_cast<int>(HTCAPTION));
  GetViewAccessibility().SetRole(ax::mojom::Role::kTabList);
  GetViewAccessibility().SetName(u"Tabs");
  bounds_animator_.SetAnimationDuration(kLayoutDuration);
  new_tab_button_ = AddChildView(std::make_unique<MerlinNewTabButton>(
      base::BindRepeating(&MerlinTabBar::NewTab, base::Unretained(this))));
  model_->AddObserver(this);
  Rebuild();
}

MerlinTabBar::~MerlinTabBar() {
  model_->RemoveObserver(this);
  loading_timer_.Stop();
  bounds_animator_.Cancel();
}

void MerlinTabBar::SetActiveColor(std::optional<SkColor> color) {
  if (active_color_ == color) {
    return;
  }
  active_color_ = color;
  SchedulePaint();
  for (MerlinTab* tab : tabs_) {
    if (tab->data().active) {
      tab->SchedulePaint();
    }
  }
}

SkColor MerlinTabBar::ActiveFill() const {
  return active_color_ ? *active_color_ : ToolbarColor(this);
}

void MerlinTabBar::SetVertical(bool vertical, int top_inset) {
  if (vertical_ == vertical && top_inset_ == top_inset) {
    return;
  }
  vertical_ = vertical;
  top_inset_ = top_inset;
  if (drag_tab_) {
    EndDrag(/*cancel=*/true);
  }
  for (MerlinTab* tab : tabs_) {
    tab->SetVisible(true);
    tab->SchedulePaint();
  }
  new_tab_button_->SchedulePaint();
  LayoutTabs(/*animate=*/false);
}

void MerlinTabBar::SetLeadingInset(int inset) {
  if (leading_inset_ != inset) {
    leading_inset_ = inset;
    LayoutTabs(/*animate=*/false);
  }
}

std::optional<int> MerlinTabBar::IndexOf(const MerlinTab* tab) const {
  tabs::TabInterface* interface = tab ? tab->handle().Get() : nullptr;
  if (!interface) {
    return std::nullopt;
  }
  const int index = model_->GetIndexOfTab(interface);
  if (index == TabStripModel::kNoTab) {
    return std::nullopt;
  }
  return index;
}

void MerlinTabBar::ActivateTab(MerlinTab* tab) {
  if (std::optional<int> index = IndexOf(tab)) {
    model_->ActivateTabAt(*index, TabStripUserGestureDetails(
                                      TabStripUserGestureDetails::GestureType::kMouse));
  }
}

void MerlinTabBar::CloseTab(MerlinTab* tab) {
  if (std::optional<int> index = IndexOf(tab)) {
    model_->CloseWebContentsAt(*index, TabCloseTypes::CLOSE_USER_GESTURE |
                                           TabCloseTypes::CLOSE_CREATE_HISTORICAL_TAB);
  }
}

void MerlinTabBar::ToggleMute(MerlinTab* tab) {
  if (tabs::TabInterface* interface = tab->handle().Get()) {
    content::WebContents* contents = interface->GetContents();
    contents->SetAudioMuted(!contents->IsAudioMuted());
  }
}

void MerlinTabBar::NewTab() {
  chrome::ExecuteCommand(browser_, IDC_NEW_TAB);
}

MerlinTabData MerlinTabBar::DataFor(tabs::TabInterface* tab, int index) const {
  MerlinTabData data;
  data.pinned = tab->IsPinned();
  data.active = index == model_->active_index();
  data.split = tab->GetSplit();
  if (TabUIHelper* helper = TabUIHelper::From(tab)) {
    data.title = helper->GetTitle();
    data.favicon = helper->GetFavicon();
    data.show_favicon = helper->ShouldDisplayFavicon();
    data.themify_favicon = helper->ShouldThemifyFavicon();
    data.crashed = helper->IsCrashed();
    data.discarded = helper->IsDiscarded();
    data.network_state = helper->ShouldHideThrobber()
                             ? tabs::TabNetworkState::kNone
                             : helper->GetTabNetworkState();
  }
  if (const auto* alerts = tabs::TabAlertController::From(tab)) {
    data.alert = alerts->GetAlertToShow();
  }
  return data;
}

void MerlinTabBar::Rebuild() {
  // A model change ends any drag; the mouse-up is then ignored.
  if (drag_tab_) {
    drag_tab_->SetDragging(false);
    drag_tab_ = nullptr;
  }
  std::vector<raw_ptr<MerlinTab>> next;
  std::vector<MerlinTab*> added;
  for (int i = 0; i < model_->count(); ++i) {
    tabs::TabInterface* tab = model_->GetTabAtIndex(i);
    const tabs::TabHandle handle = tab->GetHandle();
    MerlinTab* view = nullptr;
    for (MerlinTab* existing : tabs_) {
      if (existing->handle() == handle) {
        view = existing;
        break;
      }
    }
    if (!view) {
      view = AddChildViewAt(std::make_unique<MerlinTab>(this, handle),
                            GetIndexOf(new_tab_button_).value());
      added.push_back(view);
    }
    view->SetData(DataFor(tab, i));
    next.push_back(view);
  }

  // Tabs that left the model shrink away, then are deleted.
  for (MerlinTab* old : tabs_) {
    if (std::find(next.begin(), next.end(), old) != next.end()) {
      continue;
    }
    old->SetClosing();
    if (!laid_out_once_ || !GetWidget()) {
      auto removed = RemoveChildViewT(old);
      continue;
    }
    const gfx::Rect gone =
        vertical_ ? gfx::Rect(old->x(), old->y() + old->height() / 2,
                              old->width(), 0)
                  : gfx::Rect(old->x() + old->width() / 2, 0, 0, height());
    bounds_animator_.AnimateViewTo(
        old, gone,
        std::make_unique<RemoveTabDelegate>(weak_factory_.GetWeakPtr(),
                                            old->handle()));
  }
  tabs_ = std::move(next);

  for (size_t i = 0; i < tabs_.size(); ++i) {
    MerlinTab::Join join = MerlinTab::Join::kNone;
    if (i + 1 < tabs_.size() && SameSplit(tabs_[i], tabs_[i + 1])) {
      join = MerlinTab::Join::kLeft;
    } else if (i > 0 && SameSplit(tabs_[i], tabs_[i - 1])) {
      join = MerlinTab::Join::kRight;
    }
    tabs_[i]->SetJoin(join);
  }

  // New tabs grow from nothing at their place.
  if (laid_out_once_) {
    const Slots slots = ComputeSlots();
    for (MerlinTab* view : added) {
      auto it = std::find(tabs_.begin(), tabs_.end(), view);
      const gfx::Rect& slot = slots.tabs[it - tabs_.begin()];
      view->SetBoundsRect(vertical_
                              ? gfx::Rect(slot.x(), slot.y(), slot.width(), 0)
                              : gfx::Rect(slot.x(), 0, 0, height()));
    }
  }
  {
    base::AutoReset<bool> reveal(&reveal_active_, true);
    LayoutTabs(/*animate=*/laid_out_once_);
  }
  UpdateLoadingTimer();
  SchedulePaint();
}

void MerlinTabBar::UpdateTab(tabs::TabInterface* tab) {
  const int index = model_->GetIndexOfTab(tab);
  if (index == TabStripModel::kNoTab) {
    return;
  }
  const tabs::TabHandle handle = tab->GetHandle();
  for (MerlinTab* view : tabs_) {
    if (view->handle() == handle) {
      view->SetData(DataFor(tab, index));
      break;
    }
  }
  UpdateLoadingTimer();
}

MerlinTabBar::Slots MerlinTabBar::ComputeSlots() const {
  // The order to lay out: the model's, with a dragged tab at its target.
  std::vector<MerlinTab*> order(tabs_.begin(), tabs_.end());
  if (drag_tab_) {
    auto it = std::find(order.begin(), order.end(), drag_tab_.get());
    if (it != order.end()) {
      order.erase(it);
      order.insert(order.begin() +
                       std::clamp<int>(drag_target_index_, 0, order.size()),
                   drag_tab_.get());
    }
  }

  if (vertical_) {
    return ComputeRowSlots(order);
  }

  int pinned = 0;
  int unpinned = 0;
  bool active_unpinned = false;
  for (MerlinTab* tab : order) {
    if (tab->data().pinned) {
      ++pinned;
    } else {
      ++unpinned;
      active_unpinned |= tab->data().active;
    }
  }
  const int start = leading_inset_ + kLeadingPad;
  const int pinned_room =
      pinned ? 2 * kCapsulePad + pinned * kPinnedWidth + kAfterCapsule : 0;
  const int room = width() - start - pinned_room - kTrailingPad -
                   kNewTabSize - 2 * kTabGap;
  const int free =
      std::max(0, room - std::max(0, unpinned - 1) * kTabGap);
  int width_each = unpinned ? std::clamp(free / std::max(unpinned, 1),
                                         kMinTabWidth, kMaxTabWidth)
                            : 0;
  int active_width = width_each;
  if (active_unpinned && unpinned > 1 && width_each < kActiveMinWidth) {
    // The active tab keeps room for its title; the others give way.
    active_width = std::max(
        width_each,
        std::min(kActiveMinWidth, free - (unpinned - 1) * kMinTabWidth));
    width_each = std::clamp((free - active_width) / (unpinned - 1),
                            kMinTabWidth, kMaxTabWidth);
  }

  std::vector<gfx::Rect> by_order;
  int x = start + (pinned ? kCapsulePad : 0);
  const MerlinTab* previous = nullptr;
  for (MerlinTab* tab : order) {
    if (previous) {
      if (previous->data().pinned && !tab->data().pinned) {
        x += kCapsulePad + kAfterCapsule;
      } else if (!tab->data().pinned) {
        x += SameSplit(previous, tab) ? kSplitGap : kTabGap;
      }
    }
    const int w = tab->data().pinned ? kPinnedWidth
                  : tab->data().active ? active_width
                                       : width_each;
    by_order.emplace_back(x, 0, w, height());
    x += w;
    previous = tab;
  }
  if (previous && previous->data().pinned) {
    x += kCapsulePad;
  }

  Slots slots;
  // Back to model order (tabs_), which callers index by.
  for (MerlinTab* tab : tabs_) {
    auto it = std::find(order.begin(), order.end(), tab);
    slots.tabs.push_back(by_order[it - order.begin()]);
  }
  const int new_tab_x = std::min(x + (order.empty() ? 0 : kTabGap + 4),
                                 width() - kTrailingPad - kNewTabSize);
  slots.new_tab = gfx::Rect(
      std::max(start, new_tab_x),
      kTopInset + (height() - kTopInset - kNewTabSize) / 2 - 1, kNewTabSize,
      kNewTabSize);
  return slots;
}

MerlinTabBar::Slots MerlinTabBar::ComputeRowSlots(
    const std::vector<MerlinTab*>& order) const {
  const int x = kSidePad;
  const int w = std::max(0, width() - 2 * kSidePad);
  int y = top_inset_;

  // Pinned tabs: icon tiles in a capsule at the top, as many to a row as fit.
  int pinned = 0;
  for (MerlinTab* tab : order) {
    pinned += tab->data().pinned ? 1 : 0;
  }
  std::vector<gfx::Rect> by_order;
  if (pinned) {
    const int inner = std::max(1, w - 2 * kCapsulePad);
    const int columns =
        std::clamp(inner / kPinnedMinTile, 1, std::max(pinned, 1));
    const int tile = inner / columns;
    int i = 0;
    for (MerlinTab* tab : order) {
      if (!tab->data().pinned) {
        continue;
      }
      by_order.emplace_back(x + kCapsulePad + (i % columns) * tile,
                            y + kCapsulePad + (i / columns) * kPinnedTileHeight,
                            tile, kPinnedTileHeight);
      ++i;
    }
    const int rows = (pinned + columns - 1) / columns;
    y += 2 * kCapsulePad + rows * kPinnedTileHeight + kAfterCapsule;
  }

  // The rest: one row each, scrolled when they do not all fit (the + row
  // then stays at the bottom).
  const int unpinned = static_cast<int>(order.size()) - pinned;
  const int step = kRowHeight + kRowGap;
  const int rows_bottom =
      height() - kSidebarBottomPad - kRowHeight - kRowGap;
  const int fit = std::max(1, (rows_bottom - y + kRowGap) / step);
  const int scroll = std::clamp(scroll_, 0, std::max(0, unpinned - fit));
  int row = 0;
  for (MerlinTab* tab : order) {
    if (tab->data().pinned) {
      continue;
    }
    by_order.emplace_back(x, y + (row - scroll) * step, w, kRowHeight);
    ++row;
  }
  // Pinned tiles came first in by_order; put everything in `order`'s order.
  std::vector<gfx::Rect> ordered;
  int next_pinned = 0;
  int next_row = pinned;
  for (MerlinTab* tab : order) {
    ordered.push_back(by_order[tab->data().pinned ? next_pinned++ : next_row++]);
  }

  Slots slots;
  for (MerlinTab* tab : tabs_) {
    auto it = std::find(order.begin(), order.end(), tab);
    slots.tabs.push_back(ordered[it - order.begin()]);
  }
  const int after_rows = y + std::min(unpinned, fit) * step;
  slots.new_tab = gfx::Rect(x, unpinned > fit ? rows_bottom + kRowGap : after_rows,
                            w, kRowHeight);
  return slots;
}

gfx::Rect MerlinTabBar::CapsuleBounds() const {
  gfx::Rect capsule;
  for (MerlinTab* tab : tabs_) {
    if (tab->data().pinned && !tab->closing() && !tab->dragging()) {
      capsule.Union(tab->bounds());
    }
  }
  if (capsule.IsEmpty()) {
    return capsule;
  }
  if (vertical_) {
    capsule.Outset(kCapsulePad);
    return capsule;
  }
  const int body_center = kTopInset + (height() - kTopInset) / 2;
  return gfx::Rect(capsule.x() - kCapsulePad, body_center - kCapsuleHeight / 2,
                   capsule.width() + 2 * kCapsulePad, kCapsuleHeight);
}

bool MerlinTabBar::OnMouseWheel(const ui::MouseWheelEvent& event) {
  if (!vertical_ || max_scroll_ == 0) {
    return false;
  }
  // Whole rows at a time, so no row is ever cut in half at the edges.
  wheel_remainder_ += event.y_offset();
  const int rows = wheel_remainder_ / kWheelPerRow;
  if (rows == 0) {
    return true;
  }
  wheel_remainder_ -= rows * kWheelPerRow;
  const int scroll = std::clamp(scroll_ - rows, 0, max_scroll_);
  if (scroll != scroll_) {
    scroll_ = scroll;
    LayoutTabs(/*animate=*/true);
  }
  return true;
}

void MerlinTabBar::LayoutTabs(bool animate) {
  if (width() == 0) {
    return;
  }
  if (vertical_) {
    // How far the rows can scroll.
    int pinned = 0;
    for (MerlinTab* tab : tabs_) {
      pinned += tab->data().pinned ? 1 : 0;
    }
    const int saved = scroll_;
    scroll_ = 0;
    const Slots top = ComputeSlots();
    scroll_ = saved;
    int fit = 0;
    for (size_t i = 0; i < tabs_.size(); ++i) {
      if (!tabs_[i]->data().pinned &&
          top.tabs[i].bottom() <= top.new_tab.y()) {
        ++fit;
      }
    }
    const int unpinned = static_cast<int>(tabs_.size()) - pinned;
    fit = std::max(fit, 1);
    max_scroll_ = std::max(0, unpinned - fit);
    if (reveal_active_) {
      // Keep the active row in view.
      int row = 0;
      for (MerlinTab* tab : tabs_) {
        if (tab->data().pinned) {
          continue;
        }
        if (tab->data().active) {
          if (row < scroll_) {
            scroll_ = row;
          } else if (row >= scroll_ + fit) {
            scroll_ = row - fit + 1;
          }
          break;
        }
        ++row;
      }
    }
    scroll_ = std::clamp(scroll_, 0, max_scroll_);
  } else {
    scroll_ = max_scroll_ = 0;
  }
  const Slots slots = ComputeSlots();
  // Sidebar rows scrolled out of the list hide, so they never cover the
  // pinned tiles or the + row.
  int list_top = 0;
  if (vertical_) {
    list_top = top_inset_;
    const gfx::Rect capsule = CapsuleBounds();
    if (!capsule.IsEmpty()) {
      list_top = capsule.bottom() + kAfterCapsule - kCapsulePad;
    }
  }
  for (size_t i = 0; i < tabs_.size(); ++i) {
    MerlinTab* tab = tabs_[i];
    if (vertical_ && !tab->data().pinned) {
      tab->SetVisible(tab == drag_tab_ ||
                      (slots.tabs[i].y() >= list_top - 1 &&
                       slots.tabs[i].bottom() <= slots.new_tab.y()));
    } else {
      tab->SetVisible(true);
    }
    if (tab == drag_tab_) {
      continue;  // Follows the mouse.
    }
    if (animate) {
      bounds_animator_.AnimateViewTo(tab, slots.tabs[i]);
    } else {
      bounds_animator_.StopAnimatingView(tab);
      tab->SetBoundsRect(slots.tabs[i]);
    }
  }
  if (animate) {
    bounds_animator_.AnimateViewTo(new_tab_button_, slots.new_tab);
  } else {
    bounds_animator_.StopAnimatingView(new_tab_button_);
    new_tab_button_->SetBoundsRect(slots.new_tab);
  }
  laid_out_once_ = true;
  SchedulePaint();
}

void MerlinTabBar::RemoveClosedTab(tabs::TabHandle handle) {
  // Every closing view for that tab (a tab can close, come back and close
  // again before the first view is gone).
  std::vector<MerlinTab*> closed;
  for (views::View* child : children()) {
    auto* tab = views::AsViewClass<MerlinTab>(child);
    if (tab && tab->closing() && tab->handle() == handle &&
        !bounds_animator_.IsAnimating(tab)) {
      closed.push_back(tab);
    }
  }
  for (MerlinTab* tab : closed) {
    auto removed = RemoveChildViewT(tab);
  }
}

void MerlinTabBar::Layout(PassKey) {
  // Nothing: tabs are placed by LayoutTabs, which animates model changes.
  // Size changes come through OnBoundsChanged.
}

void MerlinTabBar::OnBoundsChanged(const gfx::Rect& previous_bounds) {
  if (previous_bounds.size() != size()) {
    // A resized window lays out at once.
    if (drag_tab_) {
      EndDrag(/*cancel=*/true);
    }
    LayoutTabs(/*animate=*/false);
  }
}

void MerlinTabBar::OnPaint(gfx::Canvas* canvas) {
  // Under the tabs: the pinned capsule, the divider after it, and the
  // active tab cut from the toolbar (its flares reach past its own view).
  const TabColors& c = ColorsFor(this);
  const int body_top = kTopInset;
  const int body_center = body_top + (height() - body_top) / 2;

  // One even surface, the color around the page card, so the tab row (or
  // the sidebar) and the card's margins read as one piece of chrome, and
  // nothing of Chromium's strip shows through.
  canvas->DrawColor(ToolbarColor(this));

  // Pinned tabs share one capsule.
  const gfx::Rect capsule = CapsuleBounds();
  if (!capsule.IsEmpty()) {
    PaintRoundRect(canvas, capsule, kCapsuleRadius, c.capsule_fill,
                   c.capsule_border);
    // The active pinned tab: a page-colored tile inside the capsule.
    for (MerlinTab* tab : tabs_) {
      if (tab->data().pinned && tab->data().active && !tab->dragging()) {
        gfx::Rect tile = vertical_
                             ? gfx::Rect(tab->x() + 3, tab->y() + 3,
                                         tab->width() - 6, tab->height() - 6)
                             : gfx::Rect(tab->x() + 2, capsule.y() + 3,
                                         tab->width() - 4, capsule.height() - 6);
        const SkColor fill = ActiveFill();
        PaintRoundRect(canvas, tile, kHoverRadius - 1, fill,
                       ActiveBorder(this, fill));
      }
    }
    // A hairline between the capsule and the tabs, unless the first tab is
    // the active one (its own edge separates them).
    const MerlinTab* first = nullptr;
    for (MerlinTab* tab : tabs_) {
      if (!tab->data().pinned && !tab->closing()) {
        first = tab;
        break;
      }
    }
    if (vertical_) {
      const int y = capsule.bottom() + kAfterCapsule / 2 - 1;
      canvas->FillRect(gfx::Rect(capsule.x() + kTabPadding, y,
                                 capsule.width() - 2 * kTabPadding, 1),
                       c.divider);
    } else if (first && !first->data().active) {
      const int x = capsule.right() + kAfterCapsule / 2;
      canvas->FillRect(gfx::Rect(x, body_center - 8, 1, 16), c.divider);
    }
  }

  // The active tab (a split pair holding it shares one shape, with a
  // hairline between its halves).
  for (size_t i = 0; i < tabs_.size(); ++i) {
    MerlinTab* tab = tabs_[i];
    MerlinTab* next = i + 1 < tabs_.size() ? tabs_[i + 1].get() : nullptr;
    const bool pair = SameSplit(tab, next);
    const bool active = tab->data().active || (pair && next->data().active);
    if (!active || tab->closing() || tab->data().pinned || tab->dragging() ||
        !tab->GetVisible()) {
      if (pair) {
        ++i;
      }
      continue;
    }
    if (vertical_) {
      gfx::Rect card = tab->bounds();
      if (pair && !next->dragging() && next->GetVisible()) {
        card.Union(next->bounds());
      }
      const SkColor fill = ActiveFill();
      PaintActiveRow(canvas, card, fill, ActiveBorder(this, fill));
      if (pair) {
        canvas->FillRect(gfx::Rect(card.x() + kTabPadding, next->y() - 1,
                                   card.width() - 2 * kTabPadding, 1),
                         c.divider);
        ++i;
      }
      continue;
    }
    gfx::Rect shape(tab->x(), body_top, tab->width(), height() - body_top);
    if (pair && !next->dragging()) {
      shape.Union(gfx::Rect(next->x(), body_top, next->width(),
                            height() - body_top));
    }
    const SkColor fill = ActiveFill();
    PaintAttachedTab(canvas, shape, /*flares=*/true, fill,
                     ActiveBorder(this, fill));
    if (pair) {
      canvas->FillRect(
          gfx::Rect(next->x() - 1, body_center - 8, 1, 16), c.divider);
      ++i;
    }
  }
}

void MerlinTabBar::OnThemeChanged() {
  views::View::OnThemeChanged();
  SchedulePaint();
}

void MerlinTabBar::DragTab(MerlinTab* tab, int pos_in_bar, int grab_offset) {
  if (!drag_tab_) {
    std::optional<int> index = IndexOf(tab);
    if (!index) {
      return;
    }
    drag_tab_ = tab;
    drag_target_index_ = *index;
    tab->SetDragging(true);
    bounds_animator_.StopAnimatingView(tab);
    tab->SetBoundsRect(bounds_animator_.GetTargetBounds(tab));
    ReorderChildView(tab, children().size());
  }
  // Pinned tabs move among pinned tabs, the rest among the rest.
  int first = 0;
  int last = static_cast<int>(tabs_.size()) - 1;
  int pinned = 0;
  for (MerlinTab* other : tabs_) {
    pinned += other->data().pinned ? 1 : 0;
  }
  if (tab->data().pinned) {
    last = pinned - 1;
  } else {
    first = pinned;
  }
  const Slots slots = ComputeSlots();
  if (slots.tabs.empty() || first > last) {
    return;
  }
  // Along the bar's axis: x on top; y in the sidebar (where pinned tiles
  // sit in a grid, and move by their order along it).
  const bool along_y = vertical_ && !tab->data().pinned;
  auto start_of = [&](const gfx::Rect& r) { return along_y ? r.y() : r.x(); };
  auto end_of = [&](const gfx::Rect& r) {
    return along_y ? r.bottom() : r.right();
  };
  const int extent = along_y ? tab->height() : tab->width();
  const int lo = start_of(slots.tabs[first]);
  int hi = lo;
  for (int i = first; i <= last; ++i) {
    hi = std::max(hi, end_of(slots.tabs[i]) - extent);
  }
  const int pos = std::clamp(pos_in_bar - grab_offset, std::min(lo, hi), hi);
  if (along_y) {
    tab->SetBoundsRect(gfx::Rect(tab->x(), pos, tab->width(), tab->height()));
  } else if (vertical_) {
    tab->SetBoundsRect(gfx::Rect(pos, tab->y(), tab->width(), tab->height()));
  } else {
    tab->SetBoundsRect(gfx::Rect(pos, 0, tab->width(), height()));
  }

  // The target: past every other tab in its range whose middle it crossed.
  const int center = pos + extent / 2;
  int target = first;
  for (int i = first; i <= last; ++i) {
    if (tabs_[i] == tab) {
      continue;
    }
    // Where that tab is headed, not where it is mid-animation.
    const gfx::Rect bounds = bounds_animator_.GetTargetBounds(tabs_[i]);
    const int other = along_y ? bounds.CenterPoint().y() : bounds.CenterPoint().x();
    if (other < center) {
      ++target;
    }
  }
  if (target != drag_target_index_) {
    drag_target_index_ = target;
    LayoutTabs(/*animate=*/true);
  }
  SchedulePaint();
}

void MerlinTabBar::EndDrag(bool cancel) {
  MerlinTab* tab = drag_tab_;
  if (!tab) {
    return;
  }
  drag_tab_ = nullptr;
  tab->SetDragging(false);
  std::optional<int> from = IndexOf(tab);
  if (!cancel && from && *from != drag_target_index_) {
    // The model's Moved notification rebuilds and animates into place.
    model_->MoveWebContentsAt(*from, drag_target_index_,
                              /*select_after_move=*/false);
    return;
  }
  LayoutTabs(/*animate=*/true);
}

void MerlinTabBar::UpdateLoadingTimer() {
  bool any = false;
  for (MerlinTab* tab : tabs_) {
    any |= tab->loading();
  }
  if (any && !loading_timer_.IsRunning()) {
    loading_start_ = base::TimeTicks::Now();
    loading_timer_.Start(FROM_HERE, kLoadingFrame, this,
                         &MerlinTabBar::OnLoadingTimer);
  } else if (!any) {
    loading_timer_.Stop();
  }
}

void MerlinTabBar::OnLoadingTimer() {
  const base::TimeDelta elapsed = base::TimeTicks::Now() - loading_start_;
  bool any = false;
  for (MerlinTab* tab : tabs_) {
    any |= tab->AdvanceLoadingAnimation(elapsed);
  }
  if (!any) {
    loading_timer_.Stop();
  }
}

void MerlinTabBar::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  Rebuild();
}

void MerlinTabBar::OnTabChangedAt(tabs::TabInterface* tab,
                                  TabChangeType change_type) {
  UpdateTab(tab);
}

void MerlinTabBar::OnTabPinnedStateChanged(tabs::TabInterface* tab,
                                           int index) {
  Rebuild();
}

void MerlinTabBar::OnSplitTabChanged(const SplitTabChange& change) {
  Rebuild();
}

void MerlinTabBar::ShowContextMenuForViewImpl(
    views::View* source,
    const gfx::Point& point,
    ui::mojom::MenuSourceType source_type) {
  auto* tab = views::AsViewClass<MerlinTab>(source);
  std::optional<int> index = IndexOf(tab);
  if (!index) {
    return;
  }
  menu_tab_ = tab->handle();
  menu_model_ = std::make_unique<TabMenuModel>(
      this, TabMenuModelDelegate::From(browser_), model_, *index);
  menu_runner_ = std::make_unique<views::MenuRunner>(
      menu_model_.get(),
      views::MenuRunner::HAS_MNEMONICS | views::MenuRunner::CONTEXT_MENU);
  menu_runner_->RunMenuAt(GetWidget(), nullptr, gfx::Rect(point, gfx::Size()),
                          views::MenuAnchorPosition::kTopLeft, source_type);
}

bool MerlinTabBar::IsCommandIdChecked(int command_id) const {
  return false;
}

bool MerlinTabBar::IsCommandIdEnabled(int command_id) const {
  if (!menu_tab_ || command_id < 0 ||
      command_id > tabs::CommandToggleFocusGroup) {
    return false;
  }
  tabs::TabInterface* tab = menu_tab_->Get();
  const int index = tab ? model_->GetIndexOfTab(tab) : TabStripModel::kNoTab;
  return index != TabStripModel::kNoTab &&
         model_->IsContextMenuCommandEnabled(
             index, static_cast<TabStripModel::ContextMenuCommand>(command_id));
}

void MerlinTabBar::ExecuteCommand(int command_id, int event_flags) {
  if (!IsCommandIdEnabled(command_id)) {
    return;
  }
  const int index = model_->GetIndexOfTab(menu_tab_->Get());
  model_->ExecuteContextMenuCommand(
      index, static_cast<TabStripModel::ContextMenuCommand>(command_id));
}

BEGIN_METADATA(MerlinTabBar)
END_METADATA

// MerlinTabBarHost ----------------------------------------------------------

MerlinTabBarHost::MerlinTabBarHost(BrowserWindowInterface* browser,
                                   BrowserView* browser_view)
    : browser_(browser), browser_view_(browser_view) {
  auto bar = std::make_unique<MerlinTabBar>(browser);
  bar->SetProperty(views::kViewIgnoredByLayoutKey, true);
  bar->SetVisible(false);
  bar_ = browser_view_->AddChildView(std::move(bar));
  Update();
}

MerlinTabBarHost::~MerlinTabBarHost() {
  SetChromiumStripHidden(false);
  if (region_) {
    region_->RemoveObserver(this);
    region_ = nullptr;
  }
  if (bar_) {
    auto removed = browser_view_->RemoveChildViewT(bar_.get());
    bar_ = nullptr;
  }
}

void MerlinTabBarHost::Update() {
  if (updating_ || !bar_) {
    return;
  }
  base::AutoReset<bool> reentry(&updating_, true);
  auto* sidebar = tabs::VerticalTabStripStateController::From(browser_.get());
  const bool tabs_on_top = !sidebar || !sidebar->ShouldDisplayVerticalTabs();
  // Chromium's strip in use: the row on top, or the sidebar.
  views::View* region = browser_view_->tab_strip_view();
  if (region != region_) {
    SetChromiumStripHidden(false);
    if (region_) {
      region_->RemoveObserver(this);
    }
    region_ = region;
    if (region_) {
      region_->AddObserver(this);
    }
  }
  // Only while Chromium's strip is in this window's own view tree; in
  // fullscreen it lives in an overlay widget that slides down.
  const bool usable = region_ && region_->GetVisible() &&
                      region_->parent() == browser_view_.get() &&
                      browser_view_->GetTabStripVisible() &&
                      !region_->bounds().IsEmpty();
  if (!usable) {
    bar_->SetVisible(false);
    SetChromiumStripHidden(false);
    return;
  }
  views::View* toolbar = browser_view_->toolbar();
  const bool toolbar_shown = toolbar && toolbar->GetVisible();
  const int toolbar_top =
      toolbar_shown ? static_cast<int>(views::View::ConvertRectToTarget(
                                           toolbar->parent(), browser_view_,
                                           gfx::RectF(toolbar->bounds()))
                                           .y())
                    : 0;
  if (!tabs_on_top) {
    // The sidebar: the whole column, rows starting level with the page
    // (below the traffic lights, beside the toolbar).
    const gfx::Rect bounds = region_->bounds();
    const int toolbar_bottom =
        toolbar_shown ? toolbar_top + toolbar->height() : bounds.y() + 44;
    bar_->SetLeadingInset(0);
    bar_->SetVertical(true, std::max(0, toolbar_bottom - bounds.y()));
    bar_->SetBoundsRect(bounds);
    if (browser_view_->children().back() != bar_.get()) {
      browser_view_->ReorderChildView(bar_, browser_view_->children().size());
    }
    bar_->SetVisible(true);
    SetChromiumStripHidden(true);
    return;
  }
  bar_->SetVertical(false, 0);
  // Tabs start where Chromium's would: after the traffic lights.
  int leading = region_->GetInsets().left();
  for (views::View* child : region_->children()) {
    if (child->GetVisible() && child->width() > 0) {
      leading = std::max(leading, std::min(child->x(), region_->width() / 3));
      break;
    }
  }
  // From the window's left edge (Chromium's row starts after the traffic
  // lights; the bar paints behind them too), down to the toolbar's top edge
  // exactly, so the active tab runs on into it.
  gfx::Rect bounds = region_->bounds();
  leading += bounds.x();
  bounds.SetByBounds(0, bounds.y(), bounds.right(), bounds.bottom());
  bar_->SetLeadingInset(leading);
  if (toolbar_shown && toolbar_top > bounds.y() + 20) {
    bounds.set_height(toolbar_top - bounds.y());
  }
  bar_->SetBoundsRect(bounds);
  // Above Chromium's strip and everything else in the row.
  if (browser_view_->children().back() != bar_.get()) {
    browser_view_->ReorderChildView(bar_, browser_view_->children().size());
  }
  bar_->SetVisible(true);
  SetChromiumStripHidden(true);
}

void MerlinTabBarHost::SetChromiumStripHidden(bool hidden) {
  if (!region_ || region_hidden_ == hidden) {
    return;
  }
  region_hidden_ = hidden;
  if (!region_->layer()) {
    region_->SetPaintToLayer();
    region_->layer()->SetFillsBoundsOpaquely(false);
  }
  region_->layer()->SetOpacity(hidden ? 0.0f : 1.0f);
  region_->SetCanProcessEventsWithinSubtree(!hidden);
}

void MerlinTabBarHost::OnViewBoundsChanged(views::View* observed_view) {
  Update();
}

void MerlinTabBarHost::OnViewVisibilityChanged(views::View* observed_view,
                                               views::View* starting_view,
                                               bool visible) {
  Update();
}

void MerlinTabBarHost::OnViewAddedToWidget(views::View* observed_view) {
  Update();
}

void MerlinTabBarHost::OnViewRemovedFromWidget(views::View* observed_view) {
  Update();
}

void MerlinTabBarHost::OnViewIsDeleting(views::View* observed_view) {
  if (observed_view == region_) {
    region_->RemoveObserver(this);
    region_ = nullptr;
    region_hidden_ = false;
  }
}

}  // namespace modal_browser
