// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_STATUS_VIEW_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_STATUS_VIEW_H_

#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/scoped_observation.h"
#include "base/timer/timer.h"
#include "chrome/browser/ui/modal_browser/modal_input_router.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/browser/ui/modal_browser/overlay_host.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/view.h"
#include "ui/views/view_observer.h"

class BrowserView;

namespace modal_browser {

// The bottom-left status: a pill with the mode, pending keys and the latest
// message, and above it a panel listing either what a pending prefix can
// continue with (which-key) or a multi-line message such as `:help open`.
// Painted by hand so its look is fully ours; text stays readable in light
// and dark themes. Never takes clicks.
class StatusView : public views::View {
  METADATA_HEADER(StatusView, views::View)

 public:
  struct State {
    ffi::Mode mode = ffi::Mode::Normal;
    std::u16string indicator;
    std::u16string pending;
    std::u16string message;
    bool message_is_error = false;
    std::vector<std::pair<std::u16string, std::u16string>> which_key;
    bool show_which_key = false;
    // Bar mode: the full-width status bar under the page card
    // (redesign step 5). Off, the view is the floating pill.
    bool bar = false;
    std::u16string workspace;
    std::u16string title;
    // Shown at the right of the bar instead of the key hints: the page's
    // address, when the tabs are in the sidebar and there is no address
    // field at the top.
    std::u16string url;
    // Running downloads ("↓ 2 · 45%"), at the far right of the bar.
    std::u16string downloads;
  };

  StatusView();
  StatusView(const StatusView&) = delete;
  StatusView& operator=(const StatusView&) = delete;
  ~StatusView() override;

  void SetState(State state);
  const State& state() const { return state_; }
  // False when there is nothing worth showing (Normal mode, no keys, no
  // message).
  bool HasContent() const;
  static bool HasContent(const State& state);
  bool PanelVisible() const;

  // views::View:
  gfx::Size CalculatePreferredSize(
      const views::SizeBounds& available_size) const override;
  void OnPaint(gfx::Canvas* canvas) override;
  void OnThemeChanged() override;

 private:
  std::vector<std::u16string> PanelLines() const;
  gfx::Size PillSize() const;
  gfx::Size PanelSize() const;
  void PaintPanel(gfx::Canvas* canvas,
                  const gfx::Rect& panel,
                  const style::Colors& colors);
  void PaintBar(gfx::Canvas* canvas, const gfx::Rect& bar, bool dark);

  State state_;
};

// Owns the status widget. With the page card on, it keeps the page inset
// as a rounded card and docks the bar in the space under it; otherwise
// (fullscreen, upstream defaults) it keeps the pill in the bottom-left
// corner of the active web contents.
class StatusHost : public views::ViewObserver {
 public:
  explicit StatusHost(BrowserView* browser_view);
  StatusHost(const StatusHost&) = delete;
  StatusHost& operator=(const StatusHost&) = delete;
  ~StatusHost() override;

  void UpdateStatus(ffi::Mode mode,
                    std::u16string indicator,
                    std::u16string pending,
                    std::vector<std::pair<std::u16string, std::u16string>>
                        which_key);
  void ShowMessage(std::u16string text, bool is_error);
  void ClearMessage();
  // Hide while the palette shows the same information.
  void SetSuppressed(bool suppressed);
  // Turns the page card and the status bar on.
  void SetCardMode(bool on);
  // What the bar shows about the window: workspace, page title and, in
  // sidebar mode, the address.
  void SetContext(std::u16string workspace,
                  std::u16string title,
                  std::u16string url);
  // Running downloads; empty hides the indicator.
  void SetDownloads(std::u16string text);
  // Re-anchors after the browser layout changed (tab strip moved, window
  // entered or left fullscreen).
  void Relayout();
  bool card_mode() const { return card_mode_; }

  // views::ViewObserver (the page area):
  void OnViewBoundsChanged(views::View* observed_view) override;
  void OnViewIsDeleting(views::View* observed_view) override;

  StatusView* view_for_testing() { return view_; }
  views::Widget* widget_for_testing() { return host_.widget(); }

 private:
  void Apply();
  void Layout();
  // Whether the card and bar show right now: card mode and not fullscreen.
  bool BarActive();
  void UpdateCard();

  OverlayHost host_;
  bool card_mode_ = false;
  raw_ptr<StatusView> view_ = nullptr;
  StatusView::State state_;
  bool suppressed_ = false;
  base::OneShotTimer which_key_timer_;
  base::ScopedObservation<views::View, views::ViewObserver>
      contents_observation_{this};
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_STATUS_VIEW_H_
