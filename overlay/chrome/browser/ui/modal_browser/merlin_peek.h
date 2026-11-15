// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PEEK_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PEEK_H_

#include "base/values.h"

class BrowserWindowInterface;
class GURL;
namespace content {
class WebContents;
}

namespace modal_browser {

// Peek: a link opened in a floating card over the current page (the `gf`
// hint, `:peek`), so it can be read without leaving the tab. Each window
// shows at most one; peeking again loads the new link in it. The card closes
// on Escape, Command-W, window.close(), a renderer crash, a tab switch or
// when the window closes; Command-Return (or the card's button) moves the
// page into a tab of its own beside the current one. Browser UI thread only.

// Loads `url` in the window's peek, opening one if needed. False when the
// window has no React shell (the caller then opens a tab).
bool OpenMerlinPeek(BrowserWindowInterface* browser, const GURL& url);
void CloseMerlinPeek(BrowserWindowInterface* browser);
// Moves the peeked page into a new active tab after the current one.
void PromoteMerlinPeek(BrowserWindowInterface* browser);

// The peek's page, for the shell to embed. Null when none is open.
content::WebContents* MerlinPeekContents(BrowserWindowInterface* browser);

// The snapshot's `peek`: {url, title, loading, canGoBack}, or none.
base::Value MerlinPeekState(BrowserWindowInterface* browser);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PEEK_H_
