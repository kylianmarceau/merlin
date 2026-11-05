// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_CTRL_TAB_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_CTRL_TAB_H_

#include <memory>
#include <optional>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"
#include "chrome/browser/ui/modal_browser/overlay_host.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/tabs/public/tab_interface.h"

class BrowserView;
class BrowserWindowInterface;
class PrefService;

namespace modal_browser {

class CtrlTabView;

// Watches the keyboard while the Ctrl-Tab switcher is open, before the page
// or Chromium's shortcuts see it: an NSEvent local monitor on macOS
// (merlin_ctrl_tab_mac.mm). Callbacks are posted, never run inside the
// monitor.
class CtrlTabKeyWatch {
 public:
  enum class Key { kEscape, kReturn, kLeft, kRight, kUp, kDown };
  struct Callbacks {
    base::RepeatingClosure control_released;
    base::RepeatingCallback<void(Key)> key;
  };

  virtual ~CtrlTabKeyWatch() = default;

  // Null where unsupported; the switcher then switches at once.
  static std::unique_ptr<CtrlTabKeyWatch> Start(Callbacks callbacks);
  // Whether Control is held right now.
  static bool IsControlDown();
};

// Ctrl-Tab and Ctrl-Shift-Tab, as in Dia: a tap goes to the tab used last
// (or the next tab, in the "order" setting); holding Ctrl shows every tab
// as a card with its thumbnail, Tab and Shift-Tab move through them, and
// releasing Ctrl switches. Esc cancels; Return or a click switches at once.
//
// The order comes from Chromium's prefs::kCtrlTabMru ("most recently used"),
// on by default in Merlin; Settings > Browsing > Ctrl-Tab changes it, and
// Chromium's Tab > Select Next Tab menu item follows the same pref.
class CtrlTabSwitcher : public TabStripModelObserver {
 public:
  // Before the cards appear, so a quick tap never flashes them.
  static constexpr base::TimeDelta kShowDelay = base::Milliseconds(120);

  CtrlTabSwitcher(BrowserWindowInterface* browser, BrowserView* browser_view);
  CtrlTabSwitcher(const CtrlTabSwitcher&) = delete;
  CtrlTabSwitcher& operator=(const CtrlTabSwitcher&) = delete;
  ~CtrlTabSwitcher() override;

  // Sets Merlin's default for the order (most recently used); a choice in
  // Settings still wins.
  static void SetDefaultOrder(PrefService* prefs);
  // True: most recently used first. False: tab strip order.
  static bool RecentOrder(const PrefService* prefs);

  // Ctrl-Tab (forward) or Ctrl-Shift-Tab.
  void Cycle(bool forward);
  bool IsOpen() const { return open_; }
  // Switches to the selected tab and closes.
  void Commit();
  // Closes without switching.
  void Cancel();
  // Switches to the tab at `index` in the switcher's order (a click).
  void CommitIndex(int index);

  // The tabs in switcher order and the selected one, while open.
  std::vector<tabs::TabInterface*> tabs_for_testing() const;
  int selected_for_testing() const { return selected_; }
  bool cards_visible_for_testing() const;
  CtrlTabView* view_for_testing() { return view_; }
  void ShowCardsNowForTesting();
  // Pretends Control is (or is not) held; nullopt reads the keyboard.
  static void SetControlDownForTesting(std::optional<bool> down);

  // TabStripModelObserver:
  void OnTabStripModelChanged(
      TabStripModel* tab_strip_model,
      const TabStripModelChange& change,
      const TabStripSelectionChange& selection) override;
  void OnTabChangedAt(tabs::TabInterface* tab,
                      TabChangeType change_type) override;

 private:
  static bool ControlDown();
  // This window's tabs: most recently used first, or in strip order
  // starting at the active tab.
  std::vector<tabs::TabHandle> OrderedTabs() const;
  // order_'s tabs that are still in this window.
  std::vector<tabs::TabInterface*> LiveTabs() const;
  void Open(bool forward);
  void Move(int delta);
  void OnKey(CtrlTabKeyWatch::Key key);
  void CheckControl();
  void ShowCards();
  void UpdateCards();
  void Layout();
  void Close();
  void Activate(tabs::TabHandle handle);
  void TouchRecent(tabs::TabInterface* tab);

  const raw_ptr<BrowserWindowInterface> browser_;
  OverlayHost host_;
  raw_ptr<CtrlTabView> view_ = nullptr;
  // Most recently used first; tabs never activated in this window are not
  // listed and follow in strip order.
  std::vector<tabs::TabHandle> recent_;
  // While open: the tabs in switcher order, and the selected one.
  std::vector<tabs::TabHandle> order_;
  int selected_ = 0;
  bool open_ = false;
  base::OneShotTimer show_timer_;
  // Catches a Ctrl release the key watch misses (another app was in front).
  base::RepeatingTimer control_poll_;
  std::unique_ptr<CtrlTabKeyWatch> key_watch_;
  base::WeakPtrFactory<CtrlTabSwitcher> weak_factory_{this};
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_CTRL_TAB_H_
