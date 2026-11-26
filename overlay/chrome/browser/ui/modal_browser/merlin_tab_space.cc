// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_tab_space.h"

#include <memory>
#include <utility>

#include "base/memory/ptr_util.h"
#include "base/strings/string_util.h"
#include "base/supports_user_data.h"
#include "components/sessions/content/content_serialized_navigation_driver.h"
#include "components/sessions/content/extended_info_handler.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/web_contents.h"

namespace modal_browser {

namespace {

// The key in the session file; it must never change.
constexpr char kSessionKey[] = "merlin_space";
constexpr size_t kMaxSpaceId = 64;

// The space recorded on one navigation entry.
class SpaceEntry : public base::SupportsUserData::Data {
 public:
  explicit SpaceEntry(std::string space) : space(std::move(space)) {}
  std::unique_ptr<Data> Clone() override {
    return std::make_unique<SpaceEntry>(space);
  }
  std::string space;
};

SpaceEntry* EntryData(content::NavigationEntry* entry) {
  return entry ? static_cast<SpaceEntry*>(entry->GetUserData(kSessionKey))
               : nullptr;
}

content::NavigationEntry* CurrentEntry(content::WebContents* contents) {
  content::NavigationController& controller = contents->GetController();
  // A restored tab that hasn't loaded yet has no committed entry of its own
  // making, but its restored current entry is its last committed one.
  content::NavigationEntry* entry = controller.GetLastCommittedEntry();
  return entry ? entry : controller.GetVisibleEntry();
}

class SpaceSessionHandler : public sessions::ExtendedInfoHandler {
 public:
  std::string GetExtendedInfo(content::NavigationEntry* entry) const override {
    const SpaceEntry* data = EntryData(entry);
    return data ? data->space : std::string();
  }

  void RestoreExtendedInfo(const std::string& info,
                           content::NavigationEntry* entry) override {
    if (IsSpaceId(info)) {
      entry->SetUserData(kSessionKey, std::make_unique<SpaceEntry>(info));
    }
  }
};

}  // namespace

bool IsSpaceId(std::string_view space) {
  if (space.empty() || space.size() > kMaxSpaceId) {
    return false;
  }
  for (char c : space) {
    if (!base::IsAsciiAlphaNumeric(c) && c != '-' && c != '_') {
      return false;
    }
  }
  return true;
}

std::string GetTabSpace(content::WebContents* contents) {
  if (!contents) {
    return std::string();
  }
  if (const TabSpace* tab = TabSpace::FromWebContents(contents)) {
    return tab->space();
  }
  // Restored with the session: the space is on its entry. Taking it up now
  // keeps it on the pages the tab goes on to.
  const SpaceEntry* data = EntryData(CurrentEntry(contents));
  if (!data || !IsSpaceId(data->space)) {
    return std::string();
  }
  const std::string space = data->space;
  SetTabSpace(contents, space);
  return space;
}

bool SetTabSpace(content::WebContents* contents, std::string_view space) {
  if (!contents || (!space.empty() && !IsSpaceId(space))) {
    return false;
  }
  if (TabSpace* tab = TabSpace::FromWebContents(contents)) {
    if (tab->space_ == space) {
      return true;
    }
    tab->space_ = std::string(space);
  } else {
    contents->SetUserData(
        TabSpace::UserDataKey(),
        base::WrapUnique(new TabSpace(contents, std::string(space))));
  }
  TabSpace::FromWebContents(contents)->Record();
  return true;
}

TabSpace::TabSpace(content::WebContents* contents, std::string space)
    : content::WebContentsUserData<TabSpace>(*contents),
      content::WebContentsObserver(contents),
      space_(std::move(space)) {}

TabSpace::~TabSpace() = default;

void TabSpace::Record() {
  content::NavigationEntry* entry = CurrentEntry(web_contents());
  if (!entry) {
    return;
  }
  const SpaceEntry* data = EntryData(entry);
  if (space_.empty()) {
    if (!data) {
      return;
    }
    entry->RemoveUserData(kSessionKey);
  } else {
    if (data && data->space == space_) {
      return;
    }
    entry->SetUserData(kSessionKey, std::make_unique<SpaceEntry>(space_));
  }
  // The session service writes an entry again when it hears it changed.
  web_contents()->GetController().NotifyEntryChanged(entry);
}

void TabSpace::NavigationEntryCommitted(
    const content::LoadCommittedDetails& details) {
  // The tab went to another page: the space goes with it.
  Record();
}

void RegisterTabSpaceSessionData() {
  static bool registered = false;
  if (registered) {
    return;
  }
  registered = true;
  sessions::ContentSerializedNavigationDriver::GetInstance()
      ->RegisterExtendedInfoHandler(kSessionKey,
                                    std::make_unique<SpaceSessionHandler>());
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(TabSpace);

}  // namespace modal_browser
