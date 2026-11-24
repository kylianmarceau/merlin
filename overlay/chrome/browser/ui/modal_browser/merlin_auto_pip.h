// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_AUTO_PIP_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_AUTO_PIP_H_

#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"

class BrowserWindowInterface;

namespace content {
class WebContents;
}

namespace modal_browser {

inline constexpr char kAutoPipPref[] = "merlin.auto_pip";

// Combines window sight with the tabs occupying its visible panes and sends
// those transitions to Chromium's automatic PiP helper.
class MerlinAutoPip {
 public:
  explicit MerlinAutoPip(BrowserWindowInterface* browser);
  ~MerlinAutoPip();

  void WindowSightChanged(bool visible);
  void TabsChanged();
  void PreferenceChanged();

 private:
  void Update();

  const raw_ptr<BrowserWindowInterface> browser_;
  bool window_visible_ = false;
  std::vector<base::WeakPtr<content::WebContents>> seen_;
  base::OneShotTimer tab_change_;
};

// Called by the AppKit window when its visibility changes.
void MerlinAutoPipWindowSightChanged(BrowserWindowInterface* browser,
                                      bool visible);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_AUTO_PIP_H_
