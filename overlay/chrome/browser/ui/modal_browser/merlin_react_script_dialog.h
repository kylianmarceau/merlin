// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_SCRIPT_DIALOG_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_SCRIPT_DIALOG_H_
#include <memory>
#include "base/memory/weak_ptr.h"
#include "content/public/browser/javascript_dialog_manager.h"
class BrowserWindowInterface;
namespace javascript_dialogs {
class TabModalDialogView;
class AppModalDialogView;
class AppModalDialogController;
}
namespace modal_browser {
base::WeakPtr<javascript_dialogs::TabModalDialogView> CreateReactScriptDialog(
    BrowserWindowInterface* browser, content::WebContents* contents,
    const std::u16string& title, content::JavaScriptDialogType type,
    const std::u16string& message, const std::u16string& default_text,
    content::JavaScriptDialogManager::DialogClosedCallback reply,
    base::OnceClosure forced_close);
javascript_dialogs::AppModalDialogView* CreateReactAppScriptDialog(
    BrowserWindowInterface* browser,
    std::unique_ptr<javascript_dialogs::AppModalDialogController> controller);
}
#endif
