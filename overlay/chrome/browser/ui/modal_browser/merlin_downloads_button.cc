// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_downloads_button.h"

#include <algorithm>
#include <utility>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/utf_string_conversions.h"
#include "base/supports_user_data.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/cancelable_task_tracker.h"
#include "base/time/time.h"
#include "cc/paint/paint_flags.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/icon_manager.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/color/chrome_color_id.h"
#include "chrome/browser/ui/modal_browser/merlin_downloads.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/common/pref_names.h"
#include "components/download/public/common/download_item.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/download_manager.h"
#include "third_party/skia/include/core/SkPathBuilder.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/mojom/dialog_button.mojom.h"
#include "ui/color/color_id.h"
#include "ui/color/color_provider.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/skia_conversions.h"
#include "ui/gfx/image/image.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/gfx/text_elider.h"
#include "ui/gfx/text_utils.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/bubble/bubble_dialog_delegate_view.h"
#include "ui/views/controls/highlight_path_generator.h"
#include "ui/views/layout/box_layout.h"
#include "ui/views/widget/widget.h"

namespace modal_browser {

namespace {

constexpr int kButtonSize = 30;
constexpr int kPopoverWidth = 340;
constexpr int kMaxRows = 6;
constexpr int kRowHeight = 50;
constexpr int kHeaderHeight = 38;
constexpr int kFooterHeight = 40;
constexpr int kSideInset = 8;
constexpr int kIconSize = 26;
constexpr int kActionSize = 24;
constexpr float kHoverRadius = 8;
constexpr base::TimeDelta kRecentFor = base::Days(1);

// When the user last pressed Clear, per profile.
struct ClearedAt : public base::SupportsUserData::Data {
  base::Time time;
};
constexpr char kClearedAtKey[] = "merlin_downloads_cleared_at";

base::Time ClearedTime(Profile* profile) {
  auto* data = static_cast<ClearedAt*>(profile->GetUserData(kClearedAtKey));
  return data ? data->time : base::Time();
}

bool Running(const download::DownloadItem* item) {
  const std::string state = MerlinDownloadState(item);
  return state == "progress" || state == "paused" || state == "dangerous";
}

download::DownloadItem* FindItem(Profile* profile, uint32_t id) {
  content::DownloadManager* manager =
      profile ? profile->GetDownloadManager() : nullptr;
  return manager ? manager->GetDownload(id) : nullptr;
}

SkColor Color(const views::View* view, ui::ColorId id) {
  return view->GetColorProvider()->GetColor(id);
}

style::Ink PopoverInk(const views::View* view) {
  return style::InkOn(Color(view, ui::kColorBubbleBackground));
}

// A round progress ring: `fraction` of it in `fill`, the rest in `track`.
void PaintRing(gfx::Canvas* canvas,
               const gfx::RectF& bounds,
               float fraction,
               SkColor track,
               SkColor fill) {
  constexpr float kStroke = 2.5f;
  gfx::RectF ring = bounds;
  ring.Inset(kStroke / 2 + 1);
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setStyle(cc::PaintFlags::kStroke_Style);
  flags.setStrokeWidth(kStroke);
  flags.setColor(track);
  canvas->DrawCircle(ring.CenterPoint(), ring.width() / 2, flags);
  if (fraction > 0) {
    flags.setColor(fill);
    flags.setStrokeCap(cc::PaintFlags::kRound_Cap);
    SkPathBuilder arc;
    arc.arcTo(gfx::RectFToSkRect(ring), -90, 360 * std::min(fraction, 1.f),
              /*forceMoveTo=*/true);
    canvas->DrawPath(arc.detach(), flags);
  }
}

// A small round button at the end of a row: cancel (⊗), show in Finder or
// retry.
class RowAction : public views::Button {
  METADATA_HEADER(RowAction, views::Button)

 public:
  enum class Kind { kCancel, kShow, kRetry };

  RowAction(Kind kind, std::u16string name, PressedCallback callback)
      : views::Button(std::move(callback)), kind_(kind) {
    SetAccessibleName(name);
    SetTooltipText(name);
    SetFocusBehavior(FocusBehavior::ALWAYS);
    views::InstallCircleHighlightPathGenerator(this);
  }

