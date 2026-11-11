// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
// Mirrors the Views bubbles' contracts: a decision is reported before the
// bubble closes, Hide() reports the close synchronously, and the address
// controllers are owned by their bubble.
#include "chrome/browser/ui/modal_browser/merlin_react_autofill.h"

#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "chrome/browser/ui/autofill/autofill_bubble_base.h"
#include "chrome/browser/ui/autofill/autofill_bubble_handler.h"
#include "chrome/browser/ui/autofill/payments/save_card_bubble_controller.h"
#include "chrome/browser/ui/autofill/save_address_bubble_controller.h"
#include "chrome/browser/ui/autofill/update_address_bubble_controller.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_profile.h"
#include "components/autofill/core/browser/data_model/payments/credit_card.h"
#include "components/autofill/core/browser/field_types.h"
#include "components/autofill/core/browser/payments/payments_autofill_client.h"
#include "components/autofill/core/browser/ui/payments/payments_ui_closed_reasons.h"
#include "components/signin/public/base/signin_buildflags.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"

namespace modal_browser {

namespace {

using autofill::AutofillBubbleBase;
using Dict = base::DictValue;
using List = base::ListValue;
using Decision = autofill::AutofillClient::AddressPromptUserDecision;

Dict Action(const std::string& id, const std::u16string& label,
            const char* emphasis = "normal") {
  return Dict().Set("id", id).Set("label", label).Set("emphasis", emphasis);
}

std::u16string Summary(const autofill::AutofillProfile& profile) {
  std::vector<std::u16string> lines;
  for (autofill::FieldType type :
       {autofill::NAME_FULL, autofill::ADDRESS_HOME_LINE1,
        autofill::ADDRESS_HOME_CITY, autofill::ADDRESS_HOME_ZIP,
        autofill::EMAIL_ADDRESS, autofill::PHONE_HOME_WHOLE_NUMBER}) {
    std::u16string value = profile.GetRawInfo(type);
    if (!value.empty()) {
      lines.push_back(std::move(value));
    }
  }
  return base::JoinString(lines, u"\n");
}

// A shell prompt standing in for an autofill bubble. Owns itself; ends once,
// by answer, Hide(), or the page closing.
class ShellAutofillBubble final : public AutofillBubbleBase,
                                  public content::WebContentsObserver {
 public:
  // `action` is empty when the prompt ended without a choice; `hidden` is
  // true when the controller ended it through Hide().
  using Answer = base::OnceCallback<void(const std::string& action,
                                         const std::string& text,
                                         bool hidden)>;

  static ShellAutofillBubble* Show(BrowserWindowInterface* browser,
                                   content::WebContents* contents,
                                   Dict prompt,
                                   Answer answer) {
    auto* bubble = new ShellAutofillBubble(browser, contents, std::move(answer));
    base::WeakPtr<ShellAutofillBubble> alive = bubble->weak_factory_.GetWeakPtr();
    const std::string id = ShowShellPrompt(
        browser, std::move(prompt),
        base::BindOnce(&ShellAutofillBubble::OnReply, alive));
    // No React window: the prompt answered at once and the bubble ended.
    if (!alive) {
      return nullptr;
    }
    bubble->prompt_ = id;
    return bubble;
  }

  // AutofillBubbleBase:
  void Hide() override { Finish({}, {}, /*hidden=*/true); }
  bool IsMouseHovered() const override { return false; }

 private:
  ShellAutofillBubble(BrowserWindowInterface* browser,
                      content::WebContents* contents,
                      Answer answer)
      : content::WebContentsObserver(contents),
        browser_(browser->GetWeakPtr()),
        answer_(std::move(answer)) {}
  ~ShellAutofillBubble() override = default;

  void OnReply(ShellPromptReply reply) {
    prompt_.clear();
    Finish(reply.action, reply.text, /*hidden=*/false);
  }

  void Finish(const std::string& action, const std::string& text, bool hidden) {
    if (finishing_) {
      return;  // The answer itself asked the bubble to hide.
    }
    finishing_ = true;
    if (!prompt_.empty() && browser_) {
      CancelShellPrompt(browser_.get(), prompt_);
    }
    prompt_.clear();
    if (answer_) {
      std::move(answer_).Run(action, text, hidden);
    }
    delete this;
  }

  // content::WebContentsObserver: the controllers are tab data and are going
  // away too, so nothing is reported to them.
  void WebContentsDestroyed() override {
    answer_.Reset();
    Finish({}, {}, true);
  }

  base::WeakPtr<BrowserWindowInterface> browser_;
  Answer answer_;
  std::string prompt_;
  bool finishing_ = false;
  base::WeakPtrFactory<ShellAutofillBubble> weak_factory_{this};
};

class ReactAutofillBubbleHandler final : public autofill::AutofillBubbleHandler {
 public:
  explicit ReactAutofillBubbleHandler(BrowserWindowInterface* browser)
      : browser_(browser) {}

