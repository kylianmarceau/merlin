// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_HINT_OVERLAY_VIEW_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_HINT_OVERLAY_VIEW_H_

#include <string>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "chrome/browser/ui/modal_browser/overlay_host.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/gfx/geometry/point.h"
#include "ui/views/view.h"

class BrowserView;

namespace modal_browser {

struct HintPlacement {
  std::u16string label;
  // Top-left of the target, in DIPs relative to the web contents view.
  gfx::Point anchor;
};

// Draws link-hint labels over the page. Drawn by the browser, not injected
// into the page, so pages can neither see nor restyle them. Clicks pass
// through to the page.
class HintOverlayView : public views::View {
  METADATA_HEADER(HintOverlayView, views::View)

 public:
  HintOverlayView();
  HintOverlayView(const HintOverlayView&) = delete;
  HintOverlayView& operator=(const HintOverlayView&) = delete;
  ~HintOverlayView() override;

  void SetHints(std::vector<HintPlacement> hints);
  void SetTyped(std::u16string typed);
  // Labels that still match what was typed.
  std::vector<std::u16string> VisibleLabels() const;
  // Where a label is drawn, in this view's coordinates (for tests).
  gfx::Rect LabelBounds(const HintPlacement& hint) const;

  // views::View:
  void OnPaint(gfx::Canvas* canvas) override;
  void OnThemeChanged() override;

 private:
  std::vector<HintPlacement> hints_;
  std::u16string typed_;
};

// Owns the hint widget, which covers exactly the active web contents.
class HintHost {
 public:
  explicit HintHost(BrowserView* browser_view);
  HintHost(const HintHost&) = delete;
  HintHost& operator=(const HintHost&) = delete;
  ~HintHost();

  void Show(std::vector<HintPlacement> hints);
  void Filter(std::u16string typed);
  void Hide();
  bool IsVisible() const;

  HintOverlayView* view_for_testing() { return view_; }

 private:
  OverlayHost host_;
  raw_ptr<HintOverlayView> view_ = nullptr;
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_HINT_OVERLAY_VIEW_H_