  gfx::Size CalculatePreferredSize(const views::SizeBounds&) const override {
    return {kActionSize, kActionSize};
  }

  void StateChanged(ButtonState old_state) override {
    views::Button::StateChanged(old_state);
    SchedulePaint();
  }

  void PaintButtonContents(gfx::Canvas* canvas) override {
    const style::Ink ink = PopoverInk(this);
    const bool hot = GetState() == STATE_HOVERED || GetState() == STATE_PRESSED;
    // Show in Finder appears with the row's hover, as in a Finder list.
    if (kind_ == Kind::kShow && !hot && !HasFocus() &&
        !(parent() && parent()->IsMouseHovered())) {
      return;
    }
    const gfx::PointF c = gfx::RectF(GetLocalBounds()).CenterPoint();
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    flags.setStyle(cc::PaintFlags::kStroke_Style);
    flags.setStrokeWidth(1.5f);
    flags.setStrokeCap(cc::PaintFlags::kRound_Cap);
    flags.setStrokeJoin(cc::PaintFlags::kRound_Join);
    flags.setColor(hot ? ink.text : ink.text_dim);
    SkPathBuilder path;
    switch (kind_) {
      case Kind::kCancel:
        // ⊗: a circle with a cross.
        canvas->DrawCircle(c, 7.5f, flags);
        path.moveTo(c.x() - 3, c.y() - 3).lineTo(c.x() + 3, c.y() + 3);
        path.moveTo(c.x() + 3, c.y() - 3).lineTo(c.x() - 3, c.y() + 3);
        break;
      case Kind::kShow:
        // A magnifier over the file: show it in Finder.
        canvas->DrawCircle(gfx::PointF(c.x() - 1.5f, c.y() - 1.5f), 4.5f,
                           flags);
        path.moveTo(c.x() + 1.8f, c.y() + 1.8f).lineTo(c.x() + 5, c.y() + 5);
        break;
      case Kind::kRetry:
        // ↻
        path.arcTo(SkRect::MakeLTRB(c.x() - 6, c.y() - 6, c.x() + 6, c.y() + 6),
                   -60, 300, /*forceMoveTo=*/true);
        path.moveTo(c.x() + 3.5f, c.y() - 7.5f)
            .lineTo(c.x() + 3.2f, c.y() - 4.6f)
            .lineTo(c.x() + 6, c.y() - 4);
        break;
    }
    canvas->DrawPath(path.detach(), flags);
  }

 private:
  const Kind kind_;
};

BEGIN_METADATA(RowAction)
END_METADATA

// One download: icon or progress ring, the file name (elided in the middle,
// so the extension shows), a status line and an action.
class DownloadRow : public views::Button {
  METADATA_HEADER(DownloadRow, views::Button)

 public:
  DownloadRow(Profile* profile,
              uint32_t id,
              base::RepeatingClosure show_all,
              base::RepeatingClosure close)
      : views::Button(base::BindRepeating(&DownloadRow::Activate,
                                          base::Unretained(this))),
        profile_(profile),
        id_(id),
        show_all_(std::move(show_all)),
        close_(std::move(close)) {
    SetFocusBehavior(FocusBehavior::ALWAYS);
    views::InstallRoundRectHighlightPathGenerator(
        this, gfx::Insets::VH(1, kSideInset), kHoverRadius);
    Refresh();
  }

  uint32_t id() const { return id_; }

  gfx::Size CalculatePreferredSize(const views::SizeBounds&) const override {
    return {kPopoverWidth, kRowHeight};
  }

  void Layout(PassKey) override {
    if (action_) {
      action_->SetBounds(width() - kSideInset - 8 - kActionSize,
                         (height() - kActionSize) / 2, kActionSize,
                         kActionSize);
    }
  }

  void StateChanged(ButtonState old_state) override {
    views::Button::StateChanged(old_state);
    SchedulePaint();
    if (action_) {
      action_->SchedulePaint();
    }
  }

  void OnMouseExited(const ui::MouseEvent& event) override {
    views::Button::OnMouseExited(event);
    if (action_) {
      action_->SchedulePaint();
    }
  }

