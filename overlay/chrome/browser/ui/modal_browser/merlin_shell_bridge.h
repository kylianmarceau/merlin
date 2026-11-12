// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SHELL_BRIDGE_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SHELL_BRIDGE_H_

#include <string>
#include "base/functional/callback.h"
#include "base/values.h"

class BrowserWindowInterface;
namespace modal_browser {
// Browser UI thread only. No page renderer can access these functions.
struct ShellPromptReply {
  std::string action;
  std::string text;
  bool suppress = false;
};
bool ReactShellEnabled();
// Shows the window's newly active page in the place React gave the previous
// one, so a tab switch does not wait for React to re-render. Split views and
// the start page (`start_page`) are left to React.
void RevealActivePage(BrowserWindowInterface* browser, bool start_page);
void NotifyShellWindow(BrowserWindowInterface* browser);
void SetShellFindState(BrowserWindowInterface* browser, base::DictValue state);
bool ShellFindHasFocus(BrowserWindowInterface* browser);
void SendShellEvent(BrowserWindowInterface* browser, const char* type);
// Opens a React shell panel: "settings", "history", "bookmarks", "downloads",
// "extensions" or "profiles". False when `browser` has no React window.
bool OpenShellPanel(BrowserWindowInterface* browser, const char* panel);
// Prompt IDs and permitted actions are owned by native code. A reply is consumed
// once; dismissing/closing the owning window replies with an empty action.
std::string ShowShellPrompt(BrowserWindowInterface* browser,
                            base::DictValue prompt,
                            base::OnceCallback<void(ShellPromptReply)> reply);
std::string ShellPromptInput(BrowserWindowInterface* browser, const std::string& id);
void CancelShellPrompt(BrowserWindowInterface* browser, const std::string& id);
}  // namespace modal_browser
#endif
