// Copyright 2026 The Merlin Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_BUBBLE_HEADER_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_BUBBLE_HEADER_H_

#include <memory>

#include "base/command_line.h"
#include "chrome/browser/ui/modal_browser/merlin_design_tokens.h"
#include "components/vector_icons/vector_icons.h"
#include "ui/base/models/image_model.h"
#include "ui/color/color_id.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/border.h"
#include "ui/views/controls/image_view.h"
#include "ui/views/layout/box_layout_view.h"

namespace modal_browser {

enum class BubbleHeaderTone {
  kPassword,
  kAuthentication,
  kPasskey,
  kAddress,
  kPayment,
  kSuccess,
  kReview,
  kDanger
};

// Decorative only: the dialog keeps its original accessible title, warning
// text, action labels and controller. Semantic warning colors stay upstream.
inline std::unique_ptr<views::View> CreateMerlinBubbleHeader(
    BubbleHeaderTone tone) {
  auto header = std::make_unique<views::BoxLayoutView>();
  header->SetOrientation(views::BoxLayout::Orientation::kHorizontal);
  header->SetMainAxisAlignment(views::BoxLayout::MainAxisAlignment::kCenter);
  header->SetBetweenChildSpacing(design::kSpaceMedium);
  header->SetBorder(views::CreateEmptyBorder(
      gfx::Insets::VH(design::kSpaceMedium, design::kDialogInset)));
  auto* mark = header->AddChildView(
      std::make_unique<views::ImageView>(ui::ImageModel::FromVectorIcon(
          vector_icons::kProductIcon, ui::kColorIcon, 32)));
  mark->GetViewAccessibility().SetIsInvisible(true);
  const gfx::VectorIcon* icon = &vector_icons::kPasswordManagerIcon;
  ui::ColorId color = ui::kColorIcon;
  switch (tone) {
    case BubbleHeaderTone::kPassword:
      break;
    case BubbleHeaderTone::kAuthentication:
      icon = &vector_icons::kFingerprintIcon;
      break;
    case BubbleHeaderTone::kPasskey:
      icon = &vector_icons::kPasskeyIcon;
      break;
    case BubbleHeaderTone::kAddress:
      icon = &vector_icons::kLocationOnIcon;
      break;
    case BubbleHeaderTone::kPayment:
      icon = &vector_icons::kPaymentsIcon;
      break;
    case BubbleHeaderTone::kSuccess:
      icon = &vector_icons::kCheckCircleFilledIcon;
      color = ui::kColorAlertLowSeverity;
      break;
    case BubbleHeaderTone::kReview:
      icon = &vector_icons::kWarningIcon;
      color = ui::kColorAlertMediumSeverityIcon;
      break;
    case BubbleHeaderTone::kDanger:
      icon = &vector_icons::kWarningIcon;
      color = ui::kColorAlertHighSeverity;
      break;
  }
  auto* status = header->AddChildView(std::make_unique<views::ImageView>(
      ui::ImageModel::FromVectorIcon(*icon, color, 24)));
  status->GetViewAccessibility().SetIsInvisible(true);
  return header;
}

inline std::unique_ptr<views::View> MerlinBubbleHeaderOrDefault(
    std::unique_ptr<views::View> upstream,
    BubbleHeaderTone tone) {
  if (base::CommandLine::ForCurrentProcess()->HasSwitch(
          "modal-browser-upstream-defaults")) {
    return upstream;
  }
  return CreateMerlinBubbleHeader(tone);
}

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_BUBBLE_HEADER_H_
