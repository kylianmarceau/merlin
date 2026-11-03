// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_safety_controls.h"

#include <algorithm>
#include <utility>

#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "cc/paint/paint_flags.h"
#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_element_identifiers.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/bubble_anchor_util.h"
#include "chrome/browser/ui/color/chrome_color_id.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/browser/ui/page_info/page_info_dialog.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "ui/accessibility/ax_enums.mojom.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/mojom/menu_source_type.mojom.h"
#include "ui/color/color_provider.h"
#include "ui/events/event.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/text_utils.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/controls/button/button.h"
#include "ui/views/controls/highlight_path_generator.h"
#include "ui/views/controls/menu/menu_runner.h"
#include "ui/views/view_class_properties.h"
#include "url/origin.h"

namespace modal_browser {
namespace {

// Text, not colour alone, identifies recording and private browsing. These
// controls cannot be flexed away when the address field needs more room.
class SafetyButton : public views::Button {
  METADATA_HEADER(SafetyButton, views::Button)

 public:
  SafetyButton(PressedCallback callback, bool site)
      : views::Button(std::move(callback)), site_(site) {
    SetFocusBehavior(FocusBehavior::ALWAYS);
    SetInstallFocusRingOnFocus(true);
    views::InstallRoundRectHighlightPathGenerator(this, gfx::Insets(), 6);
  }

  void SetText(std::u16string text) {
    if (text_ != text) {
      text_ = std::move(text);
      PreferredSizeChanged();
      SchedulePaint();
    }
  }
  void SetSurface(std::optional<SkColor> surface) {
    surface_ = surface;
    SchedulePaint();
  }
  gfx::Size CalculatePreferredSize(const views::SizeBounds&) const override {
    return gfx::Size(
        site_ ? 30 : 32 + gfx::GetStringWidth(text_, style::UiFont(-1)), 30);
  }
  void StateChanged(ButtonState old_state) override {
    views::Button::StateChanged(old_state);
    SchedulePaint();
  }
  void PaintButtonContents(gfx::Canvas* canvas) override {
    const SkColor background =
        style::PageSurface(this, surface_)
            .value_or(GetColorProvider()->GetColor(kColorToolbar));
    const auto ink = style::InkOn(background);
    if (GetState() == STATE_HOVERED || GetState() == STATE_PRESSED) {
      cc::PaintFlags fill;
      fill.setAntiAlias(true);
      fill.setColor(GetState() == STATE_PRESSED ? ink.pressed : ink.hover);
      canvas->DrawRoundRect(gfx::RectF(GetLocalBounds()), 6, fill);
    }
    cc::PaintFlags stroke;
    stroke.setAntiAlias(true);
    stroke.setStyle(cc::PaintFlags::kStroke_Style);
    stroke.setStrokeWidth(1.5f);
    stroke.setColor(ink.icon);
    if (site_) {
      // Sliders, rather than a lock suggesting that a site is trustworthy.
      canvas->DrawLine(gfx::PointF(8, 11), gfx::PointF(22, 11), stroke);
      canvas->DrawLine(gfx::PointF(8, 19), gfx::PointF(22, 19), stroke);
      cc::PaintFlags fill = stroke;
      fill.setStyle(cc::PaintFlags::kFill_Style);
      fill.setColor(background);
      for (const gfx::PointF p : {gfx::PointF(12, 11), gfx::PointF(18, 19)}) {
        canvas->DrawCircle(p, 3, fill);
        canvas->DrawCircle(p, 3, stroke);
      }
    } else {
      // A ring stays visible even on a page whose colour matches the dot.
      canvas->DrawCircle({12, 15}, 5, stroke);
      stroke.setStyle(cc::PaintFlags::kFill_Style);
      stroke.setColor(style::ColorsFor(this).error);
      canvas->DrawCircle({12, 15}, 3, stroke);
      canvas->DrawStringRect(text_, style::UiFont(-1), ink.text,
                             gfx::Rect(24, 0, width() - 28, height()));
    }
  }

 private:
  const bool site_;
  std::u16string text_;
  std::optional<SkColor> surface_;
};
BEGIN_METADATA(SafetyButton)
END_METADATA

class PrivateBadge : public views::View {
  METADATA_HEADER(PrivateBadge, views::View)
 public:
  PrivateBadge() {
    SetPreferredSize(gfx::Size(58, 30));
    GetViewAccessibility().SetRole(ax::mojom::Role::kStaticText);
    GetViewAccessibility().SetName(u"Private browsing");
    SetTooltipText(u"Private browsing");
  }
  void SetSurface(std::optional<SkColor> surface) {
    surface_ = surface;
    SchedulePaint();
  }
  void OnPaint(gfx::Canvas* canvas) override {
    const auto ink = style::InkOn(
        style::PageSurface(this, surface_)
            .value_or(GetColorProvider()->GetColor(kColorToolbar)));
    canvas->DrawStringRectWithFlags(
        u"Private", style::UiFont(-1, gfx::Font::Weight::MEDIUM), ink.text,
        GetLocalBounds(), gfx::Canvas::TEXT_ALIGN_CENTER);
  }

