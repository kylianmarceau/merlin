// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TAB_SPACE_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TAB_SPACE_H_

#include <string>
#include <string_view>

#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"

namespace modal_browser {

// Which space a tab belongs to. Spaces are sets of tabs the shell shows one
// at a time in a window, as Zen and Arc do (apps/browser/src/state/spaces.ts
// decides which tabs show and owns the spaces themselves). Native code only
// keeps each tab's space ID, the way Zen's session store keeps a tab's
// `zen-workspace-id` attribute: on the tab, and on its current navigation
// entry so the session saves it and restores it with the tab.
//
// Empty when the tab has no space yet (the shell gives it the one showing).
std::string GetTabSpace(content::WebContents* contents);

// Puts the tab in `space`; an empty ID takes it out of every space. False
// when the ID isn't a space ID (letters, digits, '-' and '_', at most 64).
bool SetTabSpace(content::WebContents* contents, std::string_view space);

// Whether `space` is a usable space ID.
bool IsSpaceId(std::string_view space);

// Registers the session handler that saves and restores tabs' spaces. Safe
// to call more than once.
void RegisterTabSpaceSessionData();

class TabSpace : public content::WebContentsUserData<TabSpace>,
                 public content::WebContentsObserver {
 public:
  ~TabSpace() override;

  const std::string& space() const { return space_; }

  // content::WebContentsObserver:
  void NavigationEntryCommitted(
      const content::LoadCommittedDetails& details) override;

 private:
  friend class content::WebContentsUserData<TabSpace>;
  friend bool SetTabSpace(content::WebContents*, std::string_view);
  TabSpace(content::WebContents* contents, std::string space);

  // Keeps the space on the current entry, so the session saves it.
  void Record();

  std::string space_;

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TAB_SPACE_H_
