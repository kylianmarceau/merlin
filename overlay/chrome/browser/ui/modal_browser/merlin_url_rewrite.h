// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_URL_REWRITE_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_URL_REWRITE_H_

class GURL;

namespace modal_browser {

// Merlin's own pages, served by merlin_pages.cc.
inline constexpr char kMerlinSettingsHost[] = "merlin-settings";
inline constexpr char kMerlinHistoryHost[] = "merlin-history";
inline constexpr char kMerlinDownloadsHost[] = "merlin-downloads";
inline constexpr char kMerlinBookmarksHost[] = "merlin-bookmarks";

// Called by ChromeContentBrowserClient::HandleWebUI (patches/0010) before
// it resolves a chrome:// URL, so every way of opening these pages (menus,
// ⌘, and ⌘Y, links, typed URLs) lands on Merlin's:
//
//   chrome://settings, /help, and the Google account, sync and AI pages
//                        -> chrome://merlin-settings (/about for help)
//   chrome://history     -> chrome://merlin-history   (path and query kept)
//   chrome://downloads   -> chrome://merlin-downloads
//   chrome://bookmarks   -> chrome://merlin-bookmarks
//
// Other chrome://settings pages (site permissions, cookies, security,
// passwords) stay Chromium's: Merlin Settings links to them rather than
// reimplementing them. A `classic` query keeps Chromium's page, for the
// downloads that need its warnings. Does nothing with
// --modal-browser-upstream-defaults. Returns whether `url` changed.
bool RewriteMerlinPageUrl(GURL* url);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_URL_REWRITE_H_