  AutofillBubbleBase* ShowSaveAddressProfileBubble(
      content::WebContents* contents,
      std::unique_ptr<autofill::SaveAddressBubbleController> controller,
      bool is_user_gesture) override {
    const Decision cancel = controller->GetCancelCallbackValue();
    Dict prompt = AddressPrompt(
        u"Save address?", Summary(controller->GetAutofillProfile()),
        cancel == Decision::kNever ? u"Never" : u"No thanks", u"Save",
        is_user_gesture);
    return ShellAutofillBubble::Show(
        browser_, contents, std::move(prompt),
        base::BindOnce(
            [](std::unique_ptr<autofill::SaveAddressBubbleController> controller,
               const std::string& action, const std::string&, bool) {
              if (action == "save") {
                controller->OnUserDecision(Decision::kAccepted,
                                           controller->GetAutofillProfile());
              } else if (action == "decline") {
                controller->OnUserDecision(controller->GetCancelCallbackValue(),
                                           std::nullopt);
              }
              controller->OnBubbleClosed();
            },
            std::move(controller)));
  }

  AutofillBubbleBase* ShowUpdateAddressProfileBubble(
      content::WebContents* contents,
      std::unique_ptr<autofill::UpdateAddressBubbleController> controller,
      bool is_user_gesture) override {
    Dict prompt = AddressPrompt(u"Update address?",
                                Summary(controller->GetProfileToSave()),
                                u"No thanks", u"Update", is_user_gesture);
    return ShellAutofillBubble::Show(
        browser_, contents, std::move(prompt),
        base::BindOnce(
            [](std::unique_ptr<autofill::UpdateAddressBubbleController> controller,
               const std::string& action, const std::string&, bool) {
              if (action == "save") {
                controller->OnUserDecision(Decision::kAccepted,
                                           controller->GetProfileToSave());
              } else if (action == "decline") {
                controller->OnUserDecision(Decision::kDeclined, std::nullopt);
              }
              controller->OnBubbleClosed();
            },
            std::move(controller)));
  }

  AutofillBubbleBase* ShowSaveCreditCardBubble(
      content::WebContents* contents,
      autofill::SaveCardBubbleController* controller,
      bool is_user_gesture) override {
    // Uploads to a payments account need legal terms and expiry entry that a
    // prompt does not present; only local saves are offered.
    if (controller->IsUploadSave() ||
        controller->ShouldRequestExpirationDateFromUser()) {
      return nullptr;
    }
    const autofill::CreditCard& card = controller->GetCard();
    std::u16string message = controller->GetExplanatoryMessage();
    if (!message.empty()) {
      message += u"\n\n";
    }
    message += card.NetworkAndLastFourDigits() + u" · " +
               card.AbbreviatedExpirationDateForDisplay(/*with_prefix=*/true);
    Dict prompt = Dict()
                      .Set("kind", "confirm")
                      .Set("anchor", "site")
                      .Set("origin", "Merlin")
                      .Set("quiet", !is_user_gesture)
                      .Set("title", controller->GetWindowTitle())
                      .Set("message", message)
                      .Set("actions",
                           List()
                               .Append(Action("decline",
                                              controller->GetDeclineButtonText()))
                               .Append(Action("save",
                                              controller->GetAcceptButtonText(),
                                              "primary")));
    if (controller->ShouldRequestNameFromUser()) {
      prompt.Set("input", Dict()
                              .Set("label", "Name on card")
                              .Set("defaultValue",
                                   card.GetRawInfo(autofill::CREDIT_CARD_NAME_FULL)));
    }
    return ShellAutofillBubble::Show(
        browser_, contents, std::move(prompt),
        base::BindOnce(
            [](autofill::SaveCardBubbleController* controller,
               const std::string& action, const std::string& text,
               bool hidden) {
              using Reason = autofill::PaymentsUiClosedReason;
              if (action == "save") {
                autofill::payments::PaymentsAutofillClient::
                    UserProvidedCardDetails details;
                if (controller->ShouldRequestNameFromUser()) {
                  details.cardholder_name = base::UTF8ToUTF16(text);
                }
                controller->OnSaveButton(details);
                controller->OnBubbleClosed(Reason::kAccepted);
              } else {
                controller->OnBubbleClosed(action == "decline" ? Reason::kCancelled
                                           : hidden            ? Reason::kNotInteracted
                                                               : Reason::kClosed);
              }
            },
            controller));
  }

