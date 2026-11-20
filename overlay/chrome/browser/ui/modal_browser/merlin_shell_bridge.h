// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SHELL_BRIDGE_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SHELL_BRIDGE_H_

#include <string>
#include "base/functional/callback.h"
#include "base/values.h"
#include "ui/gfx/native_ui_types.h"

class BrowserWindowInterface;
class GURL;
namespace content { class WebContents; }
namespace modal_browser {
// Browser UI thread only. No page renderer can access these functions.
struct ShellPromptReply {
  std::string action;
  std::string text;
  // A sign-in's password, given only with the answer and never kept as a draft.
  std::string secret;
  bool suppress = false;
};
bool ReactShellEnabled();
// Shows the window's newly active page in the place React gave the previous
// one, so a tab switch does not wait for React to re-render. Split views and
// the start page (`start_page`) are left to React.
void RevealActivePage(BrowserWindowInterface* browser, bool start_page);
void NotifyShellWindow(BrowserWindowInterface* browser);
// A modal scroll (j, k, gg, G...) ran in `browser`'s active page: its edge
// colour is read once the scroll has settled.
void ShellPageScrolled(BrowserWindowInterface* browser);
// The addresses the shell draws its start page for (lib/format.ts isStartUrl).
bool IsShellStartUrl(const GURL& url);
// Whether the shell shows its start page for `contents` rather than the page:
// on a start page, and after a search or address typed there until the new
// page has drawn something, so the window never shows an empty page.
bool ShowsShellStartPage(BrowserWindowInterface* browser, content::WebContents* contents);
void SetShellFindState(BrowserWindowInterface* browser, base::DictValue state);
bool ShellFindHasFocus(BrowserWindowInterface* browser);
void SendShellEvent(BrowserWindowInterface* browser, const char* type);
// A two-finger swipe back or forward over `view`'s page, in place of
// Chromium's overlay: how far it has gone (0 to 1, more past its end),
// whether letting go would navigate, and whether it has ended. False when
// the view isn't in a window of the shell, which then draws nothing.
bool ShellHistorySwipe(gfx::NativeView view, bool forward, double progress, bool ready, bool ended);
// Opens a React shell panel: "settings", "history", "bookmarks", "downloads",
// "extensions" or "newTab". False when `browser` has no React window.
bool OpenShellPanel(BrowserWindowInterface* browser, const char* panel);
// With new tabs as a pop-up (Settings > Appearance), shows the shell's
// new-tab pop-up over the current page instead of opening a blank tab.
// False when the setting is off or `browser` has no React window or no tabs;
// the caller then opens a tab as usual.
bool OpenNewTabPopup(BrowserWindowInterface* browser);
// Ctrl-Tab (forward) or Ctrl-Shift-Tab in a React window: the tab switcher.
// False when `browser` has no React window.
bool CycleShellTabs(BrowserWindowInterface* browser, bool forward);
// Prompt IDs and permitted actions are owned by native code. A reply is consumed
// once; dismissing/closing the owning window replies with an empty action.
std::string ShowShellPrompt(BrowserWindowInterface* browser,
                            base::DictValue prompt,
                            base::OnceCallback<void(ShellPromptReply)> reply);
std::string ShellPromptInput(BrowserWindowInterface* browser, const std::string& id);
// browserctl shell-call, for end-to-end tests only (the caller checks the
// test switch). Runs a bridge method for `browser` through the entry point
// React's calls use and answers `done` with true and the result as JSON, or
// false and an error. A request, answered by a "reply" event, answers when its
// reply arrives, or fails after 30 seconds.
using ShellCallDone = base::OnceCallback<void(bool ok, std::string json_or_error)>;
void RunShellCallForTesting(BrowserWindowInterface* browser, const std::string& method,
                            const std::string& args, ShellCallDone done);
void CancelShellPrompt(BrowserWindowInterface* browser, const std::string& id);
// After Merlin quit unexpectedly: asks whether to restore the last session,
// in place of Chromium's crash bubble, which needs a BrowserView (patch 0079).
// Nothing for a private window.
void ShowShellSessionCrashedPrompt(BrowserWindowInterface* browser);
}  // namespace modal_browser
#endif
