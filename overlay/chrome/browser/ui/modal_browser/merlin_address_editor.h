// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_ADDRESS_EDITOR_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_ADDRESS_EDITOR_H_

#include <map>
#include <memory>
#include <string>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/task/cancelable_task_tracker.h"
#include "chrome/browser/ui/modal_browser/merlin_suggestions.h"
#include "chrome/browser/ui/modal_browser/overlay_host.h"
#include "ui/base/window_open_disposition.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/views/controls/textfield/textfield_controller.h"
#include "ui/views/focus/focus_manager.h"
#include "url/gurl.h"

class BrowserView;
class BrowserWindowInterface;

namespace favicon_base {
struct FaviconImageResult;
}

namespace views {
class View;
}

namespace modal_browser {

class MerlinAddressCard;

// Editing the address, Merlin's way. Clicking the address (or ⌘L) lifts it
// into a card that opens over it: the address, selected, at the same place
// the toolbar showed it, and below it what Chromium's address-bar engine
// suggests (merlin_suggestions.h): searches, pages from history and
// bookmarks, open tabs. It completes in place as you type, as Chromium's
// field does. ↑/↓ pick a row, Enter opens it (⌥ or ⌘ for a new tab), Tab
// accepts the completion, Esc or a click on the page closes the card.
class MerlinAddressEditor : public views::TextfieldController,
                            public views::FocusChangeListener {
 public:
  // `field` is Merlin's address field, which the card opens over.
  // `on_end` runs after editing ends. `focus_page` gives keyboard focus
  // back to the page.
  MerlinAddressEditor(BrowserView* browser_view,
                      BrowserWindowInterface* browser,
                      views::View* field,
                      base::RepeatingClosure on_end,
                      base::RepeatingClosure focus_page);
  MerlinAddressEditor(const MerlinAddressEditor&) = delete;
  MerlinAddressEditor& operator=(const MerlinAddressEditor&) = delete;
  ~MerlinAddressEditor() override;

  void Begin();
  void End();
  bool editing() const { return editing_; }

  // Called by the card.
  void OpenRow(int index, WindowOpenDisposition disposition);
  void SelectRow(int index);

  // views::TextfieldController:
  void ContentsChanged(views::Textfield* sender,
                       const std::u16string& new_contents) override;
  bool HandleKeyEvent(views::Textfield* sender,
                      const ui::KeyEvent& key_event) override;

  // views::FocusChangeListener:
  void OnDidChangeFocus(views::View* focused_before,
                        views::View* focused_now) override;

  MerlinAddressCard* card_for_testing() { return card_; }

 private:
  void OnResults(const std::vector<MerlinSuggestions::Suggestion>& results);
  void UpdateCard();
  void Layout();
  // What Enter opens with no row picked: the text as Chromium's field would
  // read it (an address, or a search with the default engine).
  void OpenTyped(WindowOpenDisposition disposition);
  void Open(GURL url,
            ui::PageTransition transition,
            WindowOpenDisposition disposition);
  void FetchIcon(const GURL& page_url);
  void OnIcon(GURL page_url, const favicon_base::FaviconImageResult& result);
  void StopWatching();

  const raw_ptr<BrowserView> browser_view_;
  const raw_ptr<BrowserWindowInterface> browser_;
  const raw_ptr<views::View> field_;
  base::RepeatingClosure on_end_;
  base::RepeatingClosure focus_page_;

  OverlayHost host_;
  raw_ptr<MerlinAddressCard> card_ = nullptr;
  std::unique_ptr<MerlinSuggestions> suggestions_;
  std::vector<MerlinSuggestions::Suggestion> results_;
  // What the user typed, without the completion shown after it.
  std::u16string typed_;
  // Row ↑/↓ picked; -1 until then (Enter then reads the text).
  int selected_ = -1;
  bool deleting_ = false;
  bool setting_text_ = false;
  bool editing_ = false;
  raw_ptr<views::FocusManager> focus_manager_ = nullptr;

  std::map<GURL, gfx::ImageSkia> icons_;
  base::CancelableTaskTracker icon_tracker_;
  base::WeakPtrFactory<MerlinAddressEditor> weak_factory_{this};
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_ADDRESS_EDITOR_H_
