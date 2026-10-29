// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_OVERLAY_HOST_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_OVERLAY_HOST_H_

#include <memory>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/scoped_observation.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_delegate.h"
#include "ui/views/widget/widget_observer.h"

class BrowserView;

namespace modal_browser {

// Owns one floating child widget over the browser's web contents: the
// palette, the status pill or the hint layer. Configured like FindBarHost
// (chrome/browser/ui/views/find_bar_host.cc): a translucent TYPE_CONTROL
// child that is never activatable, so the browser window stays the key
// window on macOS. It copies the browser window's theme.
//
// The widget is created on first use: hosts are built while BrowserView is
// still being constructed, before its widget exists.
class OverlayHost : public views::WidgetDelegate, public views::WidgetObserver {
 public:
  struct Options {
    const char* name = "ModalBrowserOverlay";
    // False for layers that must never take clicks (status, hints): clicks
    // fall through to the page.
    bool accept_events = true;
  };

  OverlayHost(BrowserView* browser_view, Options options);
  OverlayHost(const OverlayHost&) = delete;
  OverlayHost& operator=(const OverlayHost&) = delete;
  ~OverlayHost() override;

  // Creates the widget with `contents` if needed. Returns the contents view,
  // or null while the browser widget does not exist yet.
  views::View* EnsureWidget(base::OnceCallback<std::unique_ptr<views::View>()>
                                make_contents);

  // The active web contents' bounds in the browser widget's coordinates,
  // which is the coordinate space of this child widget's bounds.
  gfx::Rect ContentsArea() const;

  void ShowAt(const gfx::Rect& bounds_in_parent);
  void Hide();
  bool IsVisible() const;

  // Called when the browser window moves or resizes, so hosts can re-anchor.
  void set_on_parent_bounds_changed(base::RepeatingClosure callback) {
    on_parent_bounds_changed_ = std::move(callback);
  }

  views::Widget* widget() { return widget_.get(); }
  BrowserView* browser_view() { return browser_view_; }

  // views::WidgetObserver (the browser widget):
  void OnWidgetBoundsChanged(views::Widget* widget,
                             const gfx::Rect& new_bounds) override;
  void OnWidgetDestroying(views::Widget* widget) override;

 private:
  const raw_ptr<BrowserView> browser_view_;
  const Options options_;
  std::unique_ptr<views::Widget> widget_;
  base::RepeatingClosure on_parent_bounds_changed_;
  base::ScopedObservation<views::Widget, views::WidgetObserver>
      browser_widget_observation_{this};
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_OVERLAY_HOST_H_