  // Called when the download changes.
  void Refresh() {
    download::DownloadItem* item = FindItem(profile_, id_);
    if (!item) {
      return;
    }
    const std::string state = MerlinDownloadState(item);
    std::optional<RowAction::Kind> kind;
    std::u16string name;
    if (state == "progress" || state == "paused") {
      kind = RowAction::Kind::kCancel;
      name = u"Cancel download";
    } else if (state == "done") {
      kind = RowAction::Kind::kShow;
      name = u"Show in Finder";
    } else if (state == "failed" && item->CanResume()) {
      kind = RowAction::Kind::kRetry;
      name = u"Try again";
    }
    if (kind != action_kind_) {
      action_kind_ = kind;
      if (action_) {
        RemoveChildViewT(action_.ExtractAsDangling());
      }
      if (kind) {
        action_ = AddChildView(std::make_unique<RowAction>(
            *kind, name,
            base::BindRepeating(&DownloadRow::RunAction,
                                base::Unretained(this))));
      }
      InvalidateLayout();
    }
    const std::u16string file = item->GetFileNameToReportUser().LossyDisplayName();
    GetViewAccessibility().SetName(
        file + u", " + base::UTF8ToUTF16(MerlinDownloadShortDetail(item)));
    SetTooltipText(file);
    if (state == "done" && icon_.IsEmpty() && !icon_requested_) {
      LoadIcon(item->GetTargetFilePath());
    }
    SchedulePaint();
  }

  void PaintButtonContents(gfx::Canvas* canvas) override {
    download::DownloadItem* item = FindItem(profile_, id_);
    if (!item) {
      return;
    }
    const style::Ink ink = PopoverInk(this);
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    if (GetState() == STATE_HOVERED || GetState() == STATE_PRESSED ||
        HasFocus()) {
      gfx::RectF hover(GetLocalBounds());
      hover.Inset(gfx::InsetsF::VH(1, kSideInset));
      flags.setColor(GetState() == STATE_PRESSED ? ink.pressed : ink.hover);
      canvas->DrawRoundRect(hover, kHoverRadius, flags);
    }

    const std::string state = MerlinDownloadState(item);
    const gfx::RectF icon(kSideInset + 10, (height() - kIconSize) / 2.f,
                          kIconSize, kIconSize);
    if (state == "progress" || state == "paused") {
      const int percent = item->PercentComplete();
      PaintRing(canvas, icon, percent < 0 ? 0.08f : percent / 100.f,
                SkColorSetA(ink.text, 0x30),
                state == "paused" ? ink.text_dim : ink.text);
      flags.setColor(ink.text_dim);
      flags.setStyle(cc::PaintFlags::kFill_Style);
      const gfx::PointF c = icon.CenterPoint();
      if (state == "paused") {
        canvas->DrawRect(gfx::RectF(c.x() - 3, c.y() - 3.5f, 2, 7), flags);
        canvas->DrawRect(gfx::RectF(c.x() + 1, c.y() - 3.5f, 2, 7), flags);
      } else {
        // A small arrow in the ring, as on the toolbar button.
        flags.setStyle(cc::PaintFlags::kStroke_Style);
        flags.setStrokeWidth(1.5f);
        flags.setStrokeCap(cc::PaintFlags::kRound_Cap);
        flags.setStrokeJoin(cc::PaintFlags::kRound_Join);
        SkPathBuilder arrow;
        arrow.moveTo(c.x(), c.y() - 4).lineTo(c.x(), c.y() + 3.5f);
        arrow.moveTo(c.x() - 3, c.y() + 0.5f)
            .lineTo(c.x(), c.y() + 3.5f)
            .lineTo(c.x() + 3, c.y() + 0.5f);
        canvas->DrawPath(arrow.detach(), flags);
      }
    } else if (state == "done" && !icon_.IsEmpty()) {
      canvas->DrawImageInt(*icon_.ToImageSkia(), 0, 0,
                           icon_.ToImageSkia()->width(),
                           icon_.ToImageSkia()->height(), icon.x(), icon.y(),
                           kIconSize, kIconSize, /*filter=*/true);
    } else {
      // A page with a folded corner; a warning in it when something is
      // wrong.
      const bool trouble = state == "failed" || state == "dangerous";
      flags.setStyle(cc::PaintFlags::kStroke_Style);
      flags.setStrokeWidth(1.5f);
      flags.setStrokeJoin(cc::PaintFlags::kRound_Join);
      flags.setColor(trouble ? Color(this, ui::kColorAlertHighSeverity)
                             : ink.text_dim);
      const float l = icon.x() + 6, t = icon.y() + 3, r = icon.right() - 6,
                  b = icon.bottom() - 3;
      SkPathBuilder page;
      page.moveTo(l, t).lineTo(r - 5, t).lineTo(r, t + 5).lineTo(r, b).lineTo(
          l, b);
      page.close();
      page.moveTo(r - 5, t).lineTo(r - 5, t + 5).lineTo(r, t + 5);
      canvas->DrawPath(page.detach(), flags);
      if (trouble) {
        flags.setStyle(cc::PaintFlags::kFill_Style);
        const float cx = (l + r) / 2;
        canvas->DrawRect(gfx::RectF(cx - 0.75f, t + 7, 1.5f, 6), flags);
        canvas->DrawCircle(gfx::PointF(cx, t + 15.5f), 1, flags);
      }
    }

    const int text_x = static_cast<int>(icon.right()) + 12;
    const int text_right =
        width() - kSideInset - 8 - (action_ ? kActionSize + 8 : 0);
    const int text_width = std::max(0, text_right - text_x);
    const gfx::FontList& name_font =
        style::UiFont(0, gfx::Font::Weight::MEDIUM);
    const gfx::FontList& detail_font = style::UiFont(-1);
    const std::u16string name = gfx::ElideFilename(
        item->GetFileNameToReportUser(), name_font, text_width);
    const int name_h = name_font.GetHeight();
    const int detail_h = detail_font.GetHeight();
    const int top = (height() - name_h - detail_h - 2) / 2;
    canvas->DrawStringRect(name, name_font,
                           state == "cancelled" || state == "removed"
                               ? ink.text_dim
                               : ink.text,
                           gfx::Rect(text_x, top, text_width, name_h));
    canvas->DrawStringRect(
        base::UTF8ToUTF16(MerlinDownloadShortDetail(item)), detail_font,
        state == "failed" ? Color(this, ui::kColorAlertHighSeverity)
                          : ink.text_dim,
        gfx::Rect(text_x, top + name_h + 2, text_width, detail_h));
  }