  // Not offered in the React shell. Callers treat a null bubble as not shown.
  AutofillBubbleBase* ShowIbanBubble(content::WebContents*,
                                     autofill::IbanBubbleController*,
                                     bool,
                                     autofill::IbanBubbleType) override {
    return nullptr;
  }
  AutofillBubbleBase* ShowOfferNotificationBubble(
      content::WebContents*,
      autofill::OfferNotificationBubbleController*,
      bool) override {
    return nullptr;
  }
  AutofillBubbleBase* ShowSaveAutofillAiDataBubble(
      content::WebContents*,
      autofill::AutofillAiImportDataController*) override {
    return nullptr;
  }
  AutofillBubbleBase* ShowAutofillAiLocalSaveNotification(
      content::WebContents*,
      autofill::AutofillAiImportDataController*) override {
    return nullptr;
  }
#if BUILDFLAG(ENABLE_DICE_SUPPORT)
  AutofillBubbleBase* ShowAddressSignInPromo(
      content::WebContents*,
      const autofill::AutofillProfile&) override {
    return nullptr;
  }
#endif
  AutofillBubbleBase* ShowFilledCardInformationBubble(
      content::WebContents*,
      autofill::FilledCardInformationBubbleController*,
      bool) override {
    return nullptr;
  }
  AutofillBubbleBase* ShowVirtualCardEnrollBubble(
      content::WebContents*,
      autofill::VirtualCardEnrollBubbleController*,
      bool) override {
    return nullptr;
  }
  AutofillBubbleBase* ShowVirtualCardEnrollConfirmationBubble(
      content::WebContents*,
      autofill::VirtualCardEnrollBubbleController*) override {
    return nullptr;
  }
  AutofillBubbleBase* ShowMandatoryReauthBubble(
      content::WebContents*,
      autofill::MandatoryReauthBubbleController*,
      bool,
      autofill::MandatoryReauthBubbleType) override {
    return nullptr;
  }
  AutofillBubbleBase* ShowSaveCardConfirmationBubble(
      content::WebContents*,
      autofill::SaveCardBubbleController*) override {
    return nullptr;
  }
  AutofillBubbleBase* ShowSaveIbanConfirmationBubble(
      content::WebContents*,
      autofill::IbanBubbleController*) override {
    return nullptr;
  }
  AutofillBubbleBase* ShowOmniboxAutofillBubble(
      content::WebContents*,
      autofill::OmniboxAutofillBubbleController*) override {
    return nullptr;
  }
  AutofillBubbleBase* ShowPaymentsChurnedUsersBubble(
      content::WebContents*,
      autofill::PaymentsChurnedUsersBubbleController*,
      bool) override {
    return nullptr;
  }
  AutofillBubbleBase* ShowPaymentsChurnedUsersConfirmationBubble(
      content::WebContents*,
      autofill::PaymentsChurnedUsersBubbleController*) override {
    return nullptr;
  }
  AutofillBubbleBase* ShowWalletReminderNoticeBubble(
      content::WebContents*,
      autofill::WalletReminderNoticeBubbleController*,
      bool) override {
    return nullptr;
  }

 private:
  static Dict AddressPrompt(const std::u16string& title,
                            const std::u16string& summary,
                            const std::u16string& decline,
                            const std::u16string& accept,
                            bool is_user_gesture) {
    return Dict()
        .Set("kind", "confirm")
        .Set("anchor", "site")
        .Set("origin", "Merlin")
        .Set("quiet", !is_user_gesture)
        .Set("title", title)
        .Set("message", summary)
        .Set("actions", List()
                            .Append(Action("decline", decline))
                            .Append(Action("save", accept, "primary")));
  }

  raw_ptr<BrowserWindowInterface> browser_;
};

}  // namespace

std::unique_ptr<autofill::AutofillBubbleHandler> CreateReactAutofillBubbleHandler(
    BrowserWindowInterface* browser) {
  return std::make_unique<ReactAutofillBubbleHandler>(browser);
}

}  // namespace modal_browser
