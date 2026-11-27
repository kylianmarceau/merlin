// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_space_windows.h"

#include <cstdint>
#include <map>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/location.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/rand_util.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/sessions/session_service.h"
#include "chrome/browser/sessions/session_service_factory.h"
#include "chrome/browser/ui/browser_init_state.h"
#include "chrome/browser/ui/browser_tabstrip.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/create_browser_window.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_manager.h"
#include "chrome/browser/ui/exclusive_access/fullscreen_controller.h"
#include "chrome/browser/ui/modal_browser/merlin_react_window.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "chrome/browser/ui/modal_browser/merlin_space_data.h"
#include "chrome/browser/ui/modal_browser/merlin_tab_space.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/base_window.h"
#include "ui/gfx/geometry/rect.h"
#include "url/gurl.h"
#include "url/url_constants.h"

namespace modal_browser {

namespace {

// "merlin-space-window:<group>:<1 when showing, else 0>". The key must
// never change: sessions keep it.
constexpr std::string_view kWorkspacePrefix = "merlin-space-window:";
// How long a restored session has to bring back a group's window on screen
// before one of its hidden windows shows instead.
constexpr base::TimeDelta kRestoreGrace = base::Seconds(3);

struct Member {
  std::string group;
  bool shown = false;
  // Restored as hidden: the first request to show is the session's own and
  // is declined.
  bool keep_hidden = false;
  // When it last came on screen, to choose which window takes over.
  uint64_t order = 0;
  // Where it was when last on screen, for the one taking its place.
  gfx::Rect bounds;
  // Closing with its data, not with its group.
  bool closing_alone = false;
};

struct Registry {
  std::map<const BrowserWindowInterface*, Member> members;
  std::set<std::string> closing;
  uint64_t order = 0;
};

Registry& GetRegistry() {
  static base::NoDestructor<Registry> registry;
  return *registry;
}

bool InGroups(const BrowserWindowInterface* browser) {
  return browser && browser->GetType() == BrowserWindowInterface::TYPE_NORMAL &&
         !const_cast<BrowserWindowInterface*>(browser)
              ->GetProfile()
              ->IsOffTheRecord();
}

Member* Find(const BrowserWindowInterface* browser) {
  auto& members = GetRegistry().members;
  const auto it = members.find(browser);
  return it == members.end() ? nullptr : &it->second;
}

std::vector<BrowserWindowInterface*> Group(std::string_view group) {
  std::vector<BrowserWindowInterface*> out;
  for (const auto& [browser, member] : GetRegistry().members) {
    if (member.group == group) {
      out.push_back(const_cast<BrowserWindowInterface*>(browser));
    }
  }
  return out;
}

BrowserWindowInterface* Shown(std::string_view group) {
  for (const auto& [browser, member] : GetRegistry().members) {
    if (member.group == group && member.shown) {
      return const_cast<BrowserWindowInterface*>(browser);
    }
  }
  return nullptr;
}

// The group's window for `data`, if it has one.
BrowserWindowInterface* WindowFor(std::string_view group, std::string_view data) {
  for (auto* browser : Group(group)) {
    if (SpaceDataId(browser->GetProfile()) == data) {
      return browser;
    }
  }
  return nullptr;
}

std::string NewGroupId() {
  return base::HexEncode(base::RandBytesAsVector(8));
}

std::string Encode(std::string_view group, bool shown) {
  return std::string(kWorkspacePrefix) + std::string(group) + (shown ? ":1" : ":0");
}

// The group and showing state a window was saved with, if it was.
bool Decode(std::string_view workspace, std::string* group, bool* shown) {
  if (!workspace.starts_with(kWorkspacePrefix)) {
    return false;
  }
  const auto parts = base::SplitStringPiece(workspace.substr(kWorkspacePrefix.size()), ":",
                                            base::KEEP_WHITESPACE, base::SPLIT_WANT_ALL);
  if (parts.size() != 2 || parts[0].empty() || parts[0].size() > 64 ||
      (parts[1] != "0" && parts[1] != "1")) {
    return false;
  }
  for (char c : parts[0]) {
    if (!base::IsHexDigit(c)) {
      return false;
    }
  }
  *group = std::string(parts[0]);
  *shown = parts[1] == "1";
  return true;
}

// The session keeps the window's group and whether it shows.
void Save(BrowserWindowInterface* browser) {
  if (SessionService* service =
          SessionServiceFactory::GetForProfileIfExisting(browser->GetProfile())) {
    service->SetWindowWorkspace(browser->GetSessionID(), SpaceWindowWorkspace(browser));
  }
}

bool InFullscreen(BrowserWindowInterface* browser) {
  auto* manager = ExclusiveAccessManager::From(browser);
  return manager && manager->fullscreen_controller()->IsFullscreenForBrowser();
}

void ToggleFullscreen(BrowserWindowInterface* browser) {
  if (auto* manager = ExclusiveAccessManager::From(browser)) {
    manager->fullscreen_controller()->ToggleBrowserFullscreenMode(/*user_initiated=*/false);
  }
}

// `previous` leaves the screen to `next`, which has drawn.
void HideAfter(base::WeakPtr<BrowserWindowInterface> previous, bool fullscreen) {
  if (!previous) {
    return;
  }
  const Member* member = Find(previous.get());
  if (!member || member->shown) {
    return;  // Chosen again meanwhile.
  }
  // A window can't wait in full screen out of sight: it leaves full screen
  // as it hides, and the window showing now takes it up.
  if (fullscreen && InFullscreen(previous.get())) {
    ToggleFullscreen(previous.get());
  }
  previous->GetWindow()->Hide();
}

// Shows one of `group`'s windows when none is on screen: after a restore
// that brought back only hidden ones, or once the one showing has gone.
void ShowOne(std::string group, gfx::Rect bounds) {
  if (Shown(group) || GetRegistry().closing.contains(group) ||
      browser_shutdown::IsTryingToQuit()) {
    return;
  }
  BrowserWindowInterface* next = nullptr;
  uint64_t latest = 0;
  for (auto* browser : Group(group)) {
    const Member* member = Find(browser);
    if (!next || member->order >= latest) {
      next = browser;
      latest = member->order;
    }
  }
  if (!next) {
    return;
  }
  Find(next)->keep_hidden = false;
  if (!bounds.IsEmpty()) {
    next->GetWindow()->SetBounds(bounds);
  }
  next->GetWindow()->Show();
}

// A new window of `group` for `profile`, where `from` is, with one tab of
// `url` in space `space`. Not yet shown.
BrowserWindowInterface* CreateWindow(BrowserWindowInterface* from,
                                     const std::string& group,
                                     Profile* profile,
                                     const GURL& url,
                                     const std::string& space) {
  BrowserWindowCreateParams params(BrowserWindowInterface::TYPE_NORMAL, profile,
                                   /*from_user_gesture=*/true);
  params.initial_bounds = from->GetWindow()->GetBounds();
  params.initial_workspace = Encode(group, false);
  BrowserWindowInterface* created = CreateBrowserWindow(std::move(params));
  if (!created) {
    return nullptr;
  }
  if (content::WebContents* tab =
          chrome::AddAndReturnTabAt(created, url, -1, /*foreground=*/true)) {
    SetTabSpace(tab, space);
  }
  return created;
}

}  // namespace

void JoinSpaceWindow(BrowserWindowInterface* browser) {
  if (!InGroups(browser) || Find(browser)) {
    return;
  }
  // Merlin's settings are the same in every space's data.
  ShareSpaceSettings(browser->GetProfile());
  Member member;
  bool shown = true;
  const BrowserInitState* init = BrowserInitState::From(browser);
  if (!init || !Decode(init->initial_workspace(), &member.group, &shown)) {
    member.group = NewGroupId();
    shown = true;
  }
  // Only a restored session's hidden windows stay hidden when it shows them;
  // a window made from one (a closed window reopened) shows as usual.
  member.keep_hidden =
      !shown && init &&
      init->create_params().creation_source ==
          BrowserWindowCreateParams::CreationSource::kSessionRestore;
  GetRegistry().members.emplace(browser, std::move(member));
  if (!shown && Find(browser)->keep_hidden) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE, base::BindOnce(&ShowOne, Find(browser)->group, gfx::Rect()),
        kRestoreGrace);
  }
}

