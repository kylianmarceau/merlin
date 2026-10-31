// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TOOLBAR_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TOOLBAR_H_

#include <memory>
#include <optional>
#include <string>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/context_menu_controller.h"
#include "ui/views/controls/button/button.h"
#include "ui/views/view.h"
#include "ui/views/view_observer.h"

class BackForwardMenuModel;
class BrowserWindowInterface;

namespace content {
class WebContents;
}

namespace views {
class MenuRunner;
}

namespace modal_browser {

// Merlin's back, forward and reload buttons, which stand in for
// Chromium's in the toolbar row (redesign round 2, step 4). Thin
// strokes drawn here, a rounded-square hover, no ripple. Right-click on back
// or forward lists the history, as Chromium's buttons do on a long press.
class MerlinNavButton : public views::Button,
                         public views::ContextMenuController {
  METADATA_HEADER(MerlinNavButton, views::Button)

 public:
  enum class Kind { kBack, kForward, kReload };

  MerlinNavButton(BrowserWindowInterface* browser, Kind kind);
  MerlinNavButton(const MerlinNavButton&) = delete;
  MerlinNavButton& operator=(const MerlinNavButton&) = delete;
  ~MerlinNavButton() override;

  // Reload turns into stop while the page loads.
  void SetLoading(bool loading);
  // The color behind the button (the page's, see PageColorSampler), or
  // nullopt for the toolbar's own; icons take a color that reads on it.
  void SetSurface(std::optional<SkColor> surface);
  bool loading() const { return loading_; }

  // views::Button:
  gfx::Size CalculatePreferredSize(
      const views::SizeBounds& available_size) const override;
  void PaintButtonContents(gfx::Canvas* canvas) override;
  void StateChanged(ButtonState old_state) override;

 private:
  void OnPressed(const ui::Event& event);
  void UpdateTooltip();

  // views::ContextMenuController:
  void ShowContextMenuForViewImpl(
      views::View* source,
      const gfx::Point& point,
      ui::mojom::MenuSourceType source_type) override;

  const raw_ptr<BrowserWindowInterface> browser_;
  const Kind kind_;
  bool loading_ = false;
  std::optional<SkColor> surface_;
  std::unique_ptr<BackForwardMenuModel> menu_model_;
  std::unique_ptr<views::MenuRunner> menu_runner_;
};

// The address of the page, written on the toolbar row with no box around
// it, as in Dia: "github.com / neovim/neovim: Vim-fork…", the site in full
// color and the page title dimmed (the path when there is no title). Shown
// on sites, hidden on the start page, which has its own field. Not an
// editor itself: clicking it (or ⌘L) puts Chromium's field, with its
// suggestions, in its place (MerlinAddressEditor). "Not secure" or
// "Dangerous" at the left opens the site's page info.
class MerlinAddressField : public views::Button {
  METADATA_HEADER(MerlinAddressField, views::Button)

 public:
  MerlinAddressField(base::RepeatingClosure edit_address,
                      base::RepeatingClosure show_site_info);
  MerlinAddressField(const MerlinAddressField&) = delete;
  MerlinAddressField& operator=(const MerlinAddressField&) = delete;
  ~MerlinAddressField() override;

  // Reads the address, title and security state of `contents`.
  void Update(content::WebContents* contents);
  // As MerlinNavButton::SetSurface.
  void SetSurface(std::optional<SkColor> surface);

  const std::u16string& host_for_testing() const { return host_; }
  const std::u16string& rest_for_testing() const { return rest_; }

  // views::Button:
  gfx::Size CalculatePreferredSize(
      const views::SizeBounds& available_size) const override;
  void PaintButtonContents(gfx::Canvas* canvas) override;
  void StateChanged(ButtonState old_state) override;

 private:
  enum class Security { kNone, kSecure, kNotSecure, kDangerous };

  void OnPressed(const ui::Event& event);
  // The lock or warning chip at the left; empty when there is none.
  gfx::Rect SiteInfoBounds() const;
  std::u16string ChipText() const;

  base::RepeatingClosure edit_address_;
  base::RepeatingClosure show_site_info_;
  std::u16string host_;
  std::u16string rest_;
  std::u16string title_;
  Security security_ = Security::kNone;
  std::optional<SkColor> surface_;
};

// The page's color behind the toolbar row (PageColorSampler), so the
// toolbar, the active tab and the page read as one surface, as in Dia.
// Chromium requires the toolbar to keep its own background object, which
// only takes theme colors, so this is the first child of the toolbar,
// painted over that background and under the buttons, in the same rounded
// shape. With no color it draws nothing and the theme's toolbar shows.
class MerlinToolbarBackdrop : public views::View, public views::ViewObserver {
  METADATA_HEADER(MerlinToolbarBackdrop, views::View)

 public:
  MerlinToolbarBackdrop();
  MerlinToolbarBackdrop(const MerlinToolbarBackdrop&) = delete;
  MerlinToolbarBackdrop& operator=(const MerlinToolbarBackdrop&) = delete;
  ~MerlinToolbarBackdrop() override;

  // Puts a backdrop under `toolbar`'s children, or returns the one there.
  static MerlinToolbarBackdrop* InstallIn(views::View* toolbar);

  void SetColor(std::optional<SkColor> color);
  // Edge to edge with square corners, over a page with no card (tabs
  // hidden).
  void SetFullBleed(bool on);

  // views::View:
  void OnPaint(gfx::Canvas* canvas) override;
  void AddedToWidget() override;
  void RemovedFromWidget() override;

  // views::ViewObserver (the toolbar):
  void OnViewBoundsChanged(views::View* observed_view) override;

 private:
  std::optional<SkColor> color_;
  bool full_bleed_ = false;
  bool observing_ = false;
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TOOLBAR_H_
