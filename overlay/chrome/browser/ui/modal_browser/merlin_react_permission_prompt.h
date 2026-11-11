// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_PERMISSION_PROMPT_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_PERMISSION_PROMPT_H_
#include <memory>
#include "components/permissions/permission_prompt.h"
class BrowserWindowInterface;
namespace content { class WebContents; }
namespace modal_browser {
std::unique_ptr<permissions::PermissionPrompt> CreateReactPermissionPrompt(
    BrowserWindowInterface* browser, content::WebContents* contents,
    permissions::PermissionPrompt::Delegate* delegate);
}
#endif
