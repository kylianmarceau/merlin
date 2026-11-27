// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_WINDOW_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_WINDOW_H_
#include <memory>
#include <string>
#include "base/functional/callback_forward.h"
#include "chrome/browser/ui/browser_window_deleter.h"
class BrowserWindow;
class BrowserWindowInterface;
namespace modal_browser {
std::unique_ptr<BrowserWindow, BrowserWindowDeleter> CreateReactBrowserWindow(
    BrowserWindowInterface* browser);
// Starts the React host early in startup (patches/0074), so its native modules
// and bundle load while Chromium loads the profile, not after the first window.
void PrewarmReactShell();
// Asks the React host to remove WebKit pages' data (MerlinShellAPI's
// clear_webkit_data; `json` as described there). `done` gets an empty string
// or an error. Browser UI thread only.
void ClearWebKitData(const std::string& json,
                     base::OnceCallback<void(std::string error)> done);
// Runs `callback` once `browser`'s React window has drawn and is on screen
// (soon, when it already has, or has no React window). Browser UI thread.
void WhenReactWindowDrawn(BrowserWindowInterface* browser,
                          base::OnceClosure callback);
// "Reload Interface": releases `browser`'s React root and creates another,
// so its interface starts again from the browser's state while its tabs carry
// on. False when `browser` has no React window. Browser UI thread only.
bool RemountReactShell(BrowserWindowInterface* browser);
// Reloads the shared React bridge (MerlinShellAPI's reload): every window's
// interface starts again. False when the host can't. Browser UI thread only.
bool ReloadReactShell(const std::string& reason);
}  // namespace modal_browser
#endif
