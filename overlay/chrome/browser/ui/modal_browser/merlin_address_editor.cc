// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_address_editor.h"

#include <utility>

#include "chrome/browser/ui/omnibox/omnibox_controller.h"
#include "chrome/browser/ui/views/location_bar/location_bar_view.h"
#include "ui/events/event.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/views/view.h"

namespace modal_browser {

MerlinAddressEditor::MerlinAddressEditor(LocationBarView* location_bar,
                                         std::vector<views::View*> merlin_views,
                                         base::RepeatingClosure on_end,
                                         base::RepeatingClosure focus_page)
    : location_bar_(location_bar),
      on_end_(std::move(on_end)),
      focus_page_(std::move(focus_page)) {
  for (views::View* view : merlin_views) {
    merlin_views_.push_back(view);
  }
}

MerlinAddressEditor::~MerlinAddressEditor() {
  StopWatching();
}

void MerlinAddressEditor::Begin() {
  if (!editing_) {
    editing_ = true;
    for (views::View* view : merlin_views_) {
      view->SetVisible(false);
    }
    location_bar_->SetVisible(true);
    focus_manager_ = location_bar_->GetFocusManager();
    if (focus_manager_) {
      focus_manager_->AddFocusChangeListener(this);
    }
    location_bar_->AddPreTargetHandler(this);
  }
  // Focused with the address selected, as Chromium does on ⌘L.
  location_bar_->FocusLocation(/*is_user_initiated=*/true,
                               /*clear_focus_if_failed=*/false);
}

void MerlinAddressEditor::End() {
  if (!editing_) {
    return;
  }
  editing_ = false;
  StopWatching();
  // An unfinished edit is dropped, so the next edit starts from the page's
  // address.
  location_bar_->Revert();
  location_bar_->SetVisible(false);
  for (views::View* view : merlin_views_) {
    view->SetVisible(true);
  }
  on_end_.Run();
}

void MerlinAddressEditor::StopWatching() {
  if (focus_manager_) {
    focus_manager_->RemoveFocusChangeListener(this);
    focus_manager_ = nullptr;
  }
  location_bar_->RemovePreTargetHandler(this);
}

void MerlinAddressEditor::OnDidChangeFocus(views::View* focused_before,
                                           views::View* focused_now) {
  // No focused view while the window is in the background; Chromium's
  // field gets focus back when the window does.
  if (!focused_now || location_bar_->Contains(focused_now)) {
    return;
  }
  End();
}

void MerlinAddressEditor::OnKeyEvent(ui::KeyEvent* event) {
  constexpr int kModifiers = ui::EF_SHIFT_DOWN | ui::EF_CONTROL_DOWN |
                             ui::EF_ALT_DOWN | ui::EF_COMMAND_DOWN;
  if (event->type() != ui::EventType::kKeyPressed ||
      event->key_code() != ui::VKEY_ESCAPE || (event->flags() & kModifiers)) {
    return;
  }
  // While suggestions show, Esc is Chromium's and closes them. With none
  // showing, Esc returns to the page and drops the unfinished edit (End()
  // reverts it), so two presses always leave.
  OmniboxController* omnibox = location_bar_->GetOmniboxController();
  if (omnibox && omnibox->IsPopupOpen()) {
    return;
  }
  event->SetHandled();
  focus_page_.Run();
}

}  // namespace modal_browser
