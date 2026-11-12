// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PROCESS_POLICY_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PROCESS_POLICY_H_

#include <string_view>

namespace base {
class CommandLine;
}

namespace modal_browser {

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

// Chromium features Merlin switches off by default: Gemini in Chrome, Google
// Lens, Help me write, casting, and the built-in AI APIs pages can call
// (which download an on-device model of several GB). Chromium's desktop code
// can't be built without them, so they are off at run time instead.
inline constexpr const char* kMerlinDisabledFeatures[] = {
    "Glic",                // Gemini in Chrome
    "ApiGlicPrivate",      // Gemini's component extension
    "LensOverlay",         // Lens screen search
    "LensStandalone",      // "Search with Google Lens" in context menus
    "Compose",             // Help me write
    "MediaRouter",         // Cast
    "AIPromptAPI",         // window.LanguageModel
    "AISummarizationAPI",  // Summarizer
    "AIWriterAPI",         // Writer
    "AIRewriterAPI",       // Rewriter
    "AIProofreadingAPI",   // Proofreader
};

// Called by ChromeFeatureListCreator::SetUpFieldTrials (patches/0065) before
// the browser's feature list is built. Adds kMerlinDisabledFeatures to
// --disable-features on `command_line`, except features named in
// --enable-features, which wins. No change with
// --modal-browser-upstream-defaults.
void AddMerlinDisabledFeatures(base::CommandLine& command_line);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PROCESS_POLICY_H_
