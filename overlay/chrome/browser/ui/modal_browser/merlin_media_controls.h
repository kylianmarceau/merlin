// Copyright 2026 The Merlin Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_MEDIA_CONTROLS_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_MEDIA_CONTROLS_H_

#include "base/memory/raw_ptr.h"
#include "components/global_media_controls/public/views/media_item_ui_updated_view.h"
#include "ui/views/bubble/bubble_dialog_delegate_view.h"

class RichHoverButton;
namespace views {
class Label;
class Separator;
}  // namespace views
namespace global_media_controls {
class MediaItemUIListView;
}

namespace modal_browser {

// The original objects retain their callbacks, accessible names and state.
struct MerlinMediaDialogParts {
  raw_ptr<views::BubbleDialogDelegateView> dialog;
  raw_ptr<global_media_controls::MediaItemUIListView> sessions;
  raw_ptr<views::View> caption_row;
  raw_ptr<views::Label> caption_title;
  raw_ptr<views::View> translate_row;
  raw_ptr<views::Label> translate_title;
  raw_ptr<views::View> settings_row;
  raw_ptr<RichHoverButton> settings_button;
  raw_ptr<views::Separator> separator;
};

global_media_controls::MediaItemUIPresentation MerlinMediaItemPresentation();
media_message_center::MediaColorTheme MerlinMediaColors(
    media_message_center::MediaColorTheme theme);
void ApplyMerlinMediaDialog(const MerlinMediaDialogParts& parts);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_MEDIA_CONTROLS_H_
