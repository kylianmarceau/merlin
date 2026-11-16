// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.

#include "chrome/browser/ui/modal_browser/merlin_tab_groups.h"

#include <iterator>
#include <set>
#include <utility>
#include <vector>

#include "base/i18n/case_conversion.h"
#include "base/strings/utf_string_conversions.h"
#include "base/token.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_vocabulary.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_group_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/tab_groups/tab_group_visual_data.h"
#include "components/tabs/public/tab_group.h"
#include "content/public/browser/web_contents.h"
#include "ui/gfx/range/range.h"

namespace modal_browser {

namespace {

// Chromium's tab group colours by the names the shell and workspace files use.
constexpr std::pair<std::string_view, tab_groups::TabGroupColorId>
    kGroupColors[] = {
        {shell::group_color::kGrey, tab_groups::TabGroupColorId::kGrey},
        {shell::group_color::kBlue, tab_groups::TabGroupColorId::kBlue},
        {shell::group_color::kRed, tab_groups::TabGroupColorId::kRed},
        {shell::group_color::kYellow, tab_groups::TabGroupColorId::kYellow},
        {shell::group_color::kGreen, tab_groups::TabGroupColorId::kGreen},
        {shell::group_color::kPink, tab_groups::TabGroupColorId::kPink},
        {shell::group_color::kPurple, tab_groups::TabGroupColorId::kPurple},
        {shell::group_color::kCyan, tab_groups::TabGroupColorId::kCyan},
        {shell::group_color::kOrange, tab_groups::TabGroupColorId::kOrange},
};
static_assert(std::size(kGroupColors) == shell::group_color::kAll.size(),
              "every colour the shell may send needs a Chromium colour");

// Group titles, like tab titles, are kept short in the shell (UTF-16 units).
constexpr size_t kMaxTitle = 100;

const TabGroup* Group(TabStripModel* strip, const tab_groups::TabGroupId& id) {
  return strip->SupportsTabGroups() ? strip->group_model()->GetTabGroup(id)
                                    : nullptr;
}

}  // namespace

std::string_view GroupColorName(tab_groups::TabGroupColorId color) {
  for (const auto& [name, id] : kGroupColors) {
    if (id == color) {
      return name;
    }
  }
  return shell::group_color::kGrey;
}

tab_groups::TabGroupColorId GroupColorFromName(std::string_view name) {
  return ParseGroupColor(name).value_or(tab_groups::TabGroupColorId::kGrey);
}

std::optional<tab_groups::TabGroupColorId> ParseGroupColor(
    std::string_view name) {
  for (const auto& [n, id] : kGroupColors) {
    if (n == name) {
      return id;
    }
  }
  return std::nullopt;
}

std::string GroupKey(const tab_groups::TabGroupId& id) {
  return id.token().ToString();
}

std::optional<tab_groups::TabGroupId> FindGroup(TabStripModel* strip,
                                                std::string_view key) {
  if (!strip->SupportsTabGroups()) {
    return std::nullopt;
  }
  for (const tab_groups::TabGroupId& id :
       strip->group_model()->ListTabGroups()) {
    if (GroupKey(id) == key) {
      return id;
    }
  }
  return std::nullopt;
}

std::optional<tab_groups::TabGroupId> FindGroupByTitle(TabStripModel* strip,
                                                       std::string_view title) {
  if (!strip->SupportsTabGroups() || title.empty()) {
    return std::nullopt;
  }
  const std::u16string wanted = base::i18n::ToLower(base::UTF8ToUTF16(title));
  for (int i = 0; i < strip->count(); ++i) {
    const auto id = strip->GetTabGroupForTab(i);
    const TabGroup* group = id ? Group(strip, *id) : nullptr;
    if (group && base::i18n::ToLower(group->visual_data()->title()) == wanted) {
      return id;
    }
  }
  return std::nullopt;
}

std::string GroupTitle(TabStripModel* strip, int index) {
  const auto id = strip->GetTabGroupForTab(index);
  const TabGroup* group = id ? Group(strip, *id) : nullptr;
  return group ? base::UTF16ToUTF8(group->visual_data()->title()) : std::string();
}

base::ListValue GroupsSnapshot(TabStripModel* strip) {
  base::ListValue groups;
  if (!strip->SupportsTabGroups()) {
    return groups;
  }
  std::set<std::string> seen;
  for (int i = 0; i < strip->count(); ++i) {
    const auto id = strip->GetTabGroupForTab(i);
    const TabGroup* group = id ? Group(strip, *id) : nullptr;
    if (!group || !seen.insert(GroupKey(*id)).second) {
      continue;
    }
    const tab_groups::TabGroupVisualData* visual = group->visual_data();
    groups.Append(base::DictValue()
                      .Set("id", GroupKey(*id))
                      .Set("title", base::UTF16ToUTF8(visual->title()))
                      .Set("color", GroupColorName(visual->color()))
                      .Set("collapsed", visual->is_collapsed()));
  }
  return groups;
}

std::string GroupTab(TabStripModel* strip,
                     int index,
                     std::optional<tab_groups::TabGroupId> group,
                     std::string_view title) {
  if (!strip->SupportsTabGroups()) {
    return "This window has no tab groups";
  }
  if (index < 0 || index >= strip->count()) {
    return "That tab has closed";
  }
  if (strip->IsTabPinned(index)) {
    return "Pinned tabs aren't grouped; unpin it first";
  }
  if (group) {
    if (!Group(strip, *group)) {
      return "That group has closed";
    }
    if (strip->GetTabGroupForTab(index) == group) {
      return {};
    }
    strip->AddToExistingGroup({index}, *group);
    return {};
  }
  const tab_groups::TabGroupId id = strip->AddToNewGroup({index});
  if (const TabGroup* created = Group(strip, id); created && !title.empty()) {
    tab_groups::TabGroupVisualData visual(
        base::UTF8ToUTF16(title).substr(0, kMaxTitle),
        created->visual_data()->color());
    strip->ChangeTabGroupVisuals(id, visual);
  }
  return {};
}

std::string UngroupTab(TabStripModel* strip, int index) {
  if (index < 0 || index >= strip->count()) {
    return "That tab has closed";
  }
  if (!strip->GetTabGroupForTab(index)) {
    return "This tab isn't in a group";
  }
  strip->RemoveFromGroup({index});
  return {};
}

std::string UpdateGroup(TabStripModel* strip,
                        const tab_groups::TabGroupId& id,
                        const std::optional<std::string>& title,
                        std::optional<tab_groups::TabGroupColorId> color,
                        std::optional<bool> collapsed) {
  const TabGroup* group = Group(strip, id);
  if (!group) {
    return "That group has closed";
  }
  const tab_groups::TabGroupVisualData* current = group->visual_data();
  const bool collapse = collapsed.value_or(current->is_collapsed());
  if (collapse && !current->is_collapsed()) {
    // The active tab stays in view: move to the nearest tab outside.
    const gfx::Range tabs = group->ListTabs();
    const int active = strip->active_index();
    if (active >= static_cast<int>(tabs.start()) &&
        active < static_cast<int>(tabs.end())) {
      int outside = -1;
      if (static_cast<int>(tabs.end()) < strip->count()) {
        outside = static_cast<int>(tabs.end());
      } else if (tabs.start() > 0) {
        outside = static_cast<int>(tabs.start()) - 1;
      }
      if (outside < 0) {
        return "A group with every tab in the window can't collapse";
      }
      strip->ActivateTabAt(outside);
    }
  }
  const std::u16string new_title =
      title ? base::UTF8ToUTF16(*title).substr(0, kMaxTitle) : current->title();
  strip->ChangeTabGroupVisuals(
      id, tab_groups::TabGroupVisualData(
              new_title, color.value_or(current->color()), collapse),
      /*is_customized=*/true);
  return {};
}

void UngroupAll(TabStripModel* strip, const tab_groups::TabGroupId& id) {
  const TabGroup* group = Group(strip, id);
  if (!group) {
    return;
  }
  const gfx::Range tabs = group->ListTabs();
  std::vector<int> indices;
  for (size_t i = tabs.start(); i < tabs.end(); ++i) {
    indices.push_back(static_cast<int>(i));
  }
  strip->RemoveFromGroup(indices);
}

void CloseGroup(TabStripModel* strip, const tab_groups::TabGroupId& id) {
  const TabGroup* group = Group(strip, id);
  if (!group) {
    return;
  }
  const gfx::Range tabs = group->ListTabs();
  // From the end, so earlier indices stay put.
  for (int i = static_cast<int>(tabs.end()) - 1;
       i >= static_cast<int>(tabs.start()); --i) {
    strip->CloseWebContentsAt(i, TabCloseTypes::CLOSE_USER_GESTURE |
                                     TabCloseTypes::CLOSE_CREATE_HISTORICAL_TAB);
  }
}

void ExpandActiveGroup(TabStripModel* strip) {
  const int active = strip->active_index();
  if (active < 0) {
    return;
  }
  const auto id = strip->GetTabGroupForTab(active);
  const TabGroup* group = id ? Group(strip, *id) : nullptr;
  if (!group || !group->visual_data()->is_collapsed()) {
    return;
  }
  const tab_groups::TabGroupVisualData* visual = group->visual_data();
  strip->ChangeTabGroupVisuals(
      *id, tab_groups::TabGroupVisualData(visual->title(), visual->color(),
                                          /*is_collapsed=*/false));
}

}  // namespace modal_browser
