// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_theme.h"

#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "chrome/browser/ui/modal_browser/merlin_design_tokens.h"
#include "ui/color/color_id.h"
#include "ui/color/color_mixer.h"
#include "ui/color/color_provider.h"
#include "ui/color/color_provider_key.h"
#include "ui/color/color_provider_manager.h"
#include "ui/color/color_recipe.h"
#include "ui/views/merlin_style.h"

namespace modal_browser {

namespace {

using design::kDark;
using design::kLight;
using design::Palette;

}  // namespace

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
  const Palette& p =
      key.color_mode == ui::ColorProviderKey::ColorMode::kDark ? kDark : kLight;
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