 private:
  void LoadIcon(const base::FilePath& path) {
    icon_requested_ = true;
    IconManager* icons = g_browser_process->icon_manager();
    if (!icons || path.empty()) {
      return;
    }
    // Sharp on Retina screens; scaled down elsewhere.
    constexpr float scale = 2.f;
    if (gfx::Image* cached =
            icons->LookupIconFromFilepath(path, IconLoader::NORMAL, scale)) {
      icon_ = *cached;
      return;
    }
    icons->LoadIcon(path, IconLoader::NORMAL, scale,
                    base::BindOnce(&DownloadRow::OnIcon,
                                   weak_factory_.GetWeakPtr()),
                    &icon_tracker_);
  }

  void OnIcon(gfx::Image image) {
    icon_ = std::move(image);
    SchedulePaint();
  }

  void Activate() {
    download::DownloadItem* item = FindItem(profile_, id_);
    if (!item) {
      return;
    }
    const std::string state = MerlinDownloadState(item);
    if (state == "done") {
      item->OpenDownload();
      close_.Run();
    } else if (state == "dangerous") {
      // The Downloads page explains the risk and asks.
      show_all_.Run();
      close_.Run();
    } else if (state == "failed" && item->CanResume()) {
      item->Resume(/*user_resume=*/true);
    }
  }

  void RunAction() {
    if (!action_kind_) {
      return;
    }
    switch (*action_kind_) {
      case RowAction::Kind::kCancel:
        RunMerlinDownloadAction(profile_, "download-cancel", id_);
        break;
      case RowAction::Kind::kShow:
        RunMerlinDownloadAction(profile_, "download-show", id_);
        break;
      case RowAction::Kind::kRetry:
        RunMerlinDownloadAction(profile_, "download-retry", id_);
        break;
    }
  }

