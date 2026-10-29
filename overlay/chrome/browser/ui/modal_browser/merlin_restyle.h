// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_RESTYLE_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_RESTYLE_H_

namespace content {
class WebContents;
}

namespace modal_browser {

// Gives the Chromium pages Merlin keeps a Merlin look, without changing
// what they do (redesign round 2, steps 7 and 8):
//
//  * Network error pages and security warnings (certificate errors,
//    dangerous sites): Merlin's paper and charcoal, type and buttons, and
//    the Merlin tile instead of Chromium's pictures, through a stylesheet
//    added from Chrome's isolated world. Warnings keep their wording, their
//    buttons and the red of a dangerous-site warning.
//  * Chromium's Settings pages that Merlin Settings links to (site
//    permissions, cookies, security, clearing data): the section menu, which
//    lists Google and AI sections Merlin does not have, is hidden, so each
//    page shows only what it was opened for.
//
// Runs when a page finishes loading in the active tab and when a tab
// becomes active; once per document, then nothing keeps running. Does
// nothing with --modal-browser-upstream-defaults (the controller does not
// call it).
void RestyleMerlinPage(content::WebContents* contents);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_RESTYLE_H_
