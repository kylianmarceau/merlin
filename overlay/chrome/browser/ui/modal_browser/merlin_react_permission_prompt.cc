// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_react_permission_prompt.h"
#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/permissions/permission_request.h"
#include "components/permissions/permission_util.h"
#include "components/permissions/request_type.h"
#include "content/public/browser/web_contents.h"
#include "url/origin.h"

namespace modal_browser {
namespace {
class ReactPermissionPrompt final : public permissions::PermissionPrompt {
 public:
  ReactPermissionPrompt(BrowserWindowInterface* browser, content::WebContents* contents, Delegate* delegate)
      : browser_(browser->GetWeakPtr()), contents_(contents->GetWeakPtr()), delegate_(delegate->GetWeakPtr()) {
    base::ListValue actions;
    auto action = [](const char* id, const char* label, const char* emphasis) {
      return base::DictValue().Set("id", id).Set("label", label).Set("emphasis", emphasis);
    };
    actions.Append(action("dismiss", "Not now", "normal"));
    actions.Append(action("deny", "Block", "normal"));
    bool temporary = !delegate->Requests().empty();
    std::string message;
    for (const auto& request : delegate->Requests()) {
      if (!message.empty()) message += "\n";
      message += base::UTF16ToUTF8(request->GetMessageTextFragment());
      const auto setting = permissions::RequestTypeToContentSettingsType(request->request_type());
      temporary &= setting && permissions::PermissionUtil::DoesSupportTemporaryGrants(*setting);
    }
    if (temporary) actions.Append(action("once", "Allow this time", "primary"));
    actions.Append(action("allow", temporary ? "Allow on every visit" : "Allow", temporary ? "normal" : "primary"));
    const auto requesting = url::Origin::Create(delegate->GetRequestingOrigin());
    const auto embedding = url::Origin::Create(delegate->GetEmbeddingOrigin());
    if (requesting != embedding) message += "\nEmbedded by " + embedding.Serialize();
    quiet_ = delegate->ShouldCurrentRequestUseQuietUI();
    id_ = ShowShellPrompt(browser, base::DictValue().Set("kind", "permission").Set("anchor", "site")
        .Set("origin", requesting.Serialize()).Set("title", "Site permission")
        .Set("message", message).Set("quiet", quiet_).Set("actions", std::move(actions)),
        base::BindOnce(&ReactPermissionPrompt::Answer, weak_factory_.GetWeakPtr()));
    delegate->SetPromptShown();
  }
  ~ReactPermissionPrompt() override {
    weak_factory_.InvalidateWeakPtrs();
    if (browser_) CancelShellPrompt(browser_.get(), id_);
  }
  bool UpdateAnchor() override { return !!browser_; }
  TabSwitchingBehavior GetTabSwitchingBehavior() override { return kDestroyPromptButKeepRequestPending; }
  permissions::PermissionPromptDisposition GetPromptDisposition() const override {
    return permissions::PermissionPromptDisposition::CUSTOM_MODAL_DIALOG;
  }
  bool IsAskPrompt() const override { return true; }
  std::optional<gfx::Rect> GetViewBoundsInScreen() const override { return std::nullopt; }
  std::vector<permissions::ElementAnchoredBubbleVariant> GetPromptVariants() const override { return {}; }
  std::optional<permissions::feature_params::PermissionElementPromptPosition> GetPromptPosition() const override { return std::nullopt; }
 private:
  void Answer(ShellPromptReply reply) {
    auto action = std::move(reply.action);
    if (!delegate_) return;
    // A response can never grant a background or closed tab's request.
    if (!browser_ || !contents_ || browser_->GetTabStripModel()->GetActiveWebContents() != contents_.get()) action.clear();
    auto delegate = delegate_;
    delegate->SetDecisionTime();
    const PromptOptions options = std::monostate();
    // PermissionRequestManager may delete this prompt during any of these calls.
    if (action == "allow") delegate->Accept(options);
    else if (action == "once") delegate->AcceptThisTime(options);
    else if (action == "deny") delegate->Deny(options);
    else delegate->Dismiss(options);
  }
  base::WeakPtr<BrowserWindowInterface> browser_;
  base::WeakPtr<content::WebContents> contents_;
  base::WeakPtr<Delegate> delegate_;
  std::string id_;
  bool quiet_ = false;
  base::WeakPtrFactory<ReactPermissionPrompt> weak_factory_{this};
};
}
std::unique_ptr<permissions::PermissionPrompt> CreateReactPermissionPrompt(
    BrowserWindowInterface* browser, content::WebContents* contents, permissions::PermissionPrompt::Delegate* delegate) {
  return std::make_unique<ReactPermissionPrompt>(browser, contents, delegate);
}
}  // namespace modal_browser
