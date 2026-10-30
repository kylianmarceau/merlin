// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_ADDRESS_EDITOR_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_ADDRESS_EDITOR_H_

#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "ui/events/event_handler.h"
#include "ui/views/focus/focus_manager.h"

class LocationBarView;

namespace views {
class View;
}

namespace modal_browser {

// Editing the address in place. Merlin's address field only shows the
// address; clicking it (or ⌘L) puts Chromium's own field, with its
// suggestions, in the toolbar row in its place, focused and selected. When
// focus leaves it (a page loads, the user clicks the page, Esc once the
// suggestions are closed), Merlin's field comes back.
class MerlinAddressEditor : public views::FocusChangeListener,
                            public ui::EventHandler {
 public:
  // `merlin_views` are hidden while editing (Merlin's field and the spacers
  // that center it). `on_end` runs after editing ends, to show them again.
  // `focus_page` gives keyboard focus back to the page.
  MerlinAddressEditor(LocationBarView* location_bar,
                      std::vector<views::View*> merlin_views,
                      base::RepeatingClosure on_end,
                      base::RepeatingClosure focus_page);
  MerlinAddressEditor(const MerlinAddressEditor&) = delete;
  MerlinAddressEditor& operator=(const MerlinAddressEditor&) = delete;
  ~MerlinAddressEditor() override;

  void Begin();
  void End();
  bool editing() const { return editing_; }

  // views::FocusChangeListener:
  void OnDidChangeFocus(views::View* focused_before,
                        views::View* focused_now) override;

  // ui::EventHandler (keys inside Chromium's field):
  void OnKeyEvent(ui::KeyEvent* event) override;

 private:
  void StopWatching();

  const raw_ptr<LocationBarView> location_bar_;
  std::vector<raw_ptr<views::View>> merlin_views_;
  base::RepeatingClosure on_end_;
  base::RepeatingClosure focus_page_;
  raw_ptr<views::FocusManager> focus_manager_ = nullptr;
  bool editing_ = false;
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_ADDRESS_EDITOR_H_