void LeaveSpaceWindow(BrowserWindowInterface* browser) {
  Member* member = Find(browser);
  if (!member) {
    return;
  }
  const std::string group = member->group;
  const bool shown = member->shown;
  const gfx::Rect bounds = member->bounds;
  GetRegistry().members.erase(browser);
  if (Group(group).empty()) {
    GetRegistry().closing.erase(group);
    return;
  }
  if (shown) {
    // Its last tab closed: the window carries on with another space's data,
    // in its place.
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ShowOne, group, bounds));
  }
}

void SpaceWindowMoved(BrowserWindowInterface* browser) {
  Member* member = Find(browser);
  if (member && member->shown && browser->GetWindow()->IsVisible() &&
      !browser->GetWindow()->IsMinimized() && !InFullscreen(browser)) {
    member->bounds = browser->GetWindow()->GetBounds();
  }
}

std::string SpaceWindowWorkspace(const BrowserWindowInterface* browser) {
  const Member* member = Find(browser);
  return member ? Encode(member->group, member->shown) : std::string();
}

bool SpaceWindowShows(BrowserWindowInterface* browser) {
  Member* member = Find(browser);
  if (!member) {
    return true;
  }
  if (member->keep_hidden) {
    member->keep_hidden = false;
    return false;
  }
  if (member->shown) {
    return true;
  }
  BrowserWindowInterface* previous = Shown(member->group);
  member->shown = true;
  member->order = ++GetRegistry().order;
  Save(browser);
  if (!previous) {
    member->bounds = browser->GetWindow()->GetBounds();
    return true;
  }
  Member* before = Find(previous);
  before->shown = false;
  before->bounds = previous->GetWindow()->GetBounds();
  Save(previous);
  const bool fullscreen = InFullscreen(previous);
  if (fullscreen) {
    // Into full screen once on screen, as the one before leaves it.
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](base::WeakPtr<BrowserWindowInterface> next) {
                         if (next && !InFullscreen(next.get())) {
                           ToggleFullscreen(next.get());
                         }
                       },
                       browser->GetWeakPtr()));
  } else if (!InFullscreen(browser)) {
    browser->GetWindow()->SetBounds(before->bounds);
  }
  member->bounds = before->bounds;
  WhenReactWindowDrawn(browser, base::BindOnce(&HideAfter, previous->GetWeakPtr(), fullscreen));
  return true;
}

