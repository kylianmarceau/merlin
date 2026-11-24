// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_auto_pip.h"

#include <algorithm>
#include <utility>

#include "base/time/time.h"
#include "chrome/browser/picture_in_picture/auto_picture_in_picture_tab_helper.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/prefs/pref_service.h"
#include "components/tabs/public/split_tab_data.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/web_contents.h"

namespace modal_browser {
namespace {

void UpdatePage(content::WebContents* contents, bool seen, bool enabled) {
  if (auto* helper = AutoPictureInPictureTabHelper::FromWebContents(contents)) {
    helper->UpdateMerlinPageVisibility(seen, enabled);
  }
}

}  // namespace

MerlinAutoPip::MerlinAutoPip(BrowserWindowInterface* browser)
    : browser_(browser) {}
MerlinAutoPip::~MerlinAutoPip() = default;

void MerlinAutoPip::WindowSightChanged(bool visible) {
  window_visible_ = visible;
  TabsChanged();
}

void MerlinAutoPip::TabsChanged() {
  if (browser_->GetType() != BrowserWindowInterface::TYPE_NORMAL) {
    return;
  }
  // Coalesce the tab selection and split edits that form one transition.
  tab_change_.Start(FROM_HERE, base::Milliseconds(100), this,
                    &MerlinAutoPip::Update);
}

void MerlinAutoPip::PreferenceChanged() {
  // A background tab may still own an automatic player or have one in flight.
  // Update it as well as the panes currently visible.
  auto* strip = browser_->GetTabStripModel();
  if (!browser_->GetProfile()->GetPrefs()->GetBoolean(kAutoPipPref)) {
    for (int i = 0; i < strip->count(); ++i) {
      UpdatePage(strip->GetWebContentsAt(i), false, false);
    }
  }
  TabsChanged();
}

void MerlinAutoPip::Update() {
  auto* strip = browser_->GetTabStripModel();
  const bool enabled =
      browser_->GetProfile()->GetPrefs()->GetBoolean(kAutoPipPref);
  std::vector<base::WeakPtr<content::WebContents>> seen;
  if (window_visible_ && strip->GetActiveTab()) {
    auto* active = strip->GetActiveTab();
    seen.push_back(active->GetContents()->GetWeakPtr());
    if (auto split = active->GetSplit()) {
      for (auto* tab : strip->GetSplitData(*split)->ListTabs()) {
        if (tab != active) {
          seen.push_back(tab->GetContents()->GetWeakPtr());
        }
      }
    }
  }

  // Close the incoming page's automatic player before the outgoing page
  // tries to open one. Two visible split panes remain visible across focus.
  for (const auto& contents : seen) {
    UpdatePage(contents.get(), true, enabled);
  }
  for (const auto& contents : std::exchange(seen_, seen)) {
    if (contents && strip->GetIndexOfWebContents(contents.get()) >= 0 &&
        !std::ranges::contains(seen_, contents.get(),
                              &base::WeakPtr<content::WebContents>::get)) {
      UpdatePage(contents.get(), false, enabled);
    }
  }
}

}  // namespace modal_browser
