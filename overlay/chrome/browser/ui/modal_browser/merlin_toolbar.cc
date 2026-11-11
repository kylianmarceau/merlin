// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_toolbar.h"

#include <algorithm>
#include <string_view>
#include <utility>

#include "base/strings/escape.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "cc/paint/paint_flags.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_element_identifiers.h"
#include "chrome/browser/ui/color/chrome_color_id.h"
#include "chrome/browser/ui/modal_browser/merlin_urls.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/browser/ui/toolbar/back_forward_menu_model.h"
#include "components/security_state/content/content_utils.h"
#include "components/security_state/core/security_state.h"
#include "components/url_formatter/url_formatter.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/url_constants.h"
#include "third_party/skia/include/core/SkPath.h"
#include "third_party/skia/include/core/SkPathBuilder.h"
#include "third_party/skia/include/core/SkRRect.h"
#include "ui/accessibility/ax_enums.mojom.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/window_open_disposition_utils.h"
#include "ui/color/color_provider.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/color_utils.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/rounded_corners_f.h"
#include "ui/gfx/geometry/skia_conversions.h"
#include "ui/gfx/text_elider.h"
#include "ui/gfx/text_utils.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/background.h"
#include "ui/views/controls/focus_ring.h"
#include "ui/views/controls/highlight_path_generator.h"
#include "ui/views/controls/menu/menu_runner.h"
#include "ui/views/merlin_style.h"
#include "ui/views/view_class_properties.h"
#include "ui/views/view_utils.h"
#include "ui/views/widget/widget.h"
#include "url/gurl.h"