 private:
  std::optional<SkColor> surface_;
};
BEGIN_METADATA(PrivateBadge)
END_METADATA

}  // namespace

MerlinSafetyControls::MerlinSafetyControls(
    BrowserWindowInterface* browser,
    base::RepeatingClosure show_site_info)
    : browser_(browser),
      indicator_(MediaCaptureDevicesDispatcher::GetInstance()
                     ->GetMediaStreamCaptureIndicator()) {
  SetOrientation(views::BoxLayout::Orientation::kHorizontal);
  SetCrossAxisAlignment(views::BoxLayout::CrossAxisAlignment::kCenter);
  SetBetweenChildSpacing(4);
  site_button_ = AddChildView(std::make_unique<SafetyButton>(
      base::BindRepeating(
          [](base::RepeatingClosure show, const ui::Event&) { show.Run(); },
          std::move(show_site_info)),
      true));
  site_button_->SetProperty(views::kElementIdentifierKey,
                            kLocationIconElementId);
  site_button_->GetViewAccessibility().SetName(u"Site controls");
  capture_button_ = AddChildView(std::make_unique<SafetyButton>(
      base::BindRepeating(&MerlinSafetyControls::ShowCaptureMenu,
                          base::Unretained(this)),
      false));
  private_badge_ = AddChildView(std::make_unique<PrivateBadge>());
  private_badge_->SetVisible(browser_->GetProfile()->IsOffTheRecord());
  browser_->GetTabStripModel()->AddObserver(this);
  observation_.Observe(indicator_.get());
  Update();
}

MerlinSafetyControls::~MerlinSafetyControls() {
  browser_->GetTabStripModel()->RemoveObserver(this);
}

std::vector<MerlinSafetyControls::Capture> MerlinSafetyControls::Captures()
    const {
  std::vector<Capture> out;
  TabStripModel* model = browser_->GetTabStripModel();
  for (int i = 0; i < model->count(); ++i) {
    auto* tab = model->GetTabAtIndex(i);
    auto* contents = tab->GetContents();
    const bool audio = indicator_->IsCapturingAudio(contents);
    const bool video = indicator_->IsCapturingVideo(contents);
    const bool sharing = indicator_->IsBeingMirrored(contents) ||
                         indicator_->IsCapturingTab(contents) ||
                         indicator_->IsCapturingWindow(contents) ||
                         indicator_->IsCapturingDisplay(contents);
    if (!audio && !video && !sharing)
      continue;
    std::u16string use;
    if (audio)
      use = u"Microphone";
    if (video)
      use += (use.empty() ? u"" : u", ") + std::u16string(u"Camera");
    if (sharing)
      use += (use.empty() ? u"" : u", ") +
             std::u16string(u"Screen or tab sharing");
    const auto origin = base::UTF8ToUTF16(
        url::Origin::Create(contents->GetLastCommittedURL()).Serialize());
    out.push_back({tab->GetHandle(),
                   contents->GetPrimaryMainFrame()->GetWeakDocumentPtr(),
                   origin + u" — " + use, sharing});
  }
  return out;
}

void MerlinSafetyControls::UpdateSiteInfo() {
  auto* contents = browser_->GetTabStripModel()->GetActiveWebContents();
  const bool web = contents && contents->GetVisibleURL().SchemeIsHTTPOrHTTPS();
  site_button_->SetVisible(web);
  const std::u16string site =
      web ? u"Site controls for " +
                base::UTF8ToUTF16(
                    url::Origin::Create(contents->GetVisibleURL()).Serialize())
          : u"Site controls";
  site_button_->SetTooltipText(site);
  site_button_->GetViewAccessibility().SetName(site);
}

void MerlinSafetyControls::Update() {
  UpdateSiteInfo();
  const auto captures = Captures();
  capture_button_->SetVisible(!captures.empty());
  const bool sharing = std::ranges::any_of(captures, &Capture::sharing);
  const auto text = (sharing ? u"Sharing · " : u"Recording · ") +
                    base::NumberToString16(captures.size());
  static_cast<SafetyButton*>(capture_button_.get())->SetText(text);
  std::u16string description = text;
  for (const auto& capture : captures)
    description += u"\n" + capture.description;
  capture_button_->SetTooltipText(description);
  capture_button_->GetViewAccessibility().SetName(description +
                                                  u". View or stop capture");
}

void MerlinSafetyControls::SetSurface(std::optional<SkColor> surface) {
  static_cast<SafetyButton*>(site_button_.get())->SetSurface(surface);
  static_cast<SafetyButton*>(capture_button_.get())->SetSurface(surface);
  static_cast<PrivateBadge*>(private_badge_.get())->SetSurface(surface);
}

void MerlinSafetyControls::BuildCaptureMenu() {
  menu_runner_.reset();
  menu_captures_ = Captures();
  menu_model_ = std::make_unique<ui::SimpleMenuModel>(this);
  for (size_t i = 0; i < menu_captures_.size(); ++i) {
    if (i)
      menu_model_->AddSeparator(ui::NORMAL_SEPARATOR);
    menu_model_->AddItem(static_cast<int>(2 * i),
                         menu_captures_[i].description + u" — View tab");
    menu_model_->AddItem(static_cast<int>(2 * i + 1),
                         u"Stop capture for this tab");
  }
}

ui::SimpleMenuModel* MerlinSafetyControls::BuildCaptureMenuForTesting() {
  BuildCaptureMenu();
  return menu_model_.get();
}

content::WebContents* MerlinSafetyControls::MenuContents(int command_id) const {
  if (command_id < 0 ||
      static_cast<size_t>(command_id / 2) >= menu_captures_.size())
    return nullptr;
  auto* tab = menu_captures_[command_id / 2].tab.Get();
  return tab &&
                 browser_->GetTabStripModel()->GetIndexOfTab(tab) !=
                     TabStripModel::kNoTab &&
                 menu_captures_[command_id / 2]
                         .document.AsRenderFrameHostIfValid() ==
                     tab->GetContents()->GetPrimaryMainFrame()
             ? tab->GetContents()
             : nullptr;
}

bool MerlinSafetyControls::IsCommandIdEnabled(int command_id) const {
  auto* contents = MenuContents(command_id);
  return contents && (indicator_->IsCapturingUserMedia(contents) ||
                      indicator_->IsBeingMirrored(contents) ||
                      indicator_->IsCapturingTab(contents) ||
                      indicator_->IsCapturingWindow(contents) ||
                      indicator_->IsCapturingDisplay(contents));
}

void MerlinSafetyControls::ExecuteCommand(int command_id, int event_flags) {
  if (!IsCommandIdEnabled(command_id))
    return;
  auto* contents = MenuContents(command_id);
  if (command_id % 2) {
    indicator_->StopMediaCapturing(
        contents, MediaStreamCaptureIndicator::kUserMedia |
                      MediaStreamCaptureIndicator::kDisplayMedia);
  } else {
    auto* tab = tabs::TabInterface::MaybeGetFromContents(contents);
    browser_->GetTabStripModel()->ActivateTab(
        tab, TabStripUserGestureDetails(
                 TabStripUserGestureDetails::GestureType::kOther));
    ShowPageInfoDialog(contents, base::DoNothing(),
                       bubble_anchor_util::Anchor::kLocationBar);
  }
}

void MerlinSafetyControls::ShowCaptureMenu(const ui::Event& event) {
  BuildCaptureMenu();
  if (menu_captures_.empty())
    return;
  menu_runner_ = std::make_unique<views::MenuRunner>(
      menu_model_.get(), views::MenuRunner::HAS_MNEMONICS);
  menu_runner_->RunMenuAt(
      GetWidget(), nullptr, capture_button_->GetBoundsInScreen(),
      views::MenuAnchorPosition::kTopRight,
      event.IsKeyEvent() ? ui::mojom::MenuSourceType::kKeyboard
                         : ui::mojom::MenuSourceType::kMouse);
}

void MerlinSafetyControls::OnTabStripModelChanged(
    TabStripModel*,
    const TabStripModelChange&,
    const TabStripSelectionChange&) {
  Update();
}
void MerlinSafetyControls::OnTabChangedAt(tabs::TabInterface*, TabChangeType) {
  Update();
}
void MerlinSafetyControls::OnIsCapturingVideoChanged(content::WebContents*,
                                                     bool) {
  Update();
}
void MerlinSafetyControls::OnIsCapturingAudioChanged(content::WebContents*,
                                                     bool) {
  Update();
}
void MerlinSafetyControls::OnIsBeingMirroredChanged(content::WebContents*,
                                                    bool) {
  Update();
}
void MerlinSafetyControls::OnIsCapturingTabChanged(content::WebContents*,
                                                   bool) {
  Update();
}
void MerlinSafetyControls::OnIsCapturingWindowChanged(content::WebContents*,
                                                      bool) {
  Update();
}
void MerlinSafetyControls::OnIsCapturingDisplayChanged(content::WebContents*,
                                                       bool) {
  Update();
}

BEGIN_METADATA(MerlinSafetyControls)
END_METADATA

}  // namespace modal_browser
