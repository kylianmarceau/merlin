// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_toolbar.h"

#include <algorithm>
#include <string_view>
#include <utility>

#include "base/strings/escape.h"
#include "base/strings/utf_string_conversions.h"
#include "cc/paint/paint_flags.h"
#include "chrome/browser/ui/browser_commands.h"
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
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/window_open_disposition_utils.h"
#include "ui/color/color_provider.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/skia_conversions.h"
#include "ui/gfx/text_elider.h"
#include "ui/gfx/text_utils.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/controls/focus_ring.h"
#include "ui/views/controls/highlight_path_generator.h"
#include "ui/views/controls/menu/menu_runner.h"
#include "ui/views/widget/widget.h"
#include "url/gurl.h"

namespace modal_browser {

namespace {

constexpr int kNavButtonSize = 30;
constexpr int kNavButtonRadius = 8;
constexpr float kStroke = 1.6f;

constexpr int kFieldHeight = 30;
constexpr int kFieldRadius = 9;
constexpr int kFieldPadding = 12;
constexpr int kFieldPreferredWidth = 560;
constexpr int kGlyphSize = 14;
constexpr int kChipGap = 8;

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

// A small lock in a 14 x 14 box.
void DrawLock(gfx::Canvas* canvas, const gfx::PointF& o, SkColor color) {
  const SkRect body = SkRect::MakeXYWH(o.x() + 2.5f, o.y() + 6.0f, 9.0f, 6.5f);
  canvas->sk_canvas()->drawRoundRect(body, 1.8f, 1.8f,
                                     StrokeFlags(color, 1.3f));
  SkPathBuilder shackle;
  shackle.moveTo(o.x() + 4.75f, o.y() + 6.0f);
  shackle.lineTo(o.x() + 4.75f, o.y() + 4.25f);
  shackle.arcTo(SkRect::MakeXYWH(o.x() + 4.75f, o.y() + 1.75f, 4.5f, 5.0f),
                180.0f, 180.0f, /*forceMoveTo=*/false);
  shackle.lineTo(o.x() + 9.25f, o.y() + 6.0f);
  canvas->DrawPath(shackle.detach(), StrokeFlags(color, 1.3f));
}

SkColor Color(const views::View* view, ui::ColorId id) {
  const ui::ColorProvider* provider = view->GetColorProvider();
  return provider ? provider->GetColor(id) : gfx::kPlaceholderColor;
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
  return gfx::Size(kNavButtonSize, kNavButtonSize);
}

void MerlinNavButton::StateChanged(ButtonState old_state) {
  views::Button::StateChanged(old_state);
  SchedulePaint();
}

void MerlinNavButton::PaintButtonContents(gfx::Canvas* canvas) {
  const gfx::Rect bounds = GetLocalBounds();
  const ButtonState state = GetState();
  if (state == STATE_HOVERED || state == STATE_PRESSED) {
    const SkColor hover = Color(this, state == STATE_PRESSED
                                          ? kColorToolbarInkDropRipple
                                          : kColorToolbarInkDropHover);
    canvas->sk_canvas()->drawRoundRect(gfx::RectToSkRect(bounds),
                                       kNavButtonRadius, kNavButtonRadius,
                                       FillFlags(hover));
  }
  SkColor icon = Color(this, state == STATE_DISABLED
                                 ? kColorToolbarButtonIconDisabled
                                 : kColorToolbarButtonIcon);
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
  SetTooltipText(u"Edit address  ⌘L");
  GetViewAccessibility().SetName(u"Address");
}

MerlinAddressField::~MerlinAddressField() = default;

void MerlinAddressField::Update(content::WebContents* contents) {
  std::u16string host;
  std::u16string rest;
  Security security = Security::kNone;
  if (contents) {
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
  if (host == host_ && rest == rest_ && security == security_) {
    return;
  }
  host_ = std::move(host);
  rest_ = std::move(rest);
  security_ = security;
  GetViewAccessibility().SetName(u"Address: " + host_ + rest_);
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
  if (security_ == Security::kNone) {
    return gfx::Rect();
  }
  int width = kGlyphSize;
  if (const std::u16string chip = ChipText(); !chip.empty()) {
    width = gfx::GetStringWidth(chip, style::UiFont(-1, gfx::Font::Weight::MEDIUM)) +
            2 * 7;
  }
  return gfx::Rect(kFieldPadding - (security_ == Security::kSecure ? 0 : 5),
                   (height() - 20) / 2, width, 20);
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
  const bool hovered =
      GetState() == STATE_HOVERED || GetState() == STATE_PRESSED;
  canvas->sk_canvas()->drawRoundRect(
      gfx::RectToSkRect(bounds), kFieldRadius, kFieldRadius,
      FillFlags(Color(this, hovered ? kColorLocationBarBackgroundHovered
                                    : kColorLocationBarBackground)));

  int x = kFieldPadding;
  const gfx::Rect info = SiteInfoBounds();
  if (security_ == Security::kSecure) {
    DrawLock(canvas,
             gfx::PointF(info.x(), (bounds.height() - kGlyphSize) / 2.0f),
             Color(this, kColorOmniboxTextDimmed));
    x = info.right() + 6;
  } else if (!info.IsEmpty()) {
    const SkColor warn = Color(this, kColorOmniboxSecurityChipDangerous);
    canvas->sk_canvas()->drawRoundRect(
        gfx::RectToSkRect(info), 6, 6,
        FillFlags(SkColorSetA(warn, security_ == Security::kDangerous ? 0x2E
                                                                      : 0x1C)));
    canvas->DrawStringRectWithFlags(
        ChipText(), style::UiFont(-1, gfx::Font::Weight::MEDIUM), warn, info,
        gfx::Canvas::TEXT_ALIGN_CENTER);
    x = info.right() + kChipGap;
  }

  const gfx::FontList& host_font =
      style::UiFont(0, gfx::Font::Weight::MEDIUM);
  const gfx::FontList& rest_font = style::UiFont();
  const int available = bounds.width() - x - kFieldPadding;
  if (available <= 0) {
    return;
  }
  const std::u16string host =
      gfx::ElideText(host_, host_font, available, gfx::ELIDE_HEAD);
  const int host_width = std::min(gfx::GetStringWidth(host, host_font),
                                  available);
  canvas->DrawStringRect(host, host_font, Color(this, kColorOmniboxText),
                         gfx::Rect(x, 0, host_width, bounds.height()));
  const int rest_space = available - host_width;
  if (!rest_.empty() && rest_space > 12) {
    const std::u16string rest =
        gfx::ElideText(rest_, rest_font, rest_space, gfx::ELIDE_TAIL);
    canvas->DrawStringRect(
        rest, rest_font, Color(this, kColorOmniboxTextDimmed),
        gfx::Rect(x + host_width, 0, rest_space, bounds.height()));
  }
}

void MerlinAddressField::OnPressed(const ui::Event& event) {
  if (event.IsLocatedEvent()) {
    gfx::Rect info = SiteInfoBounds();
    info.Inset(-4);
    if (!info.IsEmpty() &&
        info.Contains(gfx::ToFlooredPoint(event.AsLocatedEvent()->location_f()))) {
      show_site_info_.Run();
      return;
    }
  }
  edit_address_.Run();
}

BEGIN_METADATA(MerlinAddressField)
END_METADATA

}  // namespace modal_browser