bool IsHiddenSpaceWindow(const BrowserWindowInterface* browser) {
  const Member* member = Find(browser);
  return member && !member->shown;
}

void CloseSpaceWindowGroup(BrowserWindowInterface* browser) {
  Member* member = Find(browser);
  // Quitting closes every window anyway; data being deleted closes only its own.
  if (!member || member->closing_alone || browser_shutdown::IsTryingToQuit()) {
    return;
  }
  const std::string group = member->group;
  GetRegistry().closing.insert(group);
  for (auto* other : Group(group)) {
    if (other != browser) {
      other->GetWindow()->Close();
    }
  }
}

bool SpaceWindowClosesQuietly(const BrowserWindowInterface* browser) {
  const Member* member = Find(browser);
  return member && (GetRegistry().closing.contains(member->group) ||
                    !member->shown || member->closing_alone);
}

std::string DeleteSpaceDataAndWindows(const std::string& data) {
  for (auto& [browser, member] : GetRegistry().members) {
    if (SpaceDataId(const_cast<BrowserWindowInterface*>(browser)->GetProfile()) == data) {
      member.closing_alone = true;
    }
  }
  return DeleteSpaceData(data);
}

int SpaceWindowTabCount(BrowserWindowInterface* browser) {
  const Member* member = Find(browser);
  if (!member) {
    return browser->GetTabStripModel()->count();
  }
  int count = 0;
  for (auto* other : Group(member->group)) {
    count += other->GetTabStripModel()->count();
  }
  return count;
}