  const raw_ptr<Profile> profile_;
  const uint32_t id_;
  base::RepeatingClosure show_all_;
  base::RepeatingClosure close_;
  std::optional<RowAction::Kind> action_kind_;
  raw_ptr<RowAction> action_ = nullptr;
  gfx::Image icon_;
  bool icon_requested_ = false;
  base::CancelableTaskTracker icon_tracker_;
  base::WeakPtrFactory<DownloadRow> weak_factory_{this};
};

BEGIN_METADATA(DownloadRow)
END_METADATA

// The header's Clear pill and the footer's "View all downloads ↗".
class TextButton : public views::Button {
  METADATA_HEADER(TextButton, views::Button)

 public:
  enum class Kind { kPill, kRow };

  TextButton(Kind kind, std::u16string text, PressedCallback callback)
      : views::Button(std::move(callback)), kind_(kind), text_(text) {
    SetAccessibleName(text);
    SetFocusBehavior(FocusBehavior::ALWAYS);
    if (kind == Kind::kPill) {
      views::InstallPillHighlightPathGenerator(this);
    } else {
      views::InstallRoundRectHighlightPathGenerator(
          this, gfx::Insets::VH(2, kSideInset), kHoverRadius);
    }
  }

  gfx::Size CalculatePreferredSize(const views::SizeBounds&) const override {
    if (kind_ == Kind::kPill) {
      return {gfx::GetStringWidth(text_, style::UiFont(-1)) + 20, 22};
    }
    return {kPopoverWidth, kFooterHeight};
  }

  void StateChanged(ButtonState old_state) override {
    views::Button::StateChanged(old_state);
    SchedulePaint();
  }

  void PaintButtonContents(gfx::Canvas* canvas) override {
    const style::Ink ink = PopoverInk(this);
    const bool hot = GetState() == STATE_HOVERED ||
                     GetState() == STATE_PRESSED || HasFocus();
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    if (kind_ == Kind::kPill) {
      flags.setColor(hot ? ink.pressed : ink.hover);
      const gfx::RectF r(GetLocalBounds());
      canvas->DrawRoundRect(r, r.height() / 2, flags);
      canvas->DrawStringRectWithFlags(text_, style::UiFont(-1), ink.text,
                                      GetLocalBounds(),
                                      gfx::Canvas::TEXT_ALIGN_CENTER);
      return;
    }
    if (hot) {
      gfx::RectF r(GetLocalBounds());
      r.Inset(gfx::InsetsF::VH(2, kSideInset));
      flags.setColor(GetState() == STATE_PRESSED ? ink.pressed : ink.hover);
      canvas->DrawRoundRect(r, kHoverRadius, flags);
    }
    const gfx::FontList& font = style::UiFont();
    const int x = kSideInset + 10;
    const int w = gfx::GetStringWidth(text_, font);
    canvas->DrawStringRect(text_, font, ink.text,
                           gfx::Rect(x, 0, w + 2, height()));
    // ↗
    flags.setStyle(cc::PaintFlags::kStroke_Style);
    flags.setStrokeWidth(1.4f);
    flags.setStrokeCap(cc::PaintFlags::kRound_Cap);
    flags.setStrokeJoin(cc::PaintFlags::kRound_Join);
    flags.setColor(ink.text_dim);
    const float ax = x + w + 8.f, ay = height() / 2.f;
    SkPathBuilder arrow;
    arrow.moveTo(ax, ay + 3.5f).lineTo(ax + 7, ay - 3.5f);
    arrow.moveTo(ax + 2, ay - 3.5f).lineTo(ax + 7, ay - 3.5f).lineTo(
        ax + 7, ay + 1.5f);
    canvas->DrawPath(arrow.detach(), flags);
  }

 private:
  const Kind kind_;
  const std::u16string text_;
};

BEGIN_METADATA(TextButton)
END_METADATA

// The "RECENT DOWNLOADS" header and its Clear pill.
class Header : public views::View {
  METADATA_HEADER(Header, views::View)

 public:
  explicit Header(views::Button::PressedCallback clear) {
    clear_ = AddChildView(std::make_unique<TextButton>(
        TextButton::Kind::kPill, u"Clear", std::move(clear)));
  }

