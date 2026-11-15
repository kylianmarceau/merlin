// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SHELL_SERVICES_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SHELL_SERVICES_H_

#include <string>

#include "base/functional/callback.h"
#include "base/values.h"

class BrowserWindowInterface;

namespace modal_browser {

// The answer to one shell request: a value, or an error to show.
struct ShellServiceResult {
  base::Value value;
  std::string error;
};
using ShellServiceReply = base::OnceCallback<void(ShellServiceResult)>;

// Requests the React shell makes for data Chromium produces asynchronously or
// on demand: settings, the config file, workspaces, history, bookmarks,
// extensions and downloads. Returns false when `method` is not one of them.
// `reply` runs exactly once, possibly before this returns, and must not
// assume `browser` is still open. Browser UI thread only.
bool RunShellService(BrowserWindowInterface* browser,
                     const std::string& method,
                     const base::DictValue& args,
                     ShellServiceReply reply);

// Shows the active page's connection security and blocking state as a shell
// prompt, with links to its site settings.
void ShowShellSiteInfo(BrowserWindowInterface* browser);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SHELL_SERVICES_H_
