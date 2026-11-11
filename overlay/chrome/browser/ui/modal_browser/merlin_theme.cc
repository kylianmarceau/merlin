// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_theme.h"

#include <algorithm>
#include <initializer_list>

#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/stringprintf.h"
#include "chrome/browser/ui/modal_browser/merlin_design_tokens.h"
#include "ui/color/color_id.h"
#include "ui/color/color_mixer.h"
#include "ui/color/color_provider.h"
#include "ui/color/color_provider_key.h"
#include "ui/color/color_provider_manager.h"
#include "ui/color/color_recipe.h"
#include "ui/gfx/color_utils.h"
#include "ui/views/merlin_style.h"

namespace modal_browser {

namespace {

using design::kDark;
using design::kLight;
using design::Palette;
std::optional<SkColor> seed;
MerlinAppearance& Appearance() {
  static base::NoDestructor<MerlinAppearance> appearance;
  return *appearance;
}

SkColor Ink(SkColor background) {
  return color_utils::GetContrastRatio(SK_ColorBLACK, background) >
                 color_utils::GetContrastRatio(SK_ColorWHITE, background)
             ? SK_ColorBLACK
             : SK_ColorWHITE;
}

SkColor ReadableOn(SkColor color,
                   std::initializer_list<SkColor> backgrounds,
                   float ratio) {
  const SkColor target = Ink(*backgrounds.begin());
  for (int alpha = 0; alpha <= 255; ++alpha) {
    const SkColor candidate =
        color_utils::AlphaBlend(target, color, static_cast<SkAlpha>(alpha));
    if (std::all_of(backgrounds.begin(), backgrounds.end(),
                    [candidate, ratio](SkColor background) {
                      return color_utils::GetContrastRatio(candidate, background) >= ratio;
                    })) {
      return candidate;
    }
  }
  return target;
}

SkColor Readable(SkColor color, SkColor background, float ratio) {
  return ReadableOn(color, {background}, ratio);
}

}  // namespace

const MerlinAppearance& GetMerlinAppearance() {
  return Appearance();
}

bool SetMerlinAppearance(MerlinAppearance appearance) {
  if (Appearance() == appearance)
    return false;
  Appearance() = std::move(appearance);
  views::merlin_style::SetAppearanceGeometry(Appearance().sharp_corners,
                                             Appearance().comfortable);
  ui::ColorProviderManager::Get().ResetColorProviderCache();
  return true;
}

bool SetMerlinThemeColor(std::string_view color) {
  std::optional<SkColor> next;
  if (color != "default") {
    uint32_t rgb;
    if (color.size() != 7 || color.front() != '#' ||
        !base::HexStringToUInt(color.substr(1), &rgb))
      return false;
    next = SkColorSetA(rgb, 255);
  }
  if (seed == next)
    return false;
  seed = next;
  ui::ColorProviderManager::Get().ResetColorProviderCache();
  return true;
}

design::Palette MerlinPalette(bool dark) {
  Palette p = dark ? kDark : kLight;
  if (!seed)
    return p;
  const auto tint = [dark](int light_alpha, int dark_alpha) {
    return color_utils::AlphaBlend(
        *seed, dark ? SkColorSetRGB(18, 18, 18) : SK_ColorWHITE,
        static_cast<SkAlpha>(dark ? dark_alpha : light_alpha));
  };
  if (Appearance().full_tint) {
    p.header = tint(42, 28);
    p.header_inactive = tint(30, 22);
    p.base = tint(20, 32);
    p.base_container = tint(32, 42);
    p.base_elevated = tint(10, 52);
    p.surface = tint(8, 32);
    p.omnibox = tint(35, 48);
    p.popover = tint(18, 46);
    p.header_hover = tint(58, 58);
  }
  p.on_surface = Ink(p.surface);
  p.on_surface_subtle = ReadableOn(
      dark ? 0xFFAAAAAA : 0xFF666666,
      {p.surface, p.base, p.base_container, p.base_elevated, p.header,
       p.omnibox, p.popover, tint(80, 80)}, 4.5f);
  p.on_header = Ink(p.header);
  p.accent = *seed;
  p.on_accent = Ink(p.accent);
  p.accent_hover = color_utils::AlphaBlend(p.on_accent, *seed, SkAlpha{24});
  p.primary = Readable(*seed, p.surface, 4.5f);
  p.on_primary = Ink(p.primary);
  p.primary_container = tint(65, 65);
  p.on_primary_container = Ink(p.primary_container);
  p.focus_ring = ReadableOn(
      *seed, {p.surface, p.header, p.base, p.base_container, p.base_elevated,
              p.omnibox, p.popover, p.header_hover}, 3.0f);
  p.text_highlight = p.primary_container;
  return p;
}

std::string MerlinThemeCss() {
  if (!seed && Appearance() == MerlinAppearance())
    return "";
  std::string css =
      "@media (forced-colors: none) and (prefers-contrast: no-preference) {";
  if (seed)
    for (bool dark : {false, true}) {
      const auto p = MerlinPalette(dark);
      css += dark ? "@media(prefers-color-scheme:dark){:root{" : ":root{";
      for (auto [name, color] : {std::pair{"bg", p.surface},
                                 {"panel", p.base_elevated},
                                 {"sunk", p.header},
                                 {"text", p.on_surface},
                                 {"text2", p.on_surface_subtle},
                                 {"text3", p.on_surface_subtle},
                                 {"accent", p.accent},
                                 {"on-accent", p.on_accent},
                                 {"focus", p.focus_ring},
                                 {"link", p.primary},
                                 {"select", p.primary_container},
                                 {"glass", p.popover}}) {
        css += base::StringPrintf("--%s:#%06x;", name, color & 0xffffff);
      }
      css += dark ? "}}" : "}";
    }
  if (Appearance().background == "gradient") {
    css +=
        "body.merlin-start {min-height:100vh;background:linear-gradient(135deg,var(--bg) "
        "15%,color-mix(in srgb,var(--accent) 22%,var(--bg)) "
        "100%);background-attachment:fixed;}";
  } else if (Appearance().background == "image" &&
             !Appearance().image.empty()) {
    css += "body.merlin-start {min-height:100vh;padding-top:1px;background-image:url(\"" + Appearance().image +
           "\");background-size:cover;background-position:center;background-"
           "attachment:fixed;}";
    // Solid panel protects legibility regardless of the chosen photograph.
    css +=
        "body.merlin-start .start "
        "{background:var(--bg);border-radius:var(--card-radius);padding:32px;margin:12vh auto 32px;width:calc(100% - 48px);box-sizing:border-box;}";
  }
  css += "}";
  if (Appearance().sharp_corners)
    css += ":root{--card-radius:3px;--dialog-radius:3px;}";
  return css;
}

bool MerlinThemeApplies(const ui::ColorProviderKey& key) {
  if (key.custom_theme || key.user_color.has_value()) {
    return false;
  }
  if (key.contrast_mode == ui::ColorProviderKey::ContrastMode::kHigh ||
      key.forced_colors != ui::ColorProviderKey::ForcedColors::kNone) {
    return false;
  }
  return true;
}

void AddMerlinColorMixer(ui::ColorProvider* provider,
                         const ui::ColorProviderKey& key) {
  if (!MerlinThemeApplies(key)) {
    return;
  }
  const bool private_or_grayscale =
      key.user_color_source ==
      ui::ColorProviderKey::UserColorSource::kGrayscale;
  const bool is_dark = key.color_mode == ui::ColorProviderKey::ColorMode::kDark;
  const Palette p = private_or_grayscale ? (is_dark ? kDark : kLight)
                                         : MerlinPalette(is_dark);
  ui::ColorMixer& mixer = provider->AddMixer();

  mixer[ui::kColorSysHeader] = {p.header};
  mixer[ui::kColorSysHeaderInactive] = {p.header_inactive};
  mixer[ui::kColorSysHeaderContainer] = {p.base};
  mixer[ui::kColorSysHeaderContainerInactive] = {p.base};
  mixer[ui::kColorSysOnHeaderPrimary] = {p.on_header};
  mixer[ui::kColorSysOnHeaderPrimaryInactive] = {p.on_surface_subtle};
  mixer[ui::kColorSysOnHeaderDivider] = {p.divider};
  mixer[ui::kColorSysOnHeaderDividerInactive] = {p.divider};
  mixer[ui::kColorSysStateHeaderHover] = {p.header_hover};
  mixer[ui::kColorSysStateHeaderHoverInactive] = {p.header_hover};

  mixer[ui::kColorSysBase] = {p.base};
  mixer[ui::kColorSysBaseContainer] = {p.base_container};
  mixer[ui::kColorSysBaseContainerElevated] = {p.base_elevated};
  mixer[ui::kColorSysSurface] = {p.surface};
  // Elevated media cards, choosers, side panels and WebUI consume these
  // directly instead of deriving from kColorSysSurface.
  mixer[ui::kColorSysSurface1] = {p.surface};
  mixer[ui::kColorSysSurface2] = {p.surface};
  mixer[ui::kColorSysSurface3] = {p.base_container};
  mixer[ui::kColorSysSurface4] = {p.base_container};
  mixer[ui::kColorSysSurface5] = {p.base_elevated};
  mixer[ui::kColorSysSurfaceContainerLowest] = {p.header};
  mixer[ui::kColorSysSurfaceContainerLow] = {p.surface};
  mixer[ui::kColorSysSurfaceContainer] = {p.base};
  mixer[ui::kColorSysSurfaceContainerHigh] = {p.base_container};
  mixer[ui::kColorSysSurfaceContainerHighest] = {p.base_elevated};
  mixer[ui::kColorSysSurfaceNumberedForeground] = {p.on_surface};
  mixer[ui::kColorSysNeutralContainer] = {p.base_container};
  mixer[ui::kColorSysSurfaceVariant] = {p.base_container};
  mixer[ui::kColorSysOnSurfaceVariant] = {p.on_surface_subtle};
  mixer[ui::kColorSysOutline] = {p.outline};
  mixer[ui::kColorSysOnSurfacePrimary] = {p.on_surface};
  mixer[ui::kColorSysOnSurfacePrimaryInactive] = {p.on_surface_subtle};
  mixer[ui::kColorSysBaseTonalContainer] = {p.primary_container};
  mixer[ui::kColorSysOnBaseTonalContainer] = {p.on_primary_container};
  // Menus Chromium draws itself are frosted pop-ups like the others.
  mixer[ui::kColorMenuBackground] = {p.popover};
  mixer[ui::kColorDialogBackground] = {p.surface};
  // Pop-ups are plain grey panels, like macOS popovers.
  mixer[ui::kColorBubbleBackground] = {p.popover};
  // The footnote is part of the panel (a hairline above it), not a band of
  // its own: transparent, so it shows the panel or its frosted glass.
  mixer[ui::kColorBubbleFooterBackground] = {SK_ColorTRANSPARENT};
  mixer[ui::kColorBubbleFooterBorder] = {p.divider};
  mixer[ui::kColorToggleButtonTrackOn] = {p.accent};
  mixer[ui::kColorToggleButtonThumbOn] = {p.on_accent};
  mixer[ui::kColorToggleButtonThumbOnHover] = {p.on_accent};
  mixer[ui::kColorSysOmniboxContainer] = {p.omnibox};

  mixer[ui::kColorSysOnSurface] = {p.on_surface};
  mixer[ui::kColorSysOnSurfaceSecondary] = {p.on_surface_subtle};
  mixer[ui::kColorSysOnSurfaceSubtle] = {p.on_surface_subtle};
  mixer[ui::kColorSysDivider] = {p.divider};
  mixer[ui::kColorSysNeutralOutline] = {p.outline};
  mixer[ui::kColorSysTonalOutline] = {p.outline};

  mixer[ui::kColorSysPrimary] = {p.primary};
  mixer[ui::kColorSysOnPrimary] = {p.on_primary};
  mixer[ui::kColorSysPrimaryContainer] = {p.primary_container};
  mixer[ui::kColorSysOnPrimaryContainer] = {p.on_primary_container};
  mixer[ui::kColorSysTonalContainer] = {p.primary_container};
  mixer[ui::kColorSysOnTonalContainer] = {p.on_primary_container};
  mixer[ui::kColorSysStateFocusRing] = {p.focus_ring};
  mixer[ui::kColorSysStateTextHighlight] = {p.text_highlight};
  mixer[ui::kColorSysStateOnTextHighlight] = {p.on_surface};

  // Controls in Merlin's shapes (ui/views/merlin_style.h). Buttons are grey
  // fills with no outline, as in macOS popovers; the default action is a
  // shade stronger rather than a different color, so no answer is pushed.
  const bool dark = key.color_mode == ui::ColorProviderKey::ColorMode::kDark;
  // Pop-ups are frosted glass on macOS (ui/views/merlin_style.h), so their
  // fills are tints of the text colour that let the glass show through.
  const SkColor quiet_fill = dark ? SkColorSetA(SK_ColorWHITE, 0x1F)
                                  : SkColorSetARGB(0x14, 0x28, 0x1E, 0x0A);
  const SkColor strong_fill = dark ? SkColorSetA(SK_ColorWHITE, 0x33)
                                   : SkColorSetARGB(0x24, 0x28, 0x1E, 0x0A);
  const design::OverlayPalette& overlay = dark ? design::kDarkOverlay
                                               : design::kLightOverlay;
  const SkColor hover = dark ? SkColorSetA(SK_ColorWHITE, 0x12)
                             : SkColorSetARGB(0x10, 0x28, 0x1E, 0x0A);
  mixer[ui::kColorSysStateHoverOnSubtle] = {hover};
  mixer[ui::kColorButtonBackground] = {quiet_fill};
  mixer[ui::kColorButtonBorder] = {SK_ColorTRANSPARENT};
  mixer[ui::kColorButtonBorderDisabled] = {SK_ColorTRANSPARENT};
  mixer[ui::kColorButtonForeground] = {p.on_surface};
  mixer[ui::kColorButtonBackgroundTonal] = {quiet_fill};
  mixer[ui::kColorButtonBackgroundTonalFocused] = {quiet_fill};
  mixer[ui::kColorButtonForegroundTonal] = {p.on_surface};
  mixer[ui::kColorButtonBackgroundProminent] = {strong_fill};
  mixer[ui::kColorButtonBackgroundProminentFocused] = {strong_fill};
  mixer[ui::kColorButtonForegroundProminent] = {p.on_surface};
  mixer[ui::kColorToggleButtonTrackOff] = {p.outline};
  mixer[ui::kColorToggleButtonThumbOff] = {dark ? p.on_header : SK_ColorWHITE};
  mixer[ui::kColorCheckboxContainer] = {p.accent};
  mixer[ui::kColorCheckboxCheck] = {p.on_accent};
  mixer[ui::kColorCheckboxOutline] = {p.on_surface_subtle};
  mixer[ui::kColorRadioButtonForegroundChecked] = {p.primary};
  mixer[ui::kColorRadioButtonForegroundUnchecked] = {p.on_surface_subtle};
  // Hairlines are a tint of the text color, so they read on any panel.
  mixer[ui::kColorBubbleBorder] = {overlay.border};
  mixer[ui::kColorSeparator] = {overlay.border};
  const SkColor row_hover = dark ? SkColorSetA(SK_ColorWHITE, 0x1A)
                                 : SkColorSetARGB(0x12, 0x28, 0x1E, 0x0A);
  mixer[ui::kColorMenuItemBackgroundSelected] = {row_hover};
  mixer[ui::kColorMenuItemBackgroundHighlighted] = {row_hover};
  mixer[ui::kColorMenuSeparator] = {overlay.border};
}

void InstallMerlinTheme() {
  if (base::CommandLine::ForCurrentProcess()->HasSwitch(
          "modal-browser-upstream-defaults")) {
    return;
  }
  static bool installed = false;
  if (installed) {
    return;
  }
  installed = true;
  // Merlin's control shapes go with its colors; both step aside together.
  views::merlin_style::SetEnabled(true);
  ui::ColorProviderManager& manager = ui::ColorProviderManager::Get();
  manager.AppendColorProviderInitializer(
      base::BindRepeating(&AddMerlinColorMixer));
  // Providers made before this (the first window's) are rebuilt with it.
  manager.ResetColorProviderCache();
}

}  // namespace modal_browser
