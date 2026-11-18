// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_react_script_dialog.h"
#include "base/check.h"
#include "base/functional/bind.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "components/javascript_dialogs/app_modal_dialog_controller.h"
#include "components/javascript_dialogs/app_modal_dialog_view.h"
#include "components/javascript_dialogs/tab_modal_dialog_view.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/base_window.h"

namespace modal_browser {
namespace {
base::DictValue ScriptPrompt(const std::u16string& origin, content::JavaScriptDialogType type,
                            const std::u16string& message, const std::u16string& default_text,
                            bool before_unload = false, bool reload = false) {
  base::ListValue actions;
  if (type != content::JAVASCRIPT_DIALOG_TYPE_ALERT || before_unload)
    actions.Append(base::DictValue().Set("id", "cancel").Set("label", before_unload ? "Stay on page" : "Cancel").Set("emphasis", "normal"));
  actions.Append(base::DictValue().Set("id", "accept").Set("label", before_unload ? (reload ? "Reload" : "Leave page") : "OK")
      .Set("emphasis", before_unload ? "danger" : "primary"));
  auto prompt = base::DictValue().Set("kind", before_unload ? "beforeUnload" : type == content::JAVASCRIPT_DIALOG_TYPE_ALERT ? "alert" : "confirm")
      .Set("anchor", "page").Set("origin", base::UTF16ToUTF8(origin)).Set("title", before_unload ? "Leave this page?" : "Message from this page")
      .Set("message", base::UTF16ToUTF8(message)).Set("actions", std::move(actions));
  if (type == content::JAVASCRIPT_DIALOG_TYPE_PROMPT)
    prompt.Set("input", base::DictValue().Set("label", "Your response").Set("defaultValue", base::UTF16ToUTF8(default_text)));
  return prompt;
}

class ReactScriptDialog final : public javascript_dialogs::TabModalDialogView {
 public:
  ReactScriptDialog(BrowserWindowInterface* browser, content::WebContents* contents,
      const std::u16string& title, content::JavaScriptDialogType type,
      const std::u16string& message, const std::u16string& default_text,
      content::JavaScriptDialogManager::DialogClosedCallback reply, base::OnceClosure forced)
      : browser_(browser->GetWeakPtr()), reply_(std::move(reply)), forced_(std::move(forced)) {
    auto* tab = tabs::TabInterface::GetFromContents(contents);
    CHECK(tab && tab->CanShowModalUI());
    modal_scope_ = tab->ShowModalUI();
    id_ = ShowShellPrompt(browser, ScriptPrompt(title, type, message, default_text),
                         base::BindOnce(&ReactScriptDialog::Finish, weak_factory_.GetWeakPtr()));
  }
  ~ReactScriptDialog() override = default;
  base::WeakPtr<javascript_dialogs::TabModalDialogView> GetWeakPtr() {
    if (closed_) return {};
    return weak_factory_.GetWeakPtr();
  }
  void CloseDialogWithoutCallback() override {
    reply_.Reset(); forced_.Reset(); Finish({});
  }
  std::u16string GetUserInput() override {
    return browser_ ? base::UTF8ToUTF16(ShellPromptInput(browser_.get(), id_)) : std::u16string();
  }
 private:
  void Finish(ShellPromptReply answer) {
    if (closed_) return;
    closed_ = true;
    if (browser_) CancelShellPrompt(browser_.get(), id_);
    modal_scope_.reset();
    auto reply = std::move(reply_);
    auto forced = std::move(forced_);
    // Manager callbacks can re-enter. Retire the view before invoking them and
    // delete on the next UI task, after its current call stack unwinds.
    base::SingleThreadTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this);
    // TabModalDialogManager holds this view by a weak pointer and answers the
    // page only while it is still valid, so invalidate it only afterwards;
    // `closed_` already keeps a re-entrant call from finishing twice.
    if (answer.action.empty()) { if (forced) std::move(forced).Run(); }
    else if (reply) std::move(reply).Run(answer.action == "accept", base::UTF8ToUTF16(answer.text));
    weak_factory_.InvalidateWeakPtrs();
  }
  base::WeakPtr<BrowserWindowInterface> browser_;
  content::JavaScriptDialogManager::DialogClosedCallback reply_;
  base::OnceClosure forced_;
  std::unique_ptr<tabs::ScopedTabModalUI> modal_scope_;
  std::string id_;
  bool closed_ = false;
  base::WeakPtrFactory<ReactScriptDialog> weak_factory_{this};
};

class ReactAppScriptDialog final : public javascript_dialogs::AppModalDialogView {
 public:
  ReactAppScriptDialog(BrowserWindowInterface* browser,
      std::unique_ptr<javascript_dialogs::AppModalDialogController> controller)
      : browser_(browser->GetWeakPtr()), controller_(std::move(controller)) {}
  ~ReactAppScriptDialog() override = default;
  void ShowAppModalDialog() override {
    if (closed_ || !id_.empty()) return;
    if (!browser_) { Finish({}); return; }
    auto prompt = ScriptPrompt(controller_->title(), controller_->javascript_dialog_type(),
        controller_->message_text(), controller_->default_prompt_text(),
        controller_->is_before_unload_dialog(), controller_->is_reload());
    prompt.Set("canSuppress", controller_->display_suppress_checkbox());
    id_ = ShowShellPrompt(browser_.get(), std::move(prompt),
                          base::BindOnce(&ReactAppScriptDialog::Finish, weak_factory_.GetWeakPtr()));
  }
  void ActivateAppModalDialog() override { if (browser_ && browser_->GetWindow()) browser_->GetWindow()->Activate(); }
  void CloseAppModalDialog() override { Finish({}); }
  void AcceptAppModalDialog() override {
    ShellPromptReply reply;
    reply.action = "accept";
    if (browser_) reply.text = ShellPromptInput(browser_.get(), id_);
    Finish(std::move(reply));
  }
  void CancelAppModalDialog() override { Finish({}); }
  bool IsShowing() const override { return !closed_ && !id_.empty(); }
 private:
  void Finish(ShellPromptReply answer) {
    if (closed_) return;
    closed_ = true;
    weak_factory_.InvalidateWeakPtrs();
    if (browser_) CancelShellPrompt(browser_.get(), id_);
    base::SingleThreadTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this);
    if (answer.action == "accept") controller_->OnAccept(base::UTF8ToUTF16(answer.text), answer.suppress);
    else controller_->OnCancel(answer.suppress);
  }
  base::WeakPtr<BrowserWindowInterface> browser_;
  std::unique_ptr<javascript_dialogs::AppModalDialogController> controller_;
  std::string id_;
  bool closed_ = false;
  base::WeakPtrFactory<ReactAppScriptDialog> weak_factory_{this};
};
}
base::WeakPtr<javascript_dialogs::TabModalDialogView> CreateReactScriptDialog(
    BrowserWindowInterface* browser, content::WebContents* contents,
    const std::u16string& title, content::JavaScriptDialogType type,
    const std::u16string& message, const std::u16string& default_text,
    content::JavaScriptDialogManager::DialogClosedCallback reply, base::OnceClosure forced_close) {
  return (new ReactScriptDialog(browser, contents, title, type, message, default_text,
      std::move(reply), std::move(forced_close)))->GetWeakPtr();
}
javascript_dialogs::AppModalDialogView* CreateReactAppScriptDialog(BrowserWindowInterface* browser,
    std::unique_ptr<javascript_dialogs::AppModalDialogController> controller) {
  return new ReactAppScriptDialog(browser, std::move(controller));
}
}  // namespace modal_browser
