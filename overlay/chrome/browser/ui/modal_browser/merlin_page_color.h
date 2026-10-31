// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PAGE_COLOR_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PAGE_COLOR_H_

#include <optional>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/weak_document_ptr.h"
#include "third_party/skia/include/core/SkColor.h"

namespace modal_browser {

// The majority color of the active page, so the active tab and the
// toolbar can take it and read as one surface with the page (white above
// a white site, black above a black one), as in Dia.
//
// It reads the pixels the page has drawn: the visible viewport, scaled down,
// and takes the most common color in it. It reads when the page loads and
// paints for the first time, then leaves it alone — scrolling does not
// change the color, so the bar does not flicker as the page moves. The
// last color is kept per document, so switching back to a tab shows its color
// at once. Nothing leaves the browser; see docs/PRIVACY.md.
class PageColorSampler : public content::WebContentsObserver {
 public:
  // Called with the active page's color, or nullopt when there is none yet
  // (Merlin's own toolbar color applies).
  using Callback = base::RepeatingCallback<void(std::optional<SkColor>)>;

  explicit PageColorSampler(Callback on_color);
  PageColorSampler(const PageColorSampler&) = delete;
  PageColorSampler& operator=(const PageColorSampler&) = delete;
  ~PageColorSampler() override;

  // Follows `contents` (the active tab); reports its last known color now.
  void Watch(content::WebContents* contents);
  std::optional<SkColor> color() const { return color_; }

  // Reads the page again now.
  void Sample();

  // The most common color in `bitmap`, ignoring transparent pixels.
  static std::optional<SkColor> DominantColor(const SkBitmap& bitmap);

  // content::WebContentsObserver:
  void DidFirstVisuallyNonEmptyPaint() override;
  void DidStopLoading() override;
  void PrimaryPageChanged(content::Page& page) override;
  void WebContentsDestroyed() override;

 private:
  friend struct PageColorSamplerTestPeer;
  void SampleSoon();
  void OnSampled(content::WeakDocumentPtr document,
                 const content::CopyFromSurfaceResult& result);
  void SetColor(std::optional<SkColor> color);

  Callback on_color_;
  std::optional<SkColor> color_;
  base::OneShotTimer soon_;
  bool sampling_ = false;
  base::WeakPtrFactory<PageColorSampler> weak_factory_{this};
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PAGE_COLOR_H_
