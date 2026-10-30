// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SUGGESTIONS_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SUGGESTIONS_H_

#include <memory>
#include <string>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "components/omnibox/browser/autocomplete_controller.h"
#include "ui/base/page_transition_types.h"
#include "url/gurl.h"

class Profile;

namespace modal_browser {

// What the start page's field suggests while the user types: Chromium's
// own address-bar engine (history, bookmarks, open tabs and the search
// engine's suggestions), so the results match what Chromium would offer.
class MerlinSuggestions : public AutocompleteController::Observer {
 public:
  enum class Kind { kSearch, kUrl, kTab };

  struct Suggestion {
    Kind kind = Kind::kUrl;
    // A page title or a search; `detail` is the address, when there is one.
    std::u16string title;
    std::u16string detail;
    // Where choosing it goes, and how that is recorded in history.
    GURL destination;
    ui::PageTransition transition = ui::PAGE_TRANSITION_TYPED;
    // For the first suggestion: the rest of the text the field may complete
    // to ("be.com" after "youtu"). Empty for the others.
    std::u16string inline_completion;
  };

  using Callback =
      base::RepeatingCallback<void(const std::vector<Suggestion>&)>;

  // `on_results` runs each time the list changes; search suggestions
  // arrive a moment after local ones.
  MerlinSuggestions(Profile* profile, Callback on_results);
  MerlinSuggestions(const MerlinSuggestions&) = delete;
  MerlinSuggestions& operator=(const MerlinSuggestions&) = delete;
  ~MerlinSuggestions() override;

  // Starts suggesting for `text`. `prevent_inline` is set while the user
  // deletes, so the first suggestion does not complete what they removed.
  void Query(const std::u16string& text, bool prevent_inline);
  void Stop();

  const std::vector<Suggestion>& results() const { return results_; }

  // AutocompleteController::Observer:
  void OnResultChanged(AutocompleteController* controller,
                       bool default_match_changed) override;

 private:
  const raw_ptr<Profile> profile_;
  Callback on_results_;
  std::unique_ptr<AutocompleteController> controller_;
  std::vector<Suggestion> results_;
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SUGGESTIONS_H_
