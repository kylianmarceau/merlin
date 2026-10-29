// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_START_PAGE_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_START_PAGE_H_

#include "content/public/browser/web_ui_controller.h"

class Profile;

namespace modal_browser {

// Merlin's start page, chrome://merlin-start, shown for new tabs in place
// of Chromium's (redesign step 2).
//
// The page is our own WebUI: HTML, CSS and JS are served from this file's
// strings, and a message handler gives it the saved workspaces and recently
// closed tabs. Nothing leaves the browser. What the user types and the
// workspaces they open go through the window's command registry, the same
// path as `:` and browserctl.
//
// Keys: the page labels items with letters that Merlin leaves unbound in
// Normal mode (a s w e c x z), and unbound keys already reach the page, so
// the labels work like link hints without new routing.
inline constexpr char kMerlinStartHost[] = "merlin-start";
inline constexpr char kMerlinStartURL[] = "chrome://merlin-start/";

// Registers the WebUI once per process.
void InstallMerlinStartPage();

// Makes the start page the new tab page for `profile`, as a default: a
// value set by the user or by policy still wins. Private profiles keep
// Chromium's private page (Chromium skips the override for them).
void SetMerlinStartAsNewTabDefault(Profile* profile);

class MerlinStartUI : public content::WebUIController {
 public:
  explicit MerlinStartUI(content::WebUI* web_ui);
  MerlinStartUI(const MerlinStartUI&) = delete;
  MerlinStartUI& operator=(const MerlinStartUI&) = delete;
  ~MerlinStartUI() override;

  // The page's files, for tests.
  static const char* FileForPath(const std::string& path);

  WEB_UI_CONTROLLER_TYPE_DECL();
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_START_PAGE_H_
