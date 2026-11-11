// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_AUTOFILL_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_AUTOFILL_H_

#include <memory>

class BrowserWindowInterface;
namespace autofill {
class AutofillBubbleHandler;
}

namespace modal_browser {

// Address save/update and local card save as shell prompts. Other autofill
// bubbles (payments upload, IBAN, virtual cards, Autofill AI, promos) are not
// offered in the React shell; their controllers see no bubble and continue.
std::unique_ptr<autofill::AutofillBubbleHandler> CreateReactAutofillBubbleHandler(
    BrowserWindowInterface* browser);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_AUTOFILL_H_
