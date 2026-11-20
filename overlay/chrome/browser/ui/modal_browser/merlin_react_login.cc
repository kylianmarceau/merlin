// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.

#include "chrome/browser/ui/modal_browser/merlin_react_login.h"

#include <map>
#include <string>
#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/utf_string_conversions.h"
#include "base/time/time.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/login/login_handler.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "components/password_manager/core/browser/password_form.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/web_contents.h"
#include "net/base/auth.h"

namespace modal_browser {
namespace {

// A site that asks again this soon after a sign-in was sent refused it: the
// shell then shakes the prompt and says so, as a refused password field does.
constexpr base::TimeDelta kRefusedWithin = base::Seconds(30);

// When a sign-in was last sent to each site and realm in this session.
std::map<std::string, base::TimeTicks>& SentSignIns() {
  static base::NoDestructor<std::map<std::string, base::TimeTicks>> sent;
  return *sent;
}

std::string ChallengeKey(const net::AuthChallengeInfo& info) {
  return std::string(info.is_proxy ? "proxy " : "") + info.challenger.Serialize() + " " + info.realm;
}

BrowserWindowInterface* ShellBrowserFor(content::WebContents* contents) {
  if (!contents || !ReactShellEnabled()) return nullptr;
  auto* tab = tabs::TabInterface::MaybeGetFromContents(contents->GetOutermostWebContents());
  auto* browser = tab ? tab->GetBrowserWindowInterface() : nullptr;
  return browser && browser->GetType() == BrowserWindowInterface::Type::TYPE_NORMAL ? browser : nullptr;
}

class ReactLoginHandler final : public LoginHandler {
 public:
  ReactLoginHandler(const net::AuthChallengeInfo& auth_info, content::WebContents* contents,
                    content::LoginDelegate::LoginAuthRequiredCallback auth_required_callback)
      : LoginHandler(auth_info, contents, std::move(auth_required_callback)) {}
  ReactLoginHandler(const ReactLoginHandler&) = delete;
  ReactLoginHandler& operator=(const ReactLoginHandler&) = delete;
  // LoginHandler can't call CloseDialog once this part has gone.
  ~ReactLoginHandler() override { CloseDialog(); }

 protected:
  bool BuildViewImpl(const std::u16string& authority, const std::u16string& explanation,
                     LoginModelData* login_model_data) override {
    auto* browser = ShellBrowserFor(web_contents());
    if (!browser) return false;
    browser_ = browser->GetWeakPtr();
    const std::string key = ChallengeKey(auth_info());
    auto& sent = SentSignIns();
    const auto last = sent.find(key);
    const bool refused = last != sent.end() && base::TimeTicks::Now() - last->second < kRefusedWithin;
    if (last != sent.end()) sent.erase(last);
    // A saved or previously typed name for this site fills the first field.
    const std::u16string username = login_model_data ? login_model_data->form->username_value : std::u16string();
    auto prompt = base::DictValue()
        .Set("kind", "signIn").Set("anchor", "page").Set("origin", base::UTF16ToUTF8(authority))
        .Set("title", "Sign in").Set("message", base::UTF16ToUTF8(explanation))
        .Set("input", base::DictValue().Set("label", "User name").Set("defaultValue", base::UTF16ToUTF8(username)))
        .Set("secret", base::DictValue().Set("label", "Password"))
        .Set("actions", base::ListValue()
            .Append(base::DictValue().Set("id", "cancel").Set("label", "Cancel").Set("emphasis", "normal"))
            .Append(base::DictValue().Set("id", "accept").Set("label", "Sign In").Set("emphasis", "primary")));
    if (refused) prompt.Set("failed", true);
    // The shell answers with no action at once when it can't ask (a window
    // without the shell); that answer must not cancel from inside this call.
    building_ = true;
    id_ = ShowShellPrompt(browser, std::move(prompt),
                          base::BindOnce(&ReactLoginHandler::Answered, weak_factory_.GetWeakPtr()));
    building_ = false;
    return !id_.empty();
  }

  void CloseDialog() override {
    if (!id_.empty() && browser_) CancelShellPrompt(browser_.get(), id_);
    id_.clear();
  }

 private:
  void Answered(ShellPromptReply reply) {
    if (building_) return;
    id_.clear();
    if (reply.action == "accept") {
      SentSignIns()[ChallengeKey(auth_info())] = base::TimeTicks::Now();
      SetAuth(base::UTF8ToUTF16(reply.text), base::UTF8ToUTF16(reply.secret));
    } else {
      CancelAuth(/*notify_others=*/true);
    }
  }

  base::WeakPtr<BrowserWindowInterface> browser_;
  std::string id_;
  bool building_ = false;
  base::WeakPtrFactory<ReactLoginHandler> weak_factory_{this};
};

}  // namespace

bool UsesReactLoginPrompt(content::WebContents* contents) {
  return ShellBrowserFor(contents) != nullptr;
}

std::unique_ptr<LoginHandler> CreateReactLoginHandler(
    const net::AuthChallengeInfo& auth_info, content::WebContents* contents,
    content::LoginDelegate::LoginAuthRequiredCallback auth_required_callback) {
  return std::make_unique<ReactLoginHandler>(auth_info, contents, std::move(auth_required_callback));
}

}  // namespace modal_browser
