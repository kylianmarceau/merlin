// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_URLS_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_URLS_H_

#include <string>

class GURL;

namespace modal_browser {

// What Merlin shows for a URL: chrome://x reads merlin://x, and the start
// page (chrome://merlin-start, chrome://newtab) reads merlin://start. Any
// other URL is returned as is. For display only: the real URL never changes,
// and typing merlin://x opens chrome://x (core/src/target.rs). With
// --modal-browser-upstream-defaults, chrome:// stays chrome://.
std::string MerlinDisplayUrl(const GURL& url);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_URLS_H_
