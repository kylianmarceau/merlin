// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TAB_SWITCHER_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TAB_SWITCHER_H_

#include <memory>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"
#include "base/values.h"
#include "components/tabs/public/tab_interface.h"

class BrowserWindowInterface;

namespace modal_browser {

// Ctrl-Tab and Ctrl-Shift-Tab in a React window. A tap goes to the tab used
// last (or the next tab when Settings > Keys > Ctrl-Tab says "tab order");
// holding Control shows the window's tabs as cards (React draws them from
// State()), Tab and Shift-Tab move through them and releasing Control
// switches. Escape cancels; Return or a click switches at once.
//
// Chromium's own chrome::CycleToMruTab only ever goes to the single most
// recent tab, so repeated presses bounce between two tabs.
class TabSwitcher {
 public:
  // Before the cards appear, so a quick tap never flashes them.
  static constexpr base::TimeDelta kShowDelay = base::Milliseconds(120);

  TabSwitcher(BrowserWindowInterface* browser, base::RepeatingClosure changed);
  TabSwitcher(const TabSwitcher&) = delete;
  TabSwitcher& operator=(const TabSwitcher&) = delete;
  ~TabSwitcher();

  void Cycle(bool forward);
  bool IsOpen() const { return open_; }
  // Switches to the card at `index` (a click).
  void CommitIndex(int index);
  void Cancel();
  // The tab strip changed: drop closed tabs.
  void TabsChanged();
  // {tabs: [id...], selected, recent} while the cards show; none otherwise.
  base::Value State() const;
  // The tab's last thumbnail as a JPEG data URL; none when it has none.
  static base::Value Thumbnail(tabs::TabInterface* tab);

 private:
  enum class Key { kEscape, kReturn, kLeft, kRight, kUp, kDown };
  class KeyWatch;

  std::vector<tabs::TabHandle> OrderedTabs() const;
  void Move(int delta);
  void OnKey(Key key);
  void CheckControl();
  void ShowCards();
  void Commit();
  void Close();

  const raw_ptr<BrowserWindowInterface> browser_;
  base::RepeatingClosure changed_;
  std::vector<tabs::TabHandle> order_;
  int selected_ = 0;
  bool open_ = false;
  bool visible_ = false;
  bool recent_ = true;
  base::OneShotTimer show_timer_;
  // Catches a Control release the key watch misses (another app in front).
  base::RepeatingTimer control_poll_;
  std::unique_ptr<KeyWatch> key_watch_;
  base::WeakPtrFactory<TabSwitcher> weak_factory_{this};
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TAB_SWITCHER_H_
