// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PAGES_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PAGES_H_

#include <string>
#include <string_view>

#include "base/containers/span.h"

namespace content {
class WebUI;
}

namespace modal_browser {

class ModalBrowserController;

// What Merlin's own pages (Settings, History, Downloads, Bookmarks) share:
// the design tokens and components (merlin.css), small DOM and key helpers
// (merlin.js) and the Merlin tile as the tab icon (icon.svg). Each page's
// HTML links them next to its own files. Pages are inline strings like the
// start page: no build step, nothing loaded until a page is opened.
//
// Keys: in Normal mode Merlin passes unbound keys to the page, and link
// hints (f) reach every button and field. Pages add a few letters Merlin
// leaves unbound: s focuses the page's search field, Esc leaves it.

struct MerlinPageFile {
  const char* path;
  const char* content;
};

// Adds the data source for chrome://`host`, serving `files` plus the shared
// files. "" and unknown paths without a dot serve `files[0]` (index.html),
// so chrome://merlin-settings/keys opens the page on its Keys section.
void AddMerlinPageSource(content::WebUI* web_ui,
                          std::string_view host,
                          base::span<const MerlinPageFile> files);

// The controller of the window showing `web_ui`, or null (a page in a
// window Merlin does not manage, such as an app window).
ModalBrowserController* ControllerForWebUI(content::WebUI* web_ui);

// Registers Settings, History, Downloads and Bookmarks once per process.
// Registration only: no page work happens until one is opened.
void InstallMerlinPages();

// The shared files, for tests.
const char* MerlinSharedFile(const std::string& path);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PAGES_H_
