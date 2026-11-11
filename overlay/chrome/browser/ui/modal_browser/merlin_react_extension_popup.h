// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_EXTENSION_POPUP_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_EXTENSION_POPUP_H_

#include "base/values.h"

class BrowserWindowInterface;
class GURL;
namespace content {
class WebContents;
}
namespace extensions {
class Extension;
}

namespace modal_browser {

// An extension's action popup, shown in the React window's anchored popover
// rather than in a tab. Each window shows at most one; opening another
// closes the first. The popup page sizes itself, as in Chromium's own popup,
// and closes on Escape, window.close(), unload, a renderer crash or when the
// window closes. Browser UI thread only.
void ShowShellExtensionPopup(BrowserWindowInterface* browser,
                             const extensions::Extension& extension,
                             const GURL& url);
void CloseShellExtensionPopup(BrowserWindowInterface* browser);

// The popup's page, for the shell to embed. Null when no popup is open.
content::WebContents* ShellExtensionPopupContents(
    BrowserWindowInterface* browser);

// The snapshot's `extensionPopup`: {extensionId, name, width, height, ready},
// or none.
base::Value ShellExtensionPopupState(BrowserWindowInterface* browser);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_EXTENSION_POPUP_H_
