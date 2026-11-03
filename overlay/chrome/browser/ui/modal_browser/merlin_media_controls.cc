// Copyright 2026 The Merlin Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_media_controls.h"

#include "base/command_line.h"
#include "base/functional/bind.h"
#include "chrome/browser/ui/modal_browser/merlin_design_tokens.h"
#include "chrome/browser/ui/views/controls/rich_hover_button.h"
#include "components/global_media_controls/public/views/media_item_ui_list_view.h"
#include "components/vector_icons/vector_icons.h"
#include "services/media_session/public/mojom/media_session.mojom.h"
#include "ui/base/l10n/l10n_util.h"
#include "ui/gfx/font_list.h"
#include "ui/strings/grit/ui_strings.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/background.h"
#include "ui/views/border.h"
#include "ui/views/controls/button/image_button_factory.h"
#include "ui/views/controls/highlight_path_generator.h"
#include "ui/views/controls/image_view.h"
#include "ui/views/controls/label.h"
#include "ui/views/controls/separator.h"
#include "ui/views/layout/box_layout_view.h"
#include "ui/views/layout/fill_layout.h"
#include "ui/views/widget/widget.h"

namespace modal_browser {
namespace {

using global_media_controls::MediaActionButton;
using media_session::mojom::MediaSessionAction;

bool Enabled() {
  return !base::CommandLine::ForCurrentProcess()->HasSwitch(
      "modal-browser-upstream-defaults");
}

void Text(views::Label* label,
          int delta,
          gfx::Font::Weight weight,
          ui::ColorId color) {
  label->SetFontList(gfx::FontList().Derive(delta, gfx::Font::NORMAL, weight));
  label->SetEnabledColor(color);
}

void Move(views::View* destination, views::View* view) {
  destination->AddChildView(view->parent()->RemoveChildViewT(view));
}

views::BoxLayoutView* Row(views::View* parent, size_t index, int gap) {
  auto row = std::make_unique<views::BoxLayoutView>();
  row->SetCrossAxisAlignment(views::BoxLayout::CrossAxisAlignment::kCenter);
  row->SetBetweenChildSpacing(gap);
  return parent->AddChildViewAt(std::move(row), index);
}

void LayoutMedia(global_media_controls::MediaItemUIPresentationViews parts) {
  auto* card = parts.card.get();
  // The service keeps every original control and all update/event bindings.
  // Only their containers, typography, spacing and shape belong to Merlin.
  views::View* old_metadata = card->children()[0];
  views::View* old_progress = card->children()[1];
  card->SetLayoutManager(std::make_unique<views::BoxLayout>(
      views::BoxLayout::Orientation::kVertical,
      gfx::Insets(design::kSpaceMedium), design::kSpaceSmall));
  card->SetBackground(views::CreateRoundedRectBackground(ui::kColorSysSurface,
                                                         design::kCardRadius));
  card->SetBorder(views::CreateRoundedRectBorder(1, design::kCardRadius,
                                                 ui::kColorSysDivider));
  views::InstallRoundRectHighlightPathGenerator(card, gfx::Insets(),
                                                design::kCardRadius);

  auto* metadata = Row(card, 0, design::kSpaceSmall + 4);
  Move(metadata, parts.artwork);
  auto details = std::make_unique<views::BoxLayoutView>();
  details->SetOrientation(views::BoxLayout::Orientation::kVertical);
  details->SetCrossAxisAlignment(
      views::BoxLayout::CrossAxisAlignment::kStretch);
  details->SetBetweenChildSpacing(3);
  auto* details_ptr = metadata->AddChildView(std::move(details));
  metadata->SetFlexForView(details_ptr, 1);
  Move(details_ptr, parts.title);
  Move(details_ptr, parts.artist);
  auto* source = Row(details_ptr, details_ptr->children().size(), 5);
  Move(source, parts.favicon);
  Move(source, parts.source);
  source->SetFlexForView(parts.source, 1);
  Move(source, parts.casting_indicator);
  Text(parts.title, 1, gfx::Font::Weight::SEMIBOLD, ui::kColorSysOnSurface);
  Text(parts.artist, -1, gfx::Font::Weight::NORMAL,
       ui::kColorSysOnSurfaceSubtle);
  Text(parts.source, -2, gfx::Font::Weight::NORMAL,
       ui::kColorSysOnSurfaceSubtle);

  auto* progress = Row(card, 1, design::kSpaceSmall);
  Move(progress, parts.elapsed);
  Move(progress, parts.progress);
  progress->SetFlexForView(parts.progress, 1);
  Move(progress, parts.live_status);
  progress->SetFlexForView(parts.live_status, 1);
  Move(progress, parts.duration);
  Text(parts.elapsed, -2, gfx::Font::Weight::NORMAL,
       ui::kColorSysOnSurfaceSubtle);
  Text(parts.duration, -2, gfx::Font::Weight::NORMAL,
       ui::kColorSysOnSurfaceSubtle);
  parts.elapsed->SetMultiLine(false);
  parts.duration->SetMultiLine(false);
  parts.elapsed->SetPreferredSize(gfx::Size(56, 16));
  parts.duration->SetPreferredSize(gfx::Size(56, 16));

  auto* controls = Row(card, 2, 4);
  for (auto action :
       {MediaSessionAction::kPreviousTrack, MediaSessionAction::kSeekBackward,
        MediaSessionAction::kPlay, MediaSessionAction::kSeekForward,
        MediaSessionAction::kNextTrack}) {
    for (MediaActionButton* button : parts.actions) {
      if (button->GetID() == static_cast<int>(action)) {
        Move(controls, button);
      }
    }
  }
  auto* spacer = controls->AddChildView(std::make_unique<views::View>());
  controls->SetFlexForView(spacer, 1);
  Move(controls, parts.save_frame);
  Move(controls, parts.picture_in_picture);
  Move(controls, parts.cast);
  for (MediaActionButton* button : parts.actions) {
    views::InstallRoundRectHighlightPathGenerator(button, gfx::Insets(),
                                                  design::kControlRadius);
  }
  views::InstallRoundRectHighlightPathGenerator(parts.cast, gfx::Insets(),
                                                design::kControlRadius);
  // Device lists and casting footers remain direct children: Chromium can
  // replace, expand or remove them without retaining an obsolete container.
  card->RemoveChildViewT(old_metadata);
  card->RemoveChildViewT(old_progress);
}

void CaptionRow(views::View* row, views::Label* title) {
  if (!row) {
    return;
  }
  auto* layout = static_cast<views::BoxLayout*>(row->GetLayoutManager());
  layout->set_inside_border_insets(gfx::Insets::VH(6, design::kSpaceMedium));
  layout->set_between_child_spacing(design::kSpaceSmall);
  Text(title, 0, gfx::Font::Weight::NORMAL, ui::kColorSysOnSurface);
}

}  // namespace

global_media_controls::MediaItemUIPresentation MerlinMediaItemPresentation() {
  global_media_controls::MediaItemUIPresentation presentation;
  if (Enabled()) {
    presentation.width = 352;
    presentation.artwork_size = gfx::Size(48, 48);
    presentation.artwork_radius = design::kControlRadius;
    presentation.primary_action_size = gfx::Size(44, 32);
    presentation.primary_action_icon_size = 20;
    presentation.primary_action_radius = design::kControlRadius;
    presentation.persistent_timestamps = true;
    presentation.hide_empty_artist = true;
    presentation.layout = base::BindOnce(&LayoutMedia);
  }
  return presentation;
}

media_message_center::MediaColorTheme MerlinMediaColors(
    media_message_center::MediaColorTheme theme) {
  if (Enabled()) {
    theme.pause_button_container_color_id =
        theme.play_button_container_color_id;
    theme.pause_button_foreground_color_id =
        theme.play_button_foreground_color_id;
    theme.playing_progress_background_color_id = ui::kColorSysDivider;
    theme.paused_progress_foreground_color_id = ui::kColorSysPrimary;
    theme.paused_progress_background_color_id = ui::kColorSysDivider;
  }
  return theme;
}

void ApplyMerlinMediaDialog(const MerlinMediaDialogParts& parts) {
  if (!Enabled()) {
    return;
  }
  auto* dialog = parts.dialog.get();
  auto* layout = dialog->SetLayoutManager(std::make_unique<views::BoxLayout>(
      views::BoxLayout::Orientation::kVertical, gfx::Insets::VH(4, 0), 0));
  layout->set_cross_axis_alignment(
      views::BoxLayout::CrossAxisAlignment::kStretch);
  dialog->SetBackground(views::CreateRoundedRectBackground(
      ui::kColorSysBase, design::kDialogRadius));
  auto* header = Row(dialog, 0, design::kSpaceSmall);
  header->SetInsideBorderInsets(gfx::Insets::TLBR(8, 16, 10, 12));
  auto* mark = header->AddChildView(
      std::make_unique<views::ImageView>(ui::ImageModel::FromVectorIcon(
          vector_icons::kProductIcon, ui::kColorIcon, 18)));
  mark->GetViewAccessibility().SetIsInvisible(true);
  auto* title = header->AddChildView(std::make_unique<views::Label>(u"Media"));
  Text(title, 0, gfx::Font::Weight::SEMIBOLD, ui::kColorSysOnSurface);
  auto* spacer = header->AddChildView(std::make_unique<views::View>());
  header->SetFlexForView(spacer, 1);
  auto close = views::CreateVectorImageButtonWithNativeTheme(
      base::BindRepeating(
          [](views::View* owner) { owner->GetWidget()->Close(); },
          base::Unretained(dialog)),
      vector_icons::kCloseIcon);
  close->SetTooltipText(l10n_util::GetStringUTF16(IDS_APP_ACCNAME_CLOSE));
  close->SetPreferredSize(gfx::Size(28, 28));
  views::InstallRoundRectHighlightPathGenerator(close.get(), gfx::Insets(),
                                                design::kControlRadius);
  header->AddChildView(std::move(close));

  auto* session_layout = static_cast<views::BoxLayout*>(
      parts.sessions->contents()->GetLayoutManager());
  session_layout->set_inside_border_insets(gfx::Insets::TLBR(0, 16, 8, 16));
  session_layout->set_between_child_spacing(design::kSpaceSmall);
  CaptionRow(parts.caption_row, parts.caption_title);
  CaptionRow(parts.translate_row, parts.translate_title);
  if (parts.settings_button) {
    parts.settings_button->SetIcon(ui::ImageModel());
    parts.settings_button->SetTitleTextStyleAndColor(
        views::style::STYLE_BODY_4, ui::kColorSysOnSurfaceSubtle);
    parts.settings_button->SetActionIcon(ui::ImageModel::FromVectorIcon(
        vector_icons::kOpenInNewFlippableIcon, ui::kColorIconSecondary, 16));
    parts.settings_button->SetBorder(
        views::CreateEmptyBorder(gfx::Insets::VH(6, design::kSpaceMedium)));
    parts.settings_row->SetLayoutManager(std::make_unique<views::FillLayout>());
  }
  if (parts.separator) {
    parts.separator->SetColorId(ui::kColorSysDivider);
  }
}

}  // namespace modal_browser
