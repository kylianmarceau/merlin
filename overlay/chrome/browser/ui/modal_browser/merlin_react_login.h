// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
//
// A site's HTTP sign-in (Basic or Digest authentication) asked by the React
// shell, in place of Chromium's login dialog.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_LOGIN_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_LOGIN_H_

#include <memory>
#include "content/public/browser/login_delegate.h"

class LoginHandler;
namespace content { class WebContents; }
namespace net { class AuthChallengeInfo; }

namespace modal_browser {
// Whether the shell asks for this page's sign-in: a tab in a normal window
// of the React shell.
bool UsesReactLoginPrompt(content::WebContents* contents);
std::unique_ptr<LoginHandler> CreateReactLoginHandler(
    const net::AuthChallengeInfo& auth_info,
    content::WebContents* contents,
    content::LoginDelegate::LoginAuthRequiredCallback auth_required_callback);
}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_LOGIN_H_
