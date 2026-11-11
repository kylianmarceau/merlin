// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_PASSWORDS_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_PASSWORDS_H_

class BrowserWindowInterface;
namespace content {
class WebContents;
}

namespace modal_browser {

// Shows the password manager's save/update offer for `contents` as a shell
// prompt, or opens saved passwords when the person asked to manage them.
// `user_action` is false for offers made after a sign-in form submits; those
// wait behind the toolbar's request button.
void ShowReactPasswordBubble(BrowserWindowInterface* browser,
                             content::WebContents* contents,
                             bool user_action);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_PASSWORDS_H_
