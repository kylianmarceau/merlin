// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SPACE_WINDOWS_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SPACE_WINDOWS_H_

#include <string>

#include "base/functional/callback_forward.h"

class BrowserWindowInterface;
namespace content {
class WebContents;
}

namespace modal_browser {

// A Merlin window shows spaces whose data can differ, as Arc's do
// (merlin_space_data.h). A Chromium window holds one profile's tabs, and
// its session saves them into that profile, so a Merlin window is a group
// of Chromium windows, one for each space data it has tabs of, in the same
// place: the one whose space is showing is on screen and the others wait
// hidden. Going to a space with other data shows that data's window where
// the last one was and hides the last one once the new one has drawn.
//
// Each window saves its group, and whether it was the one showing, as its
// session "workspace" (a ChromeOS desk name everywhere else), so a restored
// session pairs the windows up again with only one of each group on screen.
//
// Normal windows of regular data only; private windows and pop-ups stand
// alone. Browser UI thread only.

// The React window's hooks (merlin_react_window_mac.mm).
//
// `browser`'s window was made: it joins the group it was saved in, else a
// new one.
void JoinSpaceWindow(BrowserWindowInterface* browser);
// `browser`'s window is going. When it was the one showing, another of its
// group takes its place, unless the group is closing or Merlin is quitting.
void LeaveSpaceWindow(BrowserWindowInterface* browser);
// `browser`'s window moved or changed size, for the window that takes its
// place should it close.
void SpaceWindowMoved(BrowserWindowInterface* browser);
// What `browser`'s window saves as its session workspace.
std::string SpaceWindowWorkspace(const BrowserWindowInterface* browser);
// `browser`'s window is asked to show. False to keep it hidden: it was
// restored as one of its group's hidden windows. Otherwise it becomes its
// group's window on screen, and the one that was hides once it has drawn.
bool SpaceWindowShows(BrowserWindowInterface* browser);
// Whether `browser`'s window is one of its group's hidden windows.
bool IsHiddenSpaceWindow(const BrowserWindowInterface* browser);
// The person closes `browser`'s window, which has tabs: the group's hidden
// windows close with it.
void CloseSpaceWindowGroup(BrowserWindowInterface* browser);
// Whether `browser`'s window closes with its group or its data, without
// asking.
bool SpaceWindowClosesQuietly(const BrowserWindowInterface* browser);
// The tabs of `browser`'s window and of its group's hidden windows.
int SpaceWindowTabCount(BrowserWindowInterface* browser);

// Deletes the space data `data` (merlin_space_data.h DeleteSpaceData). Its
// windows close on their own, without taking their groups' other windows.
// Returns an error to show, or empty.
std::string DeleteSpaceDataAndWindows(const std::string& data);

// The shell's requests (merlin_shell_services.cc).
//
// Shows space `space`, whose data is `data`, in the Merlin window `browser`
// shows: that data's window of the group when it has one (its shell is
// told to show the space), else a new one with a new tab in the space.
// `done` gets an error to show, or empty.
void ShowSpaceData(BrowserWindowInterface* browser,
                   std::string data,
                   std::string space,
                   base::OnceCallback<void(std::string error)> done);
// Moves `tab` of `browser` to space `space`, whose data is `data`: data
// can't move, so the page opens again there and the tab here closes. The
// window goes with it when it was the tab showing.
void MoveTabToSpaceData(BrowserWindowInterface* browser,
                        content::WebContents* tab,
                        std::string data,
                        std::string space,
                        base::OnceCallback<void(std::string error)> done);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SPACE_WINDOWS_H_
