// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_url_rewrite.h"

#include <string>
#include <string_view>

#include "base/command_line.h"
#include "url/gurl.h"

namespace modal_browser {

namespace {

// Same string as kUpstreamDefaultsSwitch (modal_browser_controller.h); this
// target links into //chrome/browser and cannot depend on the controller.
constexpr char kUpstreamDefaults[] = "modal-browser-upstream-defaults";

// Merlin Settings sections whose names Chromium's Settings does not use,
// so merlin://settings/keys opens that section.
bool IsMerlinSection(std::string_view path) {
  return path == "/keys" || path == "/browsing" || path == "/workspaces" ||
         path == "/about";
}

// chrome://settings pages Merlin Settings replaces: the main page, About,
// and the Google account, sync and AI pages, which Merlin has no use for.
bool IsReplacedSettingsPath(std::string_view path) {
  if (IsMerlinSection(path)) {
    return true;
  }
  if (path.empty() || path == "/" || path == "/help" || path == "/people" ||
      path == "/googleServices") {
    return true;
  }
  for (std::string_view prefix : {"/syncSetup", "/ai", "/signOut"}) {
    if (path.substr(0, prefix.size()) == prefix &&
        (path.size() == prefix.size() || path[prefix.size()] == '/')) {
      return true;
    }
  }
  return false;
}

}  // namespace

bool RewriteMerlinPageUrl(GURL* url) {
  if (!url || !url->is_valid() || !url->SchemeIs("chrome") ||
      base::CommandLine::ForCurrentProcess()->HasSwitch(kUpstreamDefaults)) {
    return false;
  }
  const std::string host(url->host());
  const std::string path(url->path());
  std::string new_host;
  std::string new_path = path;
  if (host == "settings") {
    if (!IsReplacedSettingsPath(path)) {
      return false;
    }
    new_host = kMerlinSettingsHost;
    new_path = path == "/help"            ? "/about"
               : IsMerlinSection(path) ? path
                                        : "/";
  } else if (url->query() == "classic") {
    return false;
  } else if (host == "history") {
    new_host = kMerlinHistoryHost;
  } else if (host == "downloads") {
    new_host = kMerlinDownloadsHost;
  } else if (host == "bookmarks") {
    new_host = kMerlinBookmarksHost;
  } else {
    return false;
  }
  GURL::Replacements replacements;
  replacements.SetHostStr(new_host);
  replacements.SetPathStr(new_path);
  if (host == "settings") {
    replacements.ClearQuery();
    replacements.ClearRef();
  }
  *url = url->ReplaceComponents(replacements);
  return true;
}

}  // namespace modal_browser
