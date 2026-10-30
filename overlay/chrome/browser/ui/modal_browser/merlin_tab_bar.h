// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TAB_BAR_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TAB_BAR_H_

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/split_tabs/split_tab_id.h"
#include "components/tabs/public/tab_alert.h"
#include "components/tabs/public/tab_interface.h"
#include "components/tabs/public/tab_network_state.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/base/models/image_model.h"
#include "ui/gfx/animation/slide_animation.h"
#include "ui/menus/simple_menu_model.h"
#include "ui/views/animation/animation_delegate_views.h"
#include "ui/views/animation/bounds_animator.h"
#include "ui/views/context_menu_controller.h"
#include "ui/views/controls/button/button.h"
#include "ui/views/view.h"
#include "ui/views/view_observer.h"

class BrowserView;
class BrowserWindowInterface;
class TabStripModel;

namespace gfx {
class RenderText;
}

namespace views {
class MenuRunner;
}

namespace modal_browser {

class MerlinTabBar;

// What one tab shows, read from the tab strip model.
struct MerlinTabData {
  std::u16string title;
  ui::ImageModel favicon;
  bool show_favicon = true;
  bool themify_favicon = false;
  bool crashed = false;
  bool discarded = false;
  tabs::TabNetworkState network_state = tabs::TabNetworkState::kNone;
  std::optional<tabs::TabAlert> alert;
  bool pinned = false;
  bool active = false;
  std::optional<split_tabs::SplitTabId> split;
};

// One tab, after Dia's: the active tab is cut from the toolbar (the bar
// paints its shape, which flares into the toolbar); the others sit flat on
// the frame and take a rounded fill on hover. Favicon (or a spinner while
// loading), the audio icon, the title fading out at its end, and × on hover.
class MerlinTab : public views::View, public views::AnimationDelegateViews {
  METADATA_HEADER(MerlinTab, views::View)

 public:
  MerlinTab(MerlinTabBar* bar, tabs::TabHandle handle);
  MerlinTab(const MerlinTab&) = delete;
  MerlinTab& operator=(const MerlinTab&) = delete;
  ~MerlinTab() override;

  tabs::TabHandle handle() const { return handle_; }
  const MerlinTabData& data() const { return data_; }
  void SetData(MerlinTabData data);

  // Split partners draw as one joined pill: which side this tab is on.
  enum class Join { kNone, kLeft, kRight };
  void SetJoin(Join join);

  // Repaints the spinner; true while it still needs frames.
  bool AdvanceLoadingAnimation(base::TimeDelta elapsed);
  bool loading() const;

  // Being dragged: drawn above the others, no hover change.
  void SetDragging(bool dragging);
  bool dragging() const { return dragging_; }

  // Closing: animates out, no longer reacts to the mouse.
  void SetClosing();
  bool closing() const { return closing_; }

  // views::View:
  void OnPaint(gfx::Canvas* canvas) override;
  bool OnMousePressed(const ui::MouseEvent& event) override;
  bool OnMouseDragged(const ui::MouseEvent& event) override;
  void OnMouseReleased(const ui::MouseEvent& event) override;
  void OnMouseCaptureLost() override;
  void OnMouseEntered(const ui::MouseEvent& event) override;
  void OnMouseMoved(const ui::MouseEvent& event) override;
  void OnMouseExited(const ui::MouseEvent& event) override;
  std::u16string GetRenderedTooltipText(const gfx::Point& p) const override;
  void OnBoundsChanged(const gfx::Rect& previous_bounds) override;
  void OnThemeChanged() override;

  // views::AnimationDelegateViews:
  void AnimationProgressed(const gfx::Animation* animation) override;

  gfx::Rect CloseButtonBoundsForTesting() const { return CloseBounds(); }

 private:
  // The tab's body inside the view's bounds (on top, the view is as tall
  // as the bar; in the sidebar, the view is the row).
  gfx::Rect PillBounds() const;
  bool Vertical() const;
  gfx::Rect CloseBounds() const;
  gfx::Rect AlertBounds() const;
  bool ShowsClose() const;
  bool ShowsTitle() const;
  // Active, or the other half of a split pair with the active tab.
  bool Highlighted() const;
  // Title and icon color: on the page's color when highlighted.
  SkColor TextColor() const;
  void PaintBackground(gfx::Canvas* canvas, const gfx::Rect& pill);
  void PaintIcon(gfx::Canvas* canvas, const gfx::Rect& icon);
  void PaintClose(gfx::Canvas* canvas, const gfx::Rect& close);
  void PaintAlert(gfx::Canvas* canvas, const gfx::Rect& alert);
  void UpdateAccessibleName();
  void SetCloseHovered(bool hovered);

