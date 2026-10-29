// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_LIBRARY_PAGES_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_LIBRARY_PAGES_H_

#include <memory>

#include "content/public/browser/web_ui_controller.h"

namespace content {
class WebUIConfig;
}

namespace modal_browser {

// Merlin's History, Downloads and Bookmarks pages (chrome://merlin-history
// and friends, shown as merlin://history; chrome://history, ⌘Y and the
// menus land here through merlin_url_rewrite.h). Each is a searchable list
// with the same rows and keys as the palette's lists; the palette stays the
// quick way in (:history, :palette downloads, :bookmarks) and these are the
// full-page views.

class MerlinHistoryUI : public content::WebUIController {
 public:
  explicit MerlinHistoryUI(content::WebUI* web_ui);
  ~MerlinHistoryUI() override;
  WEB_UI_CONTROLLER_TYPE_DECL();
};

class MerlinDownloadsUI : public content::WebUIController {
 public:
  explicit MerlinDownloadsUI(content::WebUI* web_ui);
  ~MerlinDownloadsUI() override;
  WEB_UI_CONTROLLER_TYPE_DECL();
};

class MerlinBookmarksUI : public content::WebUIController {
 public:
  explicit MerlinBookmarksUI(content::WebUI* web_ui);
  ~MerlinBookmarksUI() override;
  WEB_UI_CONTROLLER_TYPE_DECL();
};

std::unique_ptr<content::WebUIConfig> MakeMerlinHistoryConfig();
std::unique_ptr<content::WebUIConfig> MakeMerlinDownloadsConfig();
std::unique_ptr<content::WebUIConfig> MakeMerlinBookmarksConfig();

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_LIBRARY_PAGES_H_
