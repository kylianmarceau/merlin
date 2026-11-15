// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_AUTO_PIP_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_AUTO_PIP_H_

namespace content {
class WebContents;
}

namespace modal_browser {

// Automatic picture-in-picture, as in Safari: a video playing with sound
// floats when its tab is left, and returns to the page when the tab is
// shown again. A video the user floated themselves stays floating. Off with
// Settings > General > Picture in picture (this profile pref).
inline constexpr char kAutoPipPref[] = "merlin.auto_pip";

// The window's active tab changed from `previous` to `current` (either may
// be null). Browser UI thread; safe inside a tab strip notification.
void MerlinAutoPipActiveTabChanged(content::WebContents* previous,
                                   content::WebContents* current);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_AUTO_PIP_H_
