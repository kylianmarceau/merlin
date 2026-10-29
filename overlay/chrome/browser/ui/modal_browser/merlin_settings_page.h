// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SETTINGS_PAGE_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SETTINGS_PAGE_H_

#include <memory>
#include <string>

#include "content/public/browser/web_ui_controller.h"

namespace content {
class WebUIConfig;
}

namespace modal_browser {

// Merlin Settings, chrome://merlin-settings (shown as merlin://settings;
// chrome://settings and ⌘, land here through merlin_url_rewrite.h).
//
// Sections: Appearance, Keys, Browsing, Workspaces, Privacy, Passwords,
// Extensions, About. Simple preferences are set here directly through the
// same prefs and services Chromium's settings use. Security-heavy pages
// (site permissions, cookies, Safe Browsing, certificates, saved passwords,
// clearing data) open Chromium's own pages, which keep their logic and are
// restyled by merlin_restyle.cc. There is no Google account, sync or AI
// section.
class MerlinSettingsUI : public content::WebUIController {
 public:
  explicit MerlinSettingsUI(content::WebUI* web_ui);
  MerlinSettingsUI(const MerlinSettingsUI&) = delete;
  MerlinSettingsUI& operator=(const MerlinSettingsUI&) = delete;
  ~MerlinSettingsUI() override;

  // Chromium pages Settings may open, by the key the page sends; empty for
  // an unknown key. For tests.
  static std::string LinkTarget(const std::string& key);

  WEB_UI_CONTROLLER_TYPE_DECL();
};

std::unique_ptr<content::WebUIConfig> MakeMerlinSettingsConfig();

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SETTINGS_PAGE_H_