  const raw_ptr<MerlinTabBar> bar_;
  const tabs::TabHandle handle_;
  MerlinTabData data_;
  Join join_ = Join::kNone;
  gfx::SlideAnimation hover_animation_{this};
  std::unique_ptr<gfx::RenderText> title_text_;
  base::TimeDelta loading_elapsed_;
  bool close_hovered_ = false;
  bool close_pressed_ = false;
  bool dragging_ = false;
  bool closing_ = false;
  // Where a press started, for telling a click from a drag.
  std::optional<gfx::Point> press_point_;
};

// The "+" at the end of the tabs; in the sidebar, a "New tab" row.
class MerlinNewTabButton : public views::Button {
  METADATA_HEADER(MerlinNewTabButton, views::Button)

 public:
  explicit MerlinNewTabButton(PressedCallback callback);
  MerlinNewTabButton(const MerlinNewTabButton&) = delete;
  MerlinNewTabButton& operator=(const MerlinNewTabButton&) = delete;
  ~MerlinNewTabButton() override;

  // views::Button:
  void PaintButtonContents(gfx::Canvas* canvas) override;
  void StateChanged(ButtonState old_state) override;
};

// Merlin's tab bar: it stands in for Chromium's horizontal tab strip, laid
// over it in the same row (ModalBrowserController keeps their bounds equal
// and makes Chromium's transparent). Every action goes through the tab
// strip model, as Chromium's own tabs do: click to select, middle-click or
// × to close, drag to reorder, right-click for Chromium's tab menu.
//
// Its empty space is window caption (drag to move the window, double-click
// to zoom); the tabs and the + are client area. Patch 0011 lets
// BrowserView::NonClientHitTest ask views::kHitTestComponentKey, which this
// bar and its tabs set.
class MerlinTabBar : public views::View,
                     public TabStripModelObserver,
                     public views::ContextMenuController,
                     public ui::SimpleMenuModel::Delegate {
  METADATA_HEADER(MerlinTabBar, views::View)

 public:
  explicit MerlinTabBar(BrowserWindowInterface* browser);
  MerlinTabBar(const MerlinTabBar&) = delete;
  MerlinTabBar& operator=(const MerlinTabBar&) = delete;
  ~MerlinTabBar() override;

  // Left inset, so tabs start after the window's traffic lights.
  void SetLeadingInset(int inset);

  // Sidebar mode: tabs are rows in a column, starting `top_inset` down
  // (below the traffic lights, level with the page).
  void SetVertical(bool vertical, int top_inset);
  bool vertical() const { return vertical_; }

  // The active page's color (PageColorSampler), which the active tab takes
  // so it runs on into the toolbar and the page; nullopt for the toolbar's
  // own color.
  void SetActiveColor(std::optional<SkColor> color);
  // What the active tab is filled with.
  SkColor ActiveFill() const;

  // Called by tabs.
  void ActivateTab(MerlinTab* tab);
  void CloseTab(MerlinTab* tab);
  void ToggleMute(MerlinTab* tab);
  // `pos_in_bar` and `grab_offset` are along the bar's axis (x on top, y in
  // the sidebar).
  void DragTab(MerlinTab* tab, int pos_in_bar, int grab_offset);
  void EndDrag(bool cancel);
  // Deletes a tab view that finished animating out.
  void RemoveClosedTab(tabs::TabHandle handle);

  const std::vector<raw_ptr<MerlinTab>>& tabs_for_testing() const {
    return tabs_;
  }
  views::View* new_tab_button_for_testing() { return new_tab_button_; }

  // views::View:
  void Layout(PassKey) override;
  void OnBoundsChanged(const gfx::Rect& previous_bounds) override;
  void OnPaint(gfx::Canvas* canvas) override;
  void OnThemeChanged() override;
  bool OnMouseWheel(const ui::MouseWheelEvent& event) override;

  // TabStripModelObserver:
  void OnTabStripModelChanged(
      TabStripModel* tab_strip_model,
      const TabStripModelChange& change,
      const TabStripSelectionChange& selection) override;
  void OnTabChangedAt(tabs::TabInterface* tab,
                      TabChangeType change_type) override;
  void OnTabPinnedStateChanged(tabs::TabInterface* tab, int index) override;
  void OnSplitTabChanged(const SplitTabChange& change) override;

  // views::ContextMenuController:
  void ShowContextMenuForViewImpl(
      views::View* source,
      const gfx::Point& point,
      ui::mojom::MenuSourceType source_type) override;

  // ui::SimpleMenuModel::Delegate:
  bool IsCommandIdChecked(int command_id) const override;
  bool IsCommandIdEnabled(int command_id) const override;
  void ExecuteCommand(int command_id, int event_flags) override;

 private:
  // Matches the tab views to the model: reuses views by tab, adds new ones,
  // animates removed ones out, then lays everything out.
  void Rebuild();
  void UpdateTab(tabs::TabInterface* tab);
  MerlinTabData DataFor(tabs::TabInterface* tab, int index) const;
  // Target bounds for every live tab and the + button, in model order.
  struct Slots {
    std::vector<gfx::Rect> tabs;
    gfx::Rect new_tab;
  };
  Slots ComputeSlots() const;
  Slots ComputeRowSlots(const std::vector<MerlinTab*>& order) const;
  // The pinned tabs' capsule around `tabs`' bounds; empty without any.
  gfx::Rect CapsuleBounds() const;
  void LayoutTabs(bool animate);
  std::optional<int> IndexOf(const MerlinTab* tab) const;
  void UpdateLoadingTimer();
  void OnLoadingTimer();
  void NewTab();

  const raw_ptr<BrowserWindowInterface> browser_;
  const raw_ptr<TabStripModel> model_;
  // Live tabs in model order; closing ones are only children.
  std::vector<raw_ptr<MerlinTab>> tabs_;
  raw_ptr<MerlinNewTabButton> new_tab_button_ = nullptr;
  views::BoundsAnimator bounds_animator_{this};
  int leading_inset_ = 0;
  bool vertical_ = false;
  int top_inset_ = 0;
  // Sidebar: how far the rows are scrolled up, when they do not fit.
  int scroll_ = 0;  // in rows
  int max_scroll_ = 0;
  int wheel_remainder_ = 0;
  // Set while laying out after a model change: scroll the active row into
  // view.
  bool reveal_active_ = false;
  std::optional<SkColor> active_color_;
  bool laid_out_once_ = false;

  // Drag to reorder.
  raw_ptr<MerlinTab> drag_tab_ = nullptr;
  int drag_target_index_ = 0;

  // Spinner frames while any tab loads.
  base::RepeatingTimer loading_timer_;
  base::TimeTicks loading_start_;

  // Chromium's tab menu, for the tab it was opened on.
  std::optional<tabs::TabHandle> menu_tab_;
  std::unique_ptr<ui::SimpleMenuModel> menu_model_;
  std::unique_ptr<views::MenuRunner> menu_runner_;

  base::WeakPtrFactory<MerlinTabBar> weak_factory_{this};
};

// Puts Merlin's tab bar over Chromium's tab strip, on top or in the
// sidebar, and keeps it there: same bounds, Chromium's strip transparent
// and deaf to the mouse underneath (it stays in the layout, so the window
// keeps its shape and bubbles can still anchor to it). In fullscreen,
// where Chromium moves its strip into a separate widget, Merlin's bar
// hides and Chromium's comes back.
class MerlinTabBarHost : public views::ViewObserver {
 public:
  MerlinTabBarHost(BrowserWindowInterface* browser, BrowserView* browser_view);
  MerlinTabBarHost(const MerlinTabBarHost&) = delete;
  MerlinTabBarHost& operator=(const MerlinTabBarHost&) = delete;
  ~MerlinTabBarHost() override;

  // Re-checks where Chromium's strip is; cheap, call after layout changes.
  void Update();

  MerlinTabBar* bar() { return bar_; }

  // views::ViewObserver (Chromium's tab strip region):
  void OnViewBoundsChanged(views::View* observed_view) override;
  void OnViewVisibilityChanged(views::View* observed_view,
                               views::View* starting_view,
                               bool visible) override;
  void OnViewAddedToWidget(views::View* observed_view) override;
  void OnViewRemovedFromWidget(views::View* observed_view) override;
  void OnViewIsDeleting(views::View* observed_view) override;

 private:
  void SetChromiumStripHidden(bool hidden);

  const raw_ptr<BrowserWindowInterface> browser_;
  const raw_ptr<BrowserView> browser_view_;
  raw_ptr<MerlinTabBar> bar_ = nullptr;
  raw_ptr<views::View> region_ = nullptr;
  bool region_hidden_ = false;
  bool updating_ = false;
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TAB_BAR_H_
