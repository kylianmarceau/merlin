// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PROCESS_POLICY_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PROCESS_POLICY_H_

#include <string_view>

namespace modal_browser {

// Merlin's start page, chrome://merlin-start (merlin_start_page.cc).
inline constexpr char kMerlinStartHost[] = "merlin-start";
inline constexpr char kMerlinStartURL[] = "chrome://merlin-start/";

// Called by ChromeContentBrowserClient::ShouldUseProcessPerSite
// (patches/0047) for chrome:// pages. Every start page in a profile shares
// one renderer process, as Chromium's own new tab page does, so ⌘T reuses a
// running process instead of starting one. False with
// --modal-browser-upstream-defaults.
bool ShouldShareMerlinPageProcess(std::string_view host);

// Called by WebUIContentsPreloadManager (patches/0048). Chromium keeps Tab
// Search, or the side panel used most, loaded in a hidden page from startup
// so it opens at once. Merlin hides Tab Search and has its own tab
// switcher, so that page is a renderer process nobody sees. False unless
// --modal-browser-upstream-defaults is set or the feature is enabled on the
// command line (--enable-features=PreloadTopChromeWebUI).
bool ShouldPreloadTopChromeWebUI();

// Called by PrerenderManager::MaybeStartPrewarmSearchResult (patches/0052).
// With Google as the default search engine, Chromium prerenders a hidden
// https://www.google.com/search/warmup.html in each tab when the address
// bar's results change, which happens on tab switches: browser main-thread
// work during the switch, a renderer and a request to Google with its
// cookies, for a page that is never shown. Merlin searches from its own
// address card and start page. False unless --modal-browser-upstream-defaults
// is set or the feature is enabled on the command line
// (--enable-features=Prewarm).
bool ShouldPrewarmDefaultSearch();

// Called by UserEducationServiceFactory::ProfileAllowsUserEducation and
// feature_engagement::NonIphPromo (patches/0060). Chromium's tip and promo
// pop-ups ("Enhance your browser with extensions", feature tips, tutorials,
// "New" badges, the high memory usage alert, "get Chrome on your phone")
// point at toolbar buttons Merlin hides, so they float with an arrow pointing
// at nothing. Every feature they advertise stays reachable from menus and
// settings. False unless --modal-browser-upstream-defaults is set.
bool ShouldShowChromiumPromos();

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PROCESS_POLICY_H_
