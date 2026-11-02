#include "chrome/browser/ui/modal_browser/merlin_adblock_button.h"

#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "cc/paint/paint_flags.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/color/chrome_color_id.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/merlin_adblock/common/features.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "third_party/skia/include/core/SkPathBuilder.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/mojom/menu_source_type.mojom.h"
#include "ui/color/color_provider.h"
#include "ui/events/event.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/text_utils.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/controls/highlight_path_generator.h"
#include "ui/views/controls/menu/menu_runner.h"
#include "ui/views/widget/widget.h"

namespace modal_browser {
namespace {
enum { kCount, kToggle, kReload, kSettings };
}
MerlinAdblockButton::MerlinAdblockButton(BrowserWindowInterface* browser,
                                         base::RepeatingClosure settings)
    : views::Button(base::BindRepeating(&MerlinAdblockButton::Pressed,
                                        base::Unretained(this))),
      browser_(browser),
      settings_(std::move(settings)) {
  SetFocusBehavior(FocusBehavior::ALWAYS);
  SetInstallFocusRingOnFocus(true);
  views::InstallRoundRectHighlightPathGenerator(this, gfx::Insets(), 6);
  if (base::FeatureList::IsEnabled(merlin_adblock::kMerlinAdblock)) {
    timer_.Start(FROM_HERE, base::Milliseconds(500),
                 base::BindRepeating(&MerlinAdblockButton::Update,
                                     base::Unretained(this)));
  }
  Update();
}
MerlinAdblockButton::~MerlinAdblockButton() = default;
void MerlinAdblockButton::SetSurface(std::optional<SkColor> surface) {
  surface_ = surface;
  SchedulePaint();
}
void MerlinAdblockButton::Update() {
  auto* contents = browser_->GetTabStripModel()->GetActiveWebContents();
  const bool show =
      base::FeatureList::IsEnabled(merlin_adblock::kMerlinAdblock) &&
      contents && contents->GetLastCommittedURL().SchemeIsHTTPOrHTTPS();
  SetVisible(show);
  if (!show)
    return;
  auto* service = merlin_adblock::Service::Get(browser_->GetProfile());
  const unsigned count = service->Blocked(contents->GetPrimaryMainFrame());
  const auto next =
      !service->EnabledFor(contents->GetLastCommittedURL())          ? u"Off"
      : service->readiness() == merlin_adblock::Readiness::kDegraded ? u"!"
      : count > 999                                                  ? u"999+"
                    : base::NumberToString16(count);
  if (text_ != next) {
    text_ = next;
    PreferredSizeChanged();
    SchedulePaint();
  }
  const std::u16string description =
      u"Ad blocking: " +
      base::UTF8ToUTF16(service->EnabledFor(contents->GetLastCommittedURL())
                            ? service->Status()
                            : "Off on this site") +
      u", " + base::NumberToString16(count) + u" blocked on this page";
  SetTooltipText(description);
  GetViewAccessibility().SetName(description);
}
gfx::Size MerlinAdblockButton::CalculatePreferredSize(
    const views::SizeBounds&) const {
  return {34 + gfx::GetStringWidth(text_, style::UiFont(-1)), 30};
}
void MerlinAdblockButton::StateChanged(ButtonState old) {
  views::Button::StateChanged(old);
  SchedulePaint();
}
void MerlinAdblockButton::PaintButtonContents(gfx::Canvas* canvas) {
  const auto ink =
      style::InkOn(style::PageSurface(this, surface_)
                       .value_or(GetColorProvider()->GetColor(kColorToolbar)));
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  if (GetState() == STATE_HOVERED || GetState() == STATE_PRESSED) {
    flags.setColor(GetState() == STATE_PRESSED ? ink.pressed : ink.hover);
    canvas->DrawRoundRect(gfx::RectF(GetLocalBounds()), 6, flags);
  }
  flags.setColor(ink.icon);
  flags.setStyle(cc::PaintFlags::kStroke_Style);
  flags.setStrokeWidth(1.5f);
  SkPathBuilder shield;
  shield.moveTo(14, 7);
  shield.lineTo(21, 10);
  shield.lineTo(20, 17);
  shield.quadTo(18, 22, 14, 24);
  shield.quadTo(10, 22, 8, 17);
  shield.lineTo(7, 10);
  shield.close();
  canvas->DrawPath(shield.detach(), flags);
  canvas->DrawStringRect(text_, style::UiFont(-1), ink.text,
                         gfx::Rect(27, 0, width() - 30, height()));
}
content::RenderFrameHost* MerlinAdblockButton::MenuFrame() const {
  auto* frame = menu_document_.AsRenderFrameHostIfValid();
  auto* contents = browser_->GetTabStripModel()->GetActiveWebContents();
  return contents && contents->GetPrimaryMainFrame() == frame ? frame : nullptr;
}
ui::SimpleMenuModel* MerlinAdblockButton::BuildMenuForTesting() {
  runner_.reset();
  menu_document_ = {};
  auto* contents = browser_->GetTabStripModel()->GetActiveWebContents();
  menu_ = std::make_unique<ui::SimpleMenuModel>(this);
  if (!contents || !contents->GetLastCommittedURL().SchemeIsHTTPOrHTTPS())
    return menu_.get();
  menu_document_ = contents->GetPrimaryMainFrame()->GetWeakDocumentPtr();
  auto* service = merlin_adblock::Service::Get(browser_->GetProfile());
  menu_->AddItem(kCount, base::NumberToString16(service->Blocked(
                             contents->GetPrimaryMainFrame())) +
                             u" requests blocked on this page");
  menu_->AddCheckItem(
      kToggle, u"Use protection on " +
                   base::UTF8ToUTF16(contents->GetLastCommittedURL().host()));
  menu_->AddItem(kReload, u"Reload to apply page changes");
  menu_->AddSeparator(ui::NORMAL_SEPARATOR);
  menu_->AddItem(kSettings, u"Ad blocking settings");
  return menu_.get();
}
bool MerlinAdblockButton::IsCommandIdChecked(int command) const {
  auto* frame = MenuFrame();
  return command == kToggle && frame &&
         merlin_adblock::Service::Get(browser_->GetProfile())
             ->EnabledFor(frame->GetLastCommittedURL());
}
bool MerlinAdblockButton::IsCommandIdEnabled(int command) const {
  if (command == kSettings)
    return true;
  if (!MenuFrame() || command == kCount)
    return false;
  return command != kToggle ||
         merlin_adblock::Service::Get(browser_->GetProfile())->readiness() !=
             merlin_adblock::Readiness::kDisabled;
}
void MerlinAdblockButton::ExecuteCommand(int command, int) {
  if (!IsCommandIdEnabled(command))
    return;
  if (command == kSettings) {
    settings_.Run();
    return;
  }
  auto* frame = MenuFrame();
  if (!frame)
    return;
  if (command == kToggle)
    merlin_adblock::Service::Get(browser_->GetProfile())
        ->ToggleSite(frame->GetLastCommittedURL());
  if (command == kReload)
    content::WebContents::FromRenderFrameHost(frame)->GetController().Reload(
        content::ReloadType::NORMAL, true);
  Update();
}
void MerlinAdblockButton::Pressed(const ui::Event& event) {
  BuildMenuForTesting();
  if (!MenuFrame())
    return;
  runner_ = std::make_unique<views::MenuRunner>(
      menu_.get(), views::MenuRunner::HAS_MNEMONICS);
  runner_->RunMenuAt(GetWidget(), nullptr, GetBoundsInScreen(),
                     views::MenuAnchorPosition::kTopRight,
                     event.IsKeyEvent() ? ui::mojom::MenuSourceType::kKeyboard
                                        : ui::mojom::MenuSourceType::kMouse);
}
BEGIN_METADATA(MerlinAdblockButton)
END_METADATA
}  // namespace modal_browser
