// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TOOLBAR_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TOOLBAR_H_

#include <memory>
#include <string>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/context_menu_controller.h"
#include "ui/views/controls/button/button.h"
#include "ui/views/view.h"

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
  std::unique_ptr<BackForwardMenuModel> menu_model_;
  std::unique_ptr<views::MenuRunner> menu_runner_;
};

// The address of the page, shown in the toolbar row on sites and hidden on
// the start page, which has its own field. Not an editor: clicking it (or
// ⌘L) opens the palette with the address filled in, which is Merlin's
// address dropdown. The host is in full color and the rest dimmed; a lock,
// "Not secure" or "Dangerous" at the left opens the site's page info.
class MerlinAddressField : public views::Button {
  METADATA_HEADER(MerlinAddressField, views::Button)

 public:
  MerlinAddressField(base::RepeatingClosure edit_address,
                      base::RepeatingClosure show_site_info);
  MerlinAddressField(const MerlinAddressField&) = delete;
  MerlinAddressField& operator=(const MerlinAddressField&) = delete;
  ~MerlinAddressField() override;

  // Reads the address and security state of `contents`.
  void Update(content::WebContents* contents);

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
  Security security_ = Security::kNone;
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TOOLBAR_H_