void ShowSpaceData(BrowserWindowInterface* browser,
                   std::string data,
                   std::string space,
                   base::OnceCallback<void(std::string error)> done) {
  const Member* member = Find(browser);
  if (!member) {
    std::move(done).Run("This window has no spaces");
    return;
  }
  if (!IsSpaceId(space) || !IsSpaceDataId(data)) {
    std::move(done).Run("Invalid space");
    return;
  }
  if (SpaceDataId(browser->GetProfile()) == data) {
    SendShellSpaceEvent(browser, "switch", "", space);
    std::move(done).Run(std::string());
    return;
  }
  if (BrowserWindowInterface* existing = WindowFor(member->group, data)) {
    SendShellSpaceEvent(existing, "switch", "", space);
    existing->GetWindow()->Show();
    std::move(done).Run(std::string());
    return;
  }
  LoadSpaceData(
      data,
      base::BindOnce(
          [](base::WeakPtr<BrowserWindowInterface> from, std::string group,
             std::string data, std::string space,
             base::OnceCallback<void(std::string)> done, Profile* profile) {
            if (!profile) {
              std::move(done).Run("That space’s data couldn’t be opened");
              return;
            }
            if (!from || !Find(from.get())) {
              std::move(done).Run("Browser window has closed");
              return;
            }
            ShareSpaceSettings(profile);
            // Another request may have made the window meanwhile.
            BrowserWindowInterface* next = WindowFor(group, data);
            if (next) {
              SendShellSpaceEvent(next, "switch", "", space);
            } else {
              next = CreateWindow(from.get(), group, profile, GURL(url::kAboutBlankURL), space);
            }
            if (!next) {
              std::move(done).Run("That space couldn’t open");
              return;
            }
            next->GetWindow()->Show();
            std::move(done).Run(std::string());
          },
          browser->GetWeakPtr(), member->group, data, space, std::move(done)));
}

void MoveTabToSpaceData(BrowserWindowInterface* browser,
                        content::WebContents* tab,
                        std::string data,
                        std::string space,
                        base::OnceCallback<void(std::string error)> done) {
  const Member* member = Find(browser);
  if (!member || !tab) {
    std::move(done).Run("This window has no spaces");
    return;
  }
  if (!IsSpaceId(space) || !IsSpaceDataId(data)) {
    std::move(done).Run("Invalid space");
    return;
  }
  // The page opens again with the other data: its address, not its state.
  content::NavigationEntry* entry = tab->GetController().GetLastCommittedEntry();
  const GURL url = entry ? entry->GetURL() : tab->GetVisibleURL();
  LoadSpaceData(
      data,
      base::BindOnce(
          [](base::WeakPtr<BrowserWindowInterface> from, base::WeakPtr<content::WebContents> tab,
             std::string group, std::string data, std::string space, GURL url,
             base::OnceCallback<void(std::string)> done, Profile* profile) {
            if (!profile) {
              std::move(done).Run("That space’s data couldn’t be opened");
              return;
            }
            if (!from || !tab || !Find(from.get())) {
              std::move(done).Run("That tab has closed");
              return;
            }
            TabStripModel* strip = from->GetTabStripModel();
            const int index = strip->GetIndexOfWebContents(tab.get());
            if (index == TabStripModel::kNoTab) {
              std::move(done).Run("That tab has closed");
              return;
            }
            const bool showing = index == strip->active_index();
            ShareSpaceSettings(profile);
            BrowserWindowInterface* next = WindowFor(group, data);
            if (next) {
              if (content::WebContents* moved =
                      chrome::AddAndReturnTabAt(next, url, -1, /*foreground=*/showing)) {
                SetTabSpace(moved, space);
              }
            } else {
              next = CreateWindow(from.get(), group, profile, url, space);
            }
            if (!next) {
              std::move(done).Run("That space couldn’t open");
              return;
            }
            if (showing) {
              SendShellSpaceEvent(next, "switch", "", space);
              next->GetWindow()->Show();
            }
            strip->CloseWebContentsAt(index, TabCloseTypes::CLOSE_USER_GESTURE);
            std::move(done).Run(std::string());
          },
          browser->GetWeakPtr(), tab->GetWeakPtr(), member->group, data, space, url,
          std::move(done)));
}

}  // namespace modal_browser
