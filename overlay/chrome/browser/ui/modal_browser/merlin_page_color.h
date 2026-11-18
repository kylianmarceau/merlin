// Copyright 2026 The Merlin Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PAGE_COLOR_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PAGE_COLOR_H_

#include <optional>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "content/public/browser/web_contents_user_data.h"
#include "third_party/skia/include/core/SkColor.h"

class SkBitmap;

namespace modal_browser {

// The colour a page draws along its top edge, read from what is on screen,
// so the joined tab and toolbar continue the page. A page's theme-color often
// disagrees with what it draws: GitHub declares #1E2327 over a black header,
// and YouTube a light colour over its dark theme.
class PageEdgeColor : public content::WebContentsUserData<PageEdgeColor> {
 public:
  ~PageEdgeColor() override;

  // The colour most of the top edge has, once sampled.
  static std::optional<SkColor> Get(content::WebContents* contents);
  // Reads the top edge of the page on screen. `changed` runs when the
  // colour changes. Does nothing while the page is hidden or a read is out;
  // a read that finishes after the page has navigated is dropped. Called when
  // the page may have changed colour (it loaded, drew, changed theme-color,
  // came on screen or stopped scrolling), never on a timer.
  static void Sample(content::WebContents* contents, base::RepeatingClosure changed);
  // A new page committed: its first read replaces the colour, or clears it
  // when the new page's edge has no main colour. Until then the old colour
  // stays, so the toolbar doesn't flash.
  static void PageChanged(content::WebContents* contents);

  // The colour covering most of `bitmap`, if one covers enough of it.
  static std::optional<SkColor> MainColor(const SkBitmap& bitmap);

 private:
  explicit PageEdgeColor(content::WebContents* contents);
  friend class content::WebContentsUserData<PageEdgeColor>;

  void OnSampled(base::RepeatingClosure changed, std::optional<SkColor> color);

  std::optional<SkColor> color_;
  bool stale_ = false;
  bool reading_ = false;
  base::WeakPtrFactory<PageEdgeColor> weak_factory_{this};
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PAGE_COLOR_H_