namespace modal_browser {

namespace {

constexpr int kNavButtonSize = 30;
constexpr int kNavButtonRadius = 8;
constexpr float kStroke = 1.6f;

constexpr int kFieldHeight = 30;
constexpr int kFieldRadius = 8;
constexpr int kFieldPadding = 8;
constexpr int kFieldPreferredWidth = 640;
constexpr int kChipGap = 8;

// The mode (MerlinModeIndicator).
constexpr int kModePadding = 4;
constexpr int kModeDot = 6;
constexpr int kModeGap = 6;

const gfx::FontList& ModeFont() {
  return style::UiFont(-1, gfx::Font::Weight::MEDIUM);
}
const gfx::FontList& ModeKeysFont() {
  return style::MonoFont(-1, gfx::Font::Weight::SEMIBOLD);
}

cc::PaintFlags StrokeFlags(SkColor color, float width = kStroke) {
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setStyle(cc::PaintFlags::kStroke_Style);
  flags.setStrokeWidth(width);
  flags.setStrokeCap(cc::PaintFlags::kRound_Cap);
  flags.setStrokeJoin(cc::PaintFlags::kRound_Join);
  flags.setColor(color);
  return flags;
}

cc::PaintFlags FillFlags(SkColor color) {
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setStyle(cc::PaintFlags::kFill_Style);
  flags.setColor(color);
  return flags;
}

// The glyphs, drawn in a 16 x 16 box whose top left is `o`.
void DrawChevron(gfx::Canvas* canvas,
                 const gfx::PointF& o,
                 bool left,
                 SkColor color) {
  const float near_x = left ? 5.5f : 10.5f;
  const float far_x = left ? 10.0f : 6.0f;
  SkPathBuilder path;
  path.moveTo(o.x() + far_x, o.y() + 3.5f);
  path.lineTo(o.x() + near_x, o.y() + 8.0f);
  path.lineTo(o.x() + far_x, o.y() + 12.5f);
  canvas->DrawPath(path.detach(), StrokeFlags(color));
}

void DrawReload(gfx::Canvas* canvas, const gfx::PointF& o, SkColor color) {
  // An open circle, gap at the upper right, with an arrowhead at the top
  // pointing clockwise.
  const SkRect oval =
      SkRect::MakeXYWH(o.x() + 2.75f, o.y() + 3.25f, 10.5f, 10.5f);
  SkPathBuilder arc;
  arc.arcTo(oval, -35.0f, 305.0f, /*forceMoveTo=*/true);
  canvas->DrawPath(arc.detach(), StrokeFlags(color));
  SkPathBuilder head;
  head.moveTo(o.x() + 6.2f, o.y() + 1.2f);
  head.lineTo(o.x() + 8.4f, o.y() + 3.25f);
  head.lineTo(o.x() + 6.2f, o.y() + 5.3f);
  canvas->DrawPath(head.detach(), StrokeFlags(color));
}

void DrawStop(gfx::Canvas* canvas, const gfx::PointF& o, SkColor color) {
  SkPathBuilder path;
  path.moveTo(o.x() + 4.5f, o.y() + 4.5f);
  path.lineTo(o.x() + 11.5f, o.y() + 11.5f);
  path.moveTo(o.x() + 11.5f, o.y() + 4.5f);
  path.lineTo(o.x() + 4.5f, o.y() + 11.5f);
  canvas->DrawPath(path.detach(), StrokeFlags(color));
}

SkColor Color(const views::View* view, ui::ColorId id) {
  const ui::ColorProvider* provider = view->GetColorProvider();
  return provider ? provider->GetColor(id) : gfx::kPlaceholderColor;
}

// Ink for what is drawn on the toolbar: on the page's color when there is
// one, else on the toolbar's own.
style::Ink InkFor(const views::View* view, std::optional<SkColor> surface) {
  surface = style::PageSurface(view, surface);
  return style::InkOn(surface ? *surface : Color(view, kColorToolbar));
}

}  // namespace

// MerlinNavButton ----------------------------------------------------------

MerlinNavButton::MerlinNavButton(BrowserWindowInterface* browser, Kind kind)
    : views::Button(base::BindRepeating(&MerlinNavButton::OnPressed,
                                        base::Unretained(this))),
      browser_(browser),
      kind_(kind) {
  SetTriggerableEventFlags(ui::EF_LEFT_MOUSE_BUTTON |
                           ui::EF_MIDDLE_MOUSE_BUTTON);
  SetInstallFocusRingOnFocus(true);
  views::InstallRoundRectHighlightPathGenerator(this, gfx::Insets(),
                                                kNavButtonRadius);
  if (kind_ != Kind::kReload) {
    set_context_menu_controller(this);
  }
  UpdateTooltip();
}

MerlinNavButton::~MerlinNavButton() = default;

void MerlinNavButton::SetLoading(bool loading) {
  if (kind_ != Kind::kReload || loading_ == loading) {
    return;
  }
  loading_ = loading;
  UpdateTooltip();
  SchedulePaint();
}

void MerlinNavButton::SetSurface(std::optional<SkColor> surface) {
  if (surface_ != surface) {
    surface_ = surface;
    SchedulePaint();
  }
}

void MerlinNavButton::UpdateTooltip() {
  std::u16string name;
  std::u16string keys;
  switch (kind_) {
    case Kind::kBack:
      name = u"Back";
      keys = u"⌘[";
      break;
    case Kind::kForward:
      name = u"Forward";
      keys = u"⌘]";
      break;
    case Kind::kReload:
      name = loading_ ? u"Stop" : u"Reload";
      keys = loading_ ? u"Esc" : u"⌘R";
      break;
  }
  SetTooltipText(name + u"  " + keys);
  GetViewAccessibility().SetName(name);
}

gfx::Size MerlinNavButton::CalculatePreferredSize(
    const views::SizeBounds& available_size) const {
  return gfx::Size(
      kNavButtonSize,
      kNavButtonSize + (views::merlin_style::ComfortableDensity() ? 8 : 0));
}

void MerlinNavButton::StateChanged(ButtonState old_state) {
  views::Button::StateChanged(old_state);
  SchedulePaint();
}

void MerlinNavButton::PaintButtonContents(gfx::Canvas* canvas) {
  const gfx::Rect bounds = GetLocalBounds();
  const ButtonState state = GetState();
  const style::Ink ink = InkFor(this, surface_);
  if (state == STATE_HOVERED || state == STATE_PRESSED) {
    canvas->sk_canvas()->drawRoundRect(
        gfx::RectToSkRect(bounds), kNavButtonRadius, kNavButtonRadius,
        FillFlags(state == STATE_PRESSED ? ink.pressed : ink.hover));
  }
  SkColor icon = state == STATE_DISABLED ? ink.icon_disabled : ink.icon;
  const gfx::PointF origin(bounds.x() + (bounds.width() - 16) / 2.0f,
                           bounds.y() + (bounds.height() - 16) / 2.0f);
  switch (kind_) {
    case Kind::kBack:
      DrawChevron(canvas, origin, /*left=*/true, icon);
      break;
    case Kind::kForward:
      DrawChevron(canvas, origin, /*left=*/false, icon);
      break;
    case Kind::kReload:
      if (loading_) {
        DrawStop(canvas, origin, icon);
      } else {
        DrawReload(canvas, origin, icon);
      }
      break;
  }
}

void MerlinNavButton::OnPressed(const ui::Event& event) {
  const WindowOpenDisposition disposition =
      ui::DispositionFromEventFlags(event.flags());
  switch (kind_) {
    case Kind::kBack:
      chrome::GoBack(browser_, disposition);
      break;
    case Kind::kForward:
      chrome::GoForward(browser_, disposition);
      break;
    case Kind::kReload:
      if (loading_) {
        chrome::Stop(browser_);
      } else if (event.IsShiftDown()) {
        chrome::ReloadBypassingCache(browser_, disposition);
      } else {
        chrome::Reload(browser_, disposition);
      }
      break;
  }
}

void MerlinNavButton::ShowContextMenuForViewImpl(
    views::View* source,
    const gfx::Point& point,
    ui::mojom::MenuSourceType source_type) {
  if (!GetEnabled() || !GetWidget()) {
    return;
  }
  menu_model_ = std::make_unique<BackForwardMenuModel>(
      browser_, kind_ == Kind::kBack
                    ? BackForwardMenuModel::ModelType::kBackward
                    : BackForwardMenuModel::ModelType::kForward);
  menu_runner_ = std::make_unique<views::MenuRunner>(
      menu_model_.get(), views::MenuRunner::CONTEXT_MENU);
  gfx::Rect anchor = GetBoundsInScreen();
  menu_runner_->RunMenuAt(GetWidget(), nullptr, anchor,
                          views::MenuAnchorPosition::kTopLeft, source_type);
}

BEGIN_METADATA(MerlinNavButton)
END_METADATA

// MerlinAddressField -------------------------------------------------------

MerlinAddressField::MerlinAddressField(base::RepeatingClosure edit_address,
                                         base::RepeatingClosure show_site_info)
    : views::Button(base::BindRepeating(&MerlinAddressField::OnPressed,
                                        base::Unretained(this))),
      edit_address_(std::move(edit_address)),
      show_site_info_(std::move(show_site_info)) {
  SetInstallFocusRingOnFocus(true);
  views::InstallRoundRectHighlightPathGenerator(this, gfx::Insets(),
                                                kFieldRadius);
  // Page info and permission prompts open from the address, where the
  // site is named (patch 0013 looks for this identifier).
  SetProperty(views::kElementIdentifierKey, kLocationIconElementId);
  // Pop-ups open from here toward the middle of the window, whichever side
  // they asked for (passwords, bookmarks, restore pages).
  SetProperty(views::merlin_style::kPopoverPlacementKey,
              views::merlin_style::PopoverPlacement::kTowardMiddle);
  set_context_menu_controller(this);
  SetTooltipText(u"Edit address  ⌘L");
  GetViewAccessibility().SetName(u"Address");
}

void MerlinAddressField::ShowContextMenuForViewImpl(
    views::View* source,
    const gfx::Point& point,
    ui::mojom::MenuSourceType source_type) {
  show_site_info_.Run();
}

MerlinAddressField::~MerlinAddressField() = default;

void MerlinAddressField::SetSurface(std::optional<SkColor> surface) {
  if (surface_ != surface) {
    surface_ = surface;
    SchedulePaint();
  }
}

void MerlinAddressField::Update(content::WebContents* contents) {
  std::u16string host;
  std::u16string rest;
  std::u16string title;
  Security security = Security::kNone;
  if (contents) {
    title = contents->GetTitle();
    const GURL& url = contents->GetVisibleURL();
    if (url.SchemeIs(content::kChromeUIScheme)) {
      host = base::UTF8ToUTF16(MerlinDisplayUrl(url));
    } else {
      const std::u16string full = url_formatter::FormatUrl(
          url,
          url_formatter::kFormatUrlOmitDefaults |
              url_formatter::kFormatUrlOmitHTTPS |
              url_formatter::kFormatUrlOmitTrivialSubdomains,
          base::UnescapeRule::SPACES, nullptr, nullptr, nullptr);
      // Everything up to the first slash after the host is the host.
      size_t start = 0;
      if (const size_t scheme = full.find(u"://");
          scheme != std::u16string::npos) {
        start = scheme + 3;
      }
      const size_t slash = url.SchemeIsHTTPOrHTTPS()
                               ? full.find_first_of(u"/?#", start)
                               : std::u16string::npos;
      host = full.substr(0, slash);
      if (slash != std::u16string::npos) {
        rest = full.substr(slash);
      }
      if (url.SchemeIsHTTPOrHTTPS()) {
        const auto state = security_state::GetVisibleSecurityState(contents);
        switch (state ? security_state::GetSecurityLevel(*state)
                      : security_state::NONE) {
          case security_state::SECURE:
            security = Security::kSecure;
            break;
          case security_state::DANGEROUS:
            security = Security::kDangerous;
            break;
          case security_state::WARNING:
            security = Security::kNotSecure;
            break;
          default:
            security = url.SchemeIsCryptographic() ? Security::kSecure
                                                   : Security::kNotSecure;
            break;
        }
      }
    }
  }
  // A page without a title shows its address as its title; that adds
  // nothing after the host.
  if (title == host + rest || title == host) {
    title.clear();
  }
  if (host == host_ && rest == rest_ && title == title_ &&
      security == security_) {
    return;
  }
  host_ = std::move(host);
  rest_ = std::move(rest);
  title_ = std::move(title);
  security_ = security;
  GetViewAccessibility().SetName(u"Address: " + host_ + rest_);
  GetViewAccessibility().SetDescription(
      u"Press to edit. Site settings: right-click, or type :site");
  SetTooltipText(host_ + rest_ + u"\nRight-click for site settings");
  SchedulePaint();
}

std::u16string MerlinAddressField::ChipText() const {
  switch (security_) {
    case Security::kNotSecure:
      return u"Not secure";
    case Security::kDangerous:
      return u"Dangerous";
    case Security::kNone:
    case Security::kSecure:
      return std::u16string();
  }
}

gfx::Rect MerlinAddressField::SiteInfoBounds() const {
  // Only warnings show; a secure page needs no lock, as in Dia.
  const std::u16string chip = ChipText();
  if (chip.empty()) {
    return gfx::Rect();
  }
  const int width =
      gfx::GetStringWidth(chip, style::UiFont(-1, gfx::Font::Weight::MEDIUM)) +
      2 * 7;
  return gfx::Rect(kFieldPadding - 4, (height() - 20) / 2, width, 20);
}

gfx::Size MerlinAddressField::CalculatePreferredSize(
    const views::SizeBounds& available_size) const {
  return gfx::Size(kFieldPreferredWidth, kFieldHeight);
}

void MerlinAddressField::StateChanged(ButtonState old_state) {
  views::Button::StateChanged(old_state);
  SchedulePaint();
}

void MerlinAddressField::PaintButtonContents(gfx::Canvas* canvas) {
  const gfx::Rect bounds = GetLocalBounds();
  const style::Ink ink = InkFor(this, surface_);
  // No box: the address is written on the toolbar. Hover shows where to
  // click, around the text only.
  const bool hovered =
      GetState() == STATE_HOVERED || GetState() == STATE_PRESSED;

  int x = kFieldPadding;
  const gfx::Rect info = SiteInfoBounds();
  if (!info.IsEmpty()) {
    const SkColor warn = color_utils::BlendForMinContrast(
                             Color(this, kColorOmniboxSecurityChipDangerous),
                             style::PageSurface(this, surface_)
                                 .value_or(Color(this, kColorToolbar)))
                             .color;
    canvas->sk_canvas()->drawRoundRect(
        gfx::RectToSkRect(info), 6, 6,
        FillFlags(SkColorSetA(warn, security_ == Security::kDangerous ? 0x2E
                                                                      : 0x1C)));
    canvas->DrawStringRectWithFlags(
        ChipText(), style::UiFont(-1, gfx::Font::Weight::MEDIUM), warn, info,
        gfx::Canvas::TEXT_ALIGN_CENTER);
    x = info.right() + kChipGap;
  }

  const gfx::FontList& font = style::UiFont();
  const int available = bounds.width() - x - kFieldPadding;
  if (available <= 0) {
    return;
  }
  const std::u16string host =
      gfx::ElideText(host_, font, available, gfx::ELIDE_HEAD);
  const int host_width =
      std::min(gfx::GetStringWidth(host, font), available);
  // After the site: " / " and the page's title, else its path.
  const std::u16string after =
      title_.empty() ? rest_ : (u" / " + title_);
  const int after_space = available - host_width;
  std::u16string tail;
  if (!after.empty() && after_space > 16) {
    tail = gfx::ElideText(after, font, after_space, gfx::ELIDE_TAIL);
  }
  const int text_width = host_width + gfx::GetStringWidth(tail, font);
  if (hovered) {
    gfx::Rect hover(0, 0, std::min(bounds.width(), x + text_width + kFieldPadding),
                    bounds.height());
    canvas->sk_canvas()->drawRoundRect(gfx::RectToSkRect(hover), kFieldRadius,
                                       kFieldRadius, FillFlags(ink.hover));
  }
  canvas->DrawStringRect(host, font, ink.text,
                         gfx::Rect(x, 0, host_width, bounds.height()));
  if (!tail.empty()) {
    canvas->DrawStringRect(
        tail, font, ink.text_dim,
        gfx::Rect(x + host_width, 0, after_space, bounds.height()));
  }
}

void MerlinAddressField::OnPressed(const ui::Event& event) {
  if (event.IsLocatedEvent()) {
    gfx::Rect info = SiteInfoBounds();
    if (!info.IsEmpty()) {
      info.Outset(4);
      if (info.Contains(
              gfx::ToFlooredPoint(event.AsLocatedEvent()->location_f()))) {
        show_site_info_.Run();
        return;
      }
    }
  }
  edit_address_.Run();
}

BEGIN_METADATA(MerlinAddressField)
END_METADATA

// MerlinModeIndicator ------------------------------------------------------

MerlinModeIndicator::MerlinModeIndicator() {
  SetCanProcessEventsWithinSubtree(false);
  SetFocusBehavior(FocusBehavior::NEVER);
  GetViewAccessibility().SetRole(ax::mojom::Role::kStatus);
  UpdateVisibility();
}

MerlinModeIndicator::~MerlinModeIndicator() = default;

void MerlinModeIndicator::SetState(ffi::Mode mode,
                                   std::u16string_view indicator,
                                   std::u16string_view pending) {
  std::u16string label = base::ToLowerASCII(indicator);
  if (mode == mode_ && label == label_ && pending == pending_) {
    return;
  }
  mode_ = mode;
  label_ = std::move(label);
  pending_ = std::u16string(pending);
  std::u16string name;
  if (ShowsLabel()) {
    name = label_ + u" mode";
    name[0] = base::ToUpperASCII(name[0]);
  }
  if (!pending_.empty()) {
    name += (name.empty() ? u"Keys " : u", keys ") + pending_;
  }
  GetViewAccessibility().SetName(name);
  UpdateVisibility();
  PreferredSizeChanged();
  SchedulePaint();
}

void MerlinModeIndicator::SetSurface(std::optional<SkColor> surface) {
  surface_ = surface;
  SchedulePaint();
}

bool MerlinModeIndicator::ShowsLabel() const {
  return mode_ != ffi::Mode::Normal && !label_.empty();
}

void MerlinModeIndicator::UpdateVisibility() {
  const bool visible = ShowsLabel() || !pending_.empty();
  if (GetVisible() != visible) {
    SetVisible(visible);
  }
}

gfx::Size MerlinModeIndicator::CalculatePreferredSize(
    const views::SizeBounds& available_size) const {
  int width = kModePadding;
  if (ShowsLabel()) {
    width += kModeDot + kModeGap + gfx::GetStringWidth(label_, ModeFont());
  }
  if (!pending_.empty()) {
    width += (ShowsLabel() ? kModeGap : 0) +
             gfx::GetStringWidth(pending_, ModeKeysFont());
  }
  width += kModePadding + 1;
  return gfx::Size(width, kFieldHeight);
}

void MerlinModeIndicator::OnPaint(gfx::Canvas* canvas) {
  const SkColor surface = style::PageSurface(this, surface_)
                              .value_or(Color(this, kColorToolbar));
  const style::Ink ink = style::InkOn(surface);
  const bool dark = ink.text == SK_ColorWHITE;
  // Written on the toolbar with no box, as the address is.
  float x = kModePadding;
  if (ShowsLabel()) {
    // The mode's color, kept readable on whatever color the page gives the
    // toolbar.
    const SkColor color =
        color_utils::BlendForMinContrast(style::ModeColor(mode_, dark),
                                         surface)
            .color;
    canvas->DrawCircle(gfx::PointF(x + kModeDot / 2.f, height() / 2.f),
                       kModeDot / 2.f, FillFlags(color));
    x += kModeDot + kModeGap;
    const int label_width = gfx::GetStringWidth(label_, ModeFont());
    canvas->DrawStringRect(label_, ModeFont(), color,
                           gfx::Rect(x, 0, label_width + 1, height()));
    x += label_width + kModeGap;
  }
  if (!pending_.empty()) {
    canvas->DrawStringRect(
        pending_, ModeKeysFont(), ink.text,
        gfx::Rect(x, 0, gfx::GetStringWidth(pending_, ModeKeysFont()) + 1,
                  height()));
  }
}

void MerlinModeIndicator::OnThemeChanged() {
  views::View::OnThemeChanged();
  SchedulePaint();
}

BEGIN_METADATA(MerlinModeIndicator)
END_METADATA

// MerlinToolbarBackdrop ----------------------------------------------------

MerlinToolbarBackdrop::MerlinToolbarBackdrop() {
  SetProperty(views::kViewIgnoredByLayoutKey, true);
  SetCanProcessEventsWithinSubtree(false);
  SetFocusBehavior(FocusBehavior::NEVER);
  GetViewAccessibility().SetIsIgnored(true);
}

MerlinToolbarBackdrop::~MerlinToolbarBackdrop() = default;

// static
MerlinToolbarBackdrop* MerlinToolbarBackdrop::InstallIn(views::View* toolbar) {
  for (views::View* child : toolbar->children()) {
    if (auto* backdrop = views::AsViewClass<MerlinToolbarBackdrop>(child)) {
      return backdrop;
    }
  }
  auto* backdrop = toolbar->AddChildViewAt(
      std::make_unique<MerlinToolbarBackdrop>(), 0);
  backdrop->SetBoundsRect(toolbar->GetLocalBounds());
  return backdrop;
}

void MerlinToolbarBackdrop::SetColor(std::optional<SkColor> color) {
  if (color_ != color) {
    color_ = color;
    SchedulePaint();
  }
}

void MerlinToolbarBackdrop::SetFullBleed(bool on) {
  if (full_bleed_ != on) {
    full_bleed_ = on;
    SchedulePaint();
  }
}

void MerlinToolbarBackdrop::AddedToWidget() {
  if (parent() && !observing_) {
    parent()->AddObserver(this);
    observing_ = true;
    SetBoundsRect(parent()->GetLocalBounds());
  }
}

void MerlinToolbarBackdrop::RemovedFromWidget() {
  if (parent() && observing_) {
    parent()->RemoveObserver(this);
    observing_ = false;
  }
}

void MerlinToolbarBackdrop::OnViewBoundsChanged(views::View* observed_view) {
  SetBoundsRect(observed_view->GetLocalBounds());
}

void MerlinToolbarBackdrop::OnPaint(gfx::Canvas* canvas) {
  const auto color = style::PageSurface(this, color_);
  if (!color || !parent()) {
    return;
  }
  // The top of the page card: as wide as the page under it, with the card's
  // top corners, so toolbar and page read as one surface. The sides show
  // the toolbar's own color, the same color as around the card.
  if (full_bleed_) {
    canvas->DrawColor(*color);
    return;
  }
  gfx::Rect card = GetLocalBounds();
  card.Inset(gfx::Insets::VH(0, style::kCardSide));
  const float r = style::CardRadius();
  const SkVector radii[4] = {{r, r}, {r, r}, {0, 0}, {0, 0}};
  SkRRect rrect;
  rrect.setRectRadii(gfx::RectToSkRect(card), radii);
  canvas->sk_canvas()->drawRRect(rrect, FillFlags(*color));
}

BEGIN_METADATA(MerlinToolbarBackdrop)
END_METADATA

}  // namespace modal_browser
