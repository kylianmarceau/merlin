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
#include "base/memory/weak_ptr.h"
#include "components/omnibox/browser/autocomplete_controller.h"
#include "ui/base/page_transition_types.h"
#include "url/gurl.h"

class Profile;

namespace content {
class WebContents;
}

namespace modal_browser {

// What the start page's field suggests while the user types: Chromium's
// own address-bar engine (history, bookmarks, open tabs and the search
// engine's suggestions), so the results match what Chromium would offer.
//
// Like Chromium's address bar, it also gets the likely destination ready
// before Enter (see SetTarget): it connects to the site early, fetches the
// search results the engine hints at, and loads a page out of sight once
// the user has opened it this way often enough for Chromium's predictor to
// be confident. Chromium's "Preload pages" setting governs all of it.
class MerlinSuggestions : public AutocompleteController::Observer {
 public:
  enum class Kind { kSearch, kUrl, kTab };

  struct Suggestion {
    Kind kind = Kind::kUrl;
    // A page title or a search; `detail` is the address, when there is one.
    std::u16string title;
    std::u16string detail;
    // Where choosing it goes, and how that is recorded in history. The
    // transition is marked as from the address bar, as Chromium's are: a
    // page loaded ahead is only used for a navigation that says so.
    GURL destination;
    ui::PageTransition transition = ui::PageTransitionFromInt(
        ui::PAGE_TRANSITION_TYPED | ui::PAGE_TRANSITION_FROM_ADDRESS_BAR);
    // For the first suggestion: the rest of the text the field may complete
    // to ("be.com" after "youtu"). Empty for the others.
    std::u16string inline_completion;
    // Whether this is what Enter opens in Chromium's address bar.
    bool is_default = false;
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

  // The tab a chosen suggestion will open in, where the destination is
  // readied. Nothing is readied while it is unset or once it closes.
  void SetTarget(content::WebContents* contents);

  // Call just before opening `url` from this field, so Chromium's
  // predictor learns what this text leads to.
  void Opened(const GURL& url);

  const std::vector<Suggestion>& results() const { return results_; }

  // The suggestion Enter opens when the field shows `field_text`: the top
  // one, if it is the default and the field is what was typed plus its
  // completion. Null otherwise, or if the results are for older text.
  const Suggestion* DefaultFor(const std::u16string& field_text) const;

  // Addresses a field may open: not script or data the user did not mean
  // to run (typing javascript: does nothing, as in Chromium's field).
  static bool IsOpenable(const GURL& url);

  // The transition `transition` gets when opened from this field.
  static ui::PageTransition FromAddressBar(ui::PageTransition transition);

  // AutocompleteController::Observer:
  void OnResultChanged(AutocompleteController* controller,
                       bool default_match_changed) override;

 private:
  // Readies the default match in the target tab, as ChromeOmniboxClient
  // does in OnResultChanged and OnTextChanged.
  void Prepare(const AutocompleteResult& result, bool default_match_changed);

  const raw_ptr<Profile> profile_;
  Callback on_results_;
  std::unique_ptr<AutocompleteController> controller_;
  std::vector<Suggestion> results_;
  // What the user typed, without a completion; what the predictor learns.
  // Matches typed but never opened count as misses at the next Opened(),
  // as they do for Chromium's address bar.
  std::u16string text_;
  // Whether the predictor holds matches not yet learned from.
  bool learning_ = false;
  // Whether the predictor has yet to be asked about `text_`.
  bool recommend_ = false;
  base::WeakPtr<content::WebContents> target_;
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SUGGESTIONS_H_
