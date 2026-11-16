// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_URLS_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_URLS_H_

#include <string>
#include <string_view>

class GURL;
namespace content {
class WebContents;
}

namespace modal_browser {

// A URL as the address field shows it while not editing, formatted as
// Chromium's omnibox formats it (LocationBarModelImpl::GetURLForDisplay): no
// user name or password, no http:// or https://, no "www.", ports kept, and
// an internationalized host in Unicode only when it passes Chromium's spoof
// checks (else punycode). chrome:// pages read merlin://. `host` is the
// leading part of `url` that names the site, which the field emphasizes.
struct ShellDisplayUrl {
  std::string url;
  std::string host;
};
ShellDisplayUrl FormatShellDisplayUrl(const GURL& url);

// The page's security as the shell shows it, from Chromium's security state
// (the same source as its own lock icon), never from the URL's scheme:
// "secure", "insecure" (http, or https with a weaker connection),
// "dangerous" (a certificate error, even one the person chose to proceed
// past, or a flagged site), "internal" (Merlin's pages, files, about:) or
// "pending" (an address being opened whose security isn't known yet).
std::string ShellSecurityState(content::WebContents* contents);

// What Merlin shows for a URL: chrome://x reads merlin://x, and the start
// page (chrome://merlin-start, chrome://newtab) reads merlin://start. Any
// other URL is returned as is. For display only: the real URL never changes,
// and typing merlin://x opens chrome://x (core/src/target.rs). With
// --modal-browser-upstream-defaults, chrome:// stays chrome://.
std::string MerlinDisplayUrl(const GURL& url);

// Translate a typed merlin:// alias with the command core's URL policy.
// Returns an empty URL for ordinary addresses/searches or invalid input.
GURL MerlinInternalUrl(std::u16string_view text);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_URLS_H_