  gfx::Size CalculatePreferredSize(const views::SizeBounds&) const override {
    return {kPopoverWidth, kHeaderHeight};
  }

  void Layout(PassKey) override {
    const gfx::Size pill = clear_->GetPreferredSize();
    clear_->SetBounds(width() - kSideInset - 6 - pill.width(),
                      (height() - pill.height()) / 2 + 2, pill.width(),
                      pill.height());
  }

  void OnPaint(gfx::Canvas* canvas) override {
    canvas->DrawStringRect(
        u"RECENT DOWNLOADS",
        style::UiFont(-2, gfx::Font::Weight::SEMIBOLD),
        PopoverInk(this).text_dim,
        gfx::Rect(kSideInset + 10, 2, width() / 2, height()));
  }

 private:
  raw_ptr<views::Button> clear_;
};

BEGIN_METADATA(Header)
END_METADATA

class Hairline : public views::View {
  METADATA_HEADER(Hairline, views::View)

 public:
  gfx::Size CalculatePreferredSize(const views::SizeBounds&) const override {
    return {kPopoverWidth, 9};
  }
  void OnPaint(gfx::Canvas* canvas) override {
    canvas->FillRect(gfx::Rect(kSideInset + 6, 4, width() - 2 * kSideInset - 12, 1),
                     SkColorSetA(PopoverInk(this).text, 0x1F));
  }
};

BEGIN_METADATA(Hairline)
END_METADATA

// The pop-up's contents; the bubble around it is Merlin's restyled one.
class DownloadsPopover : public views::View,
                         public download::AllDownloadItemNotifier::Observer {
  METADATA_HEADER(DownloadsPopover, views::View)

 public:
  DownloadsPopover(Profile* profile, base::RepeatingClosure show_all)
      : profile_(profile), show_all_(std::move(show_all)) {
    SetLayoutManager(std::make_unique<views::BoxLayout>(
        views::BoxLayout::Orientation::kVertical));
    if (content::DownloadManager* manager = profile->GetDownloadManager()) {
      notifier_ =
          std::make_unique<download::AllDownloadItemNotifier>(manager, this);
    }
    Rebuild();
  }

  // download::AllDownloadItemNotifier::Observer:
  void OnDownloadCreated(content::DownloadManager*,
                         download::DownloadItem*) override {
    Rebuild();
  }
  void OnDownloadRemoved(content::DownloadManager*,
                         download::DownloadItem*) override {
    Rebuild();
  }
  void OnDownloadUpdated(content::DownloadManager*,
                         download::DownloadItem* item) override {
    for (DownloadRow* row : rows_) {
      if (row->id() == item->GetId()) {
        row->Refresh();
        return;
      }
    }
    // A new download is listed once it has a name.
    const std::vector<download::DownloadItem*> recent =
        MerlinDownloadsButton::Recent(profile_);
    if (std::ranges::find(recent, item) != recent.end()) {
      Rebuild();
    }
  }

 private:
  void Close() {
    if (GetWidget()) {
      GetWidget()->Close();
    }
  }

  void Rebuild() {
    rows_.clear();
    RemoveAllChildViews();
    AddChildView(std::make_unique<Header>(base::BindRepeating(
        [](DownloadsPopover* self) {
          ClearRecent(self->profile_);
          self->Close();
        },
        base::Unretained(this))));
    const std::vector<download::DownloadItem*> recent =
        MerlinDownloadsButton::Recent(profile_);
    for (size_t i = 0; i < recent.size() && i < kMaxRows; ++i) {
      rows_.push_back(AddChildView(std::make_unique<DownloadRow>(
          profile_, recent[i]->GetId(), show_all_,
          base::BindRepeating(&DownloadsPopover::Close,
                              base::Unretained(this)))));
    }
    AddChildView(std::make_unique<Hairline>());
    AddChildView(std::make_unique<TextButton>(
        TextButton::Kind::kRow, u"View all downloads",
        base::BindRepeating(
            [](DownloadsPopover* self) {
              self->show_all_.Run();
              self->Close();
            },
            base::Unretained(this))));
    if (GetWidget() && GetWidget()->widget_delegate() &&
        GetWidget()->widget_delegate()->AsBubbleDialogDelegate()) {
      GetWidget()->widget_delegate()->AsBubbleDialogDelegate()->SizeToContents();
    }
  }

  static void ClearRecent(Profile* profile) {
    MerlinDownloadsButton::ClearRecent(profile);
  }

  const raw_ptr<Profile> profile_;
  base::RepeatingClosure show_all_;
  std::vector<raw_ptr<DownloadRow>> rows_;
  std::unique_ptr<download::AllDownloadItemNotifier> notifier_;
};

BEGIN_METADATA(DownloadsPopover)
END_METADATA

}  // namespace

MerlinDownloadsButton::MerlinDownloadsButton(BrowserWindowInterface* browser,
                                             base::RepeatingClosure show_all)
    : views::Button(base::BindRepeating(&MerlinDownloadsButton::Pressed,
                                        base::Unretained(this))),
      browser_(browser),
      show_all_(std::move(show_all)) {
  SetFocusBehavior(FocusBehavior::ALWAYS);
  SetInstallFocusRingOnFocus(true);
  views::InstallRoundRectHighlightPathGenerator(this, gfx::Insets(), 6);
  SetAccessibleName(u"Downloads");
  SetTooltipText(u"Downloads");
  Profile* profile = browser_->GetProfile();
  // This button and its pop-up stand in for Chromium's download bubble,
  // which would otherwise open by itself on each download.
  profile->GetPrefs()->SetBoolean(prefs::kDownloadBubblePartialViewEnabled,
                                  false);
  if (content::DownloadManager* manager = profile->GetDownloadManager()) {
    notifier_ =
        std::make_unique<download::AllDownloadItemNotifier>(manager, this);
  }
  Update();
}

MerlinDownloadsButton::~MerlinDownloadsButton() {
  if (views::View* popover = popover_.view();
      popover && popover->GetWidget()) {
    popover->GetWidget()->CloseNow();
  }
}

// static
std::vector<download::DownloadItem*> MerlinDownloadsButton::Recent(
    Profile* profile) {
  const base::Time since =
      std::max(base::Time::Now() - kRecentFor, ClearedTime(profile));
  std::vector<download::DownloadItem*> out;
  for (download::DownloadItem* item : MerlinDownloads(profile)) {
    if (Running(item) || item->GetStartTime() >= since) {
      out.push_back(item);
    }
  }
  return out;
}

// static
void MerlinDownloadsButton::ClearRecent(Profile* profile) {
  auto data = std::make_unique<ClearedAt>();
  data->time = base::Time::Now();
  profile->SetUserData(kClearedAtKey, std::move(data));
  // Every window's button hears of it through a download's observers.
  std::vector<download::DownloadItem*> all = MerlinDownloads(profile);
  if (!all.empty()) {
    all.front()->UpdateObservers();
  }
}

void MerlinDownloadsButton::SetSurface(std::optional<SkColor> surface) {
  surface_ = surface;
  SchedulePaint();
}

void MerlinDownloadsButton::Update() {
  const std::vector<download::DownloadItem*> recent =
      Recent(browser_->GetProfile());
  int64_t received = 0;
  int64_t total = 0;
  bool running = false;
  for (download::DownloadItem* item : recent) {
    if (MerlinDownloadState(item) != "progress") {
      continue;
    }
    running = true;
    received += item->GetReceivedBytes();
    total += std::max<int64_t>(item->GetTotalBytes(), item->GetReceivedBytes());
  }
  std::optional<double> progress;
  if (running) {
    progress = total > 0 ? static_cast<double>(received) / total : 0.0;
  }
  if (progress != progress_) {
    progress_ = progress;
    SchedulePaint();
  }
  const bool show = !recent.empty();
  if (GetVisible() != show) {
    SetVisible(show);
  }
  std::u16string name = u"Downloads";
  if (progress_) {
    name += u", " +
            base::UTF8ToUTF16(MerlinDownloadsStatus(browser_->GetProfile()));
  }
  GetViewAccessibility().SetName(name);
}

views::Widget* MerlinDownloadsButton::popover_for_testing() {
  return popover_.view() ? popover_.view()->GetWidget() : nullptr;
}

gfx::Size MerlinDownloadsButton::CalculatePreferredSize(
    const views::SizeBounds&) const {
  return {kButtonSize, kButtonSize};
}

void MerlinDownloadsButton::StateChanged(ButtonState old_state) {
  views::Button::StateChanged(old_state);
  SchedulePaint();
}

void MerlinDownloadsButton::PaintButtonContents(gfx::Canvas* canvas) {
  const style::Ink ink = style::InkOn(
      style::PageSurface(this, surface_)
          .value_or(GetColorProvider()->GetColor(kColorToolbar)));
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  if (GetState() == STATE_HOVERED || GetState() == STATE_PRESSED ||
      (popover_.view() && popover_.view()->GetWidget() &&
       popover_.view()->GetWidget()->IsVisible())) {
    flags.setColor(GetState() == STATE_PRESSED ? ink.pressed : ink.hover);
    canvas->DrawRoundRect(gfx::RectF(GetLocalBounds()), 6, flags);
  }
  const float cx = width() / 2.f;
  // ↓ over the pill.
  flags.setStyle(cc::PaintFlags::kStroke_Style);
  flags.setStrokeWidth(1.6f);
  flags.setStrokeCap(cc::PaintFlags::kRound_Cap);
  flags.setStrokeJoin(cc::PaintFlags::kRound_Join);
  flags.setColor(ink.icon);
  SkPathBuilder arrow;
  arrow.moveTo(cx, 7.5f).lineTo(cx, 17.5f);
  arrow.moveTo(cx - 4.5f, 13).lineTo(cx, 17.5f).lineTo(cx + 4.5f, 13);
  canvas->DrawPath(arrow.detach(), flags);

  flags.setStyle(cc::PaintFlags::kFill_Style);
  const gfx::RectF pill(cx - 7, 21, 14, 3);
  flags.setColor(SkColorSetA(ink.icon, progress_ ? 0x45 : 0x60));
  canvas->DrawRoundRect(pill, 1.5f, flags);
  if (progress_ && *progress_ > 0) {
    gfx::RectF done = pill;
    done.set_width(std::max(3.f, pill.width() * static_cast<float>(
                                                    std::min(*progress_, 1.0))));
    flags.setColor(ink.icon);
    canvas->DrawRoundRect(done, 1.5f, flags);
  }
}

void MerlinDownloadsButton::OnDownloadCreated(content::DownloadManager*,
                                              download::DownloadItem*) {
  Update();
}

void MerlinDownloadsButton::OnDownloadUpdated(content::DownloadManager*,
                                              download::DownloadItem*) {
  Update();
}

void MerlinDownloadsButton::OnDownloadRemoved(content::DownloadManager*,
                                              download::DownloadItem*) {
  Update();
}

void MerlinDownloadsButton::Pressed() {
  if (views::View* open = popover_.view();
      open && open->GetWidget() && !open->GetWidget()->IsClosed()) {
    open->GetWidget()->Close();
    return;
  }
  auto delegate = std::make_unique<views::BubbleDialogDelegate>(
      this, views::BubbleBorder::TOP_RIGHT);
  delegate->SetButtons(static_cast<int>(ui::mojom::DialogButton::kNone));
  delegate->SetShowCloseButton(false);
  delegate->SetShowTitle(false);
  delegate->set_close_on_deactivate(true);
  delegate->set_margins(gfx::Insets::VH(6, 0));
  delegate->set_fixed_width(kPopoverWidth);
  delegate->SetAccessibleTitle(u"Recent downloads");
  auto contents =
      std::make_unique<DownloadsPopover>(browser_->GetProfile(), show_all_);
  popover_.SetView(contents.get());
  delegate->SetContentsView(std::move(contents));
  views::BubbleDialogDelegate::CreateBubbleDeprecated(
      std::move(delegate), views::Widget::InitParams::NATIVE_WIDGET_OWNS_WIDGET)
      ->Show();
  SchedulePaint();
}

BEGIN_METADATA(MerlinDownloadsButton)
END_METADATA

}  // namespace modal_browser
