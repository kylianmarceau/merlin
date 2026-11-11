// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_WINDOW_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_WINDOW_H_
#include <memory>
#include "chrome/browser/ui/browser_window_deleter.h"
class BrowserWindow;
class BrowserWindowInterface;
namespace modal_browser {
std::unique_ptr<BrowserWindow, BrowserWindowDeleter> CreateReactBrowserWindow(
    BrowserWindowInterface* browser);
}  // namespace modal_browser
#endif
