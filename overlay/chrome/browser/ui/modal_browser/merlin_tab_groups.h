// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
//
// Chromium's tab groups as Merlin presents and changes them: colour names
// (shared by workspace files and the React shell), string IDs the shell can
// hold, and the operations its menus, `:group` and `:ungroup` run.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TAB_GROUPS_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TAB_GROUPS_H_

#include <optional>
#include <string>
#include <string_view>

#include "base/values.h"
#include "components/tab_groups/tab_group_color.h"
#include "components/tab_groups/tab_group_id.h"

class TabStripModel;

namespace modal_browser {

// "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan",
// "orange": the names workspace files and the shell use.
std::string_view GroupColorName(tab_groups::TabGroupColorId color);
// Unknown names are grey.
tab_groups::TabGroupColorId GroupColorFromName(std::string_view name);
// Unknown names are nullopt.
std::optional<tab_groups::TabGroupColorId> ParseGroupColor(
    std::string_view name);

// A group's ID as a string the shell keeps between snapshots.
std::string GroupKey(const tab_groups::TabGroupId& id);
// The group in `strip` with that key, if it still exists.
std::optional<tab_groups::TabGroupId> FindGroup(TabStripModel* strip,
                                                std::string_view key);
// The first group (in strip order) whose title matches `title`, ignoring case.
std::optional<tab_groups::TabGroupId> FindGroupByTitle(TabStripModel* strip,
                                                       std::string_view title);

// The title of the group the tab at `index` is in; empty when it has none.
std::string GroupTitle(TabStripModel* strip, int index);

// The window's groups in strip order, for the shell's snapshot:
// [{id, title, color, collapsed}].
base::ListValue GroupsSnapshot(TabStripModel* strip);

// Adds the tab at `index` to `group`, or to a new group titled `title` when
// `group` is nullopt. Pinned tabs aren't grouped. Returns an error message,
// or empty on success.
std::string GroupTab(TabStripModel* strip,
                     int index,
                     std::optional<tab_groups::TabGroupId> group,
                     std::string_view title);
// Takes the tab at `index` out of its group. Returns an error, or empty.
std::string UngroupTab(TabStripModel* strip, int index);
// Changes any of the group's title, colour and collapsed state. Collapsing
// the group that holds the active tab moves to the nearest tab outside it
// (and isn't possible when there is none). Returns an error, or empty.
std::string UpdateGroup(TabStripModel* strip,
                        const tab_groups::TabGroupId& group,
                        const std::optional<std::string>& title,
                        std::optional<tab_groups::TabGroupColorId> color,
                        std::optional<bool> collapsed);
// Takes every tab out of the group, which then ends.
void UngroupAll(TabStripModel* strip, const tab_groups::TabGroupId& group);
// Closes every tab in the group, as the tab menu's Close Tab would.
void CloseGroup(TabStripModel* strip, const tab_groups::TabGroupId& group);
// A collapsed group never hides the active tab: expands the active tab's
// group if it is collapsed (after a key, browserctl or a click selects it).
void ExpandActiveGroup(TabStripModel* strip);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_TAB_GROUPS_H_
