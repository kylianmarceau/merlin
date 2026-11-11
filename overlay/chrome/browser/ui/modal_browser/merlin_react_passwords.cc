// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
// Follows SaveUpdateBubbleController: a choice is reported to the delegate,
// a prompt closed without one reports no interaction, and the delegate always
// hears that its bubble was shown and then hidden.
#include "chrome/browser/ui/modal_browser/merlin_react_passwords.h"

#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "chrome/browser/ui/browser_tabstrip.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "chrome/browser/ui/passwords/passwords_model_delegate.h"
#include "components/password_manager/core/browser/password_form.h"
#include "components/password_manager/core/common/password_manager_ui.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace modal_browser {

namespace {

using Dict = base::DictValue;
using List = base::ListValue;
namespace ui_state = password_manager::ui;

Dict Action(const char* id, const char* label, const char* emphasis = "normal") {
  return Dict().Set("id", id).Set("label", label).Set("emphasis", emphasis);
}

// One offer. Ends when answered, or when its page navigates or closes.
class PasswordPrompt final : public content::WebContentsObserver {
 public:
  static void Show(BrowserWindowInterface* browser,
                   content::WebContents* contents,
                   base::WeakPtr<PasswordsModelDelegate> delegate,
                   Dict prompt) {
    auto* self = new PasswordPrompt(browser, contents, delegate);
    base::WeakPtr<PasswordPrompt> alive = self->weak_factory_.GetWeakPtr();
    const std::string id = ShowShellPrompt(
        browser, std::move(prompt), base::BindOnce(&PasswordPrompt::OnReply, alive));
    if (alive) {
      self->id_ = id;
      delegate->OnBubbleShown();
    }
  }

 private:
  PasswordPrompt(BrowserWindowInterface* browser,
                 content::WebContents* contents,
                 base::WeakPtr<PasswordsModelDelegate> delegate)
      : content::WebContentsObserver(contents),
        browser_(browser->GetWeakPtr()),
        delegate_(delegate),
        state_(delegate->GetState()) {}
  ~PasswordPrompt() override = default;

  void OnReply(ShellPromptReply reply) {
    id_.clear();
    // The offer may have changed while the prompt was open.
    if (delegate_ && delegate_->GetState() == state_) {
      if (reply.action == "save") {
        const auto& form = delegate_->GetPendingPassword();
        std::u16string username = form.username_value;
        if (state_ == ui_state::PENDING_PASSWORD_STATE) {
          username = base::UTF8ToUTF16(reply.text);
        }
        delegate_->SavePassword(username, form.password_value);
      } else if (reply.action == "never") {
        delegate_->NeverSavePassword();
      } else if (reply.action == "nope") {
        delegate_->OnNopeUpdateClicked();
      } else {
        delegate_->OnNoInteraction();
      }
    }
    End();
  }

  void End() {
    if (!id_.empty() && browser_) {
      CancelShellPrompt(browser_.get(), id_);
    }
    if (delegate_) {
      delegate_->OnBubbleHidden();
    }
    delete this;
  }

  // content::WebContentsObserver:
  void PrimaryPageChanged(content::Page&) override {
    if (delegate_ && delegate_->GetState() != state_) {
      End();
    }
  }
  void WebContentsDestroyed() override {
    delegate_.reset();
    End();
  }

  base::WeakPtr<BrowserWindowInterface> browser_;
  base::WeakPtr<PasswordsModelDelegate> delegate_;
  const ui_state::State state_;
  std::string id_;
  base::WeakPtrFactory<PasswordPrompt> weak_factory_{this};
};

}  // namespace

void ShowReactPasswordBubble(BrowserWindowInterface* browser,
                             content::WebContents* contents,
                             bool user_action) {
  base::WeakPtr<PasswordsModelDelegate> delegate =
      contents ? PasswordsModelDelegateFromWebContents(contents) : nullptr;
  if (!browser || !delegate) {
    return;
  }
  const std::string site = delegate->GetOrigin().host();
  switch (delegate->GetState()) {
    case ui_state::PENDING_PASSWORD_STATE: {
      const auto& form = delegate->GetPendingPassword();
      PasswordPrompt::Show(
          browser, contents, delegate,
          Dict()
              .Set("kind", "confirm")
              .Set("anchor", "site")
              .Set("origin", site)
              .Set("quiet", !user_action)
              .Set("title", "Save password?")
              .Set("message", "Merlin can fill this password next time you "
                              "sign in to " + site + ".")
              .Set("input", Dict()
                                .Set("label", "Username")
                                .Set("defaultValue",
                                     base::UTF16ToUTF8(form.username_value)))
              .Set("actions", List()
                                  .Append(Action("never", "Never for this site"))
                                  .Append(Action("dismiss", "Not now"))
                                  .Append(Action("save", "Save", "primary"))));
      return;
    }
    case ui_state::PENDING_PASSWORD_UPDATE_STATE: {
      const auto& form = delegate->GetPendingPassword();
      PasswordPrompt::Show(
          browser, contents, delegate,
          Dict()
              .Set("kind", "confirm")
              .Set("anchor", "site")
              .Set("origin", site)
              .Set("quiet", !user_action)
              .Set("title", "Update password?")
              .Set("message",
                   form.username_value.empty()
                       ? "Replace the password saved for " + site + "."
                       : "Replace the saved password for " +
                             base::UTF16ToUTF8(form.username_value) + " on " +
                             site + ".")
              .Set("actions", List()
                                  .Append(Action("nope", "Not now"))
                                  .Append(Action("save", "Update", "primary"))));
      return;
    }
    default:
      // Saved, managed and other states: show the password manager.
      if (user_action) {
        chrome::AddTabAt(browser, GURL("chrome://password-manager/passwords"),
                         -1, true);
      }
      return;
  }
}

}  // namespace modal_browser
