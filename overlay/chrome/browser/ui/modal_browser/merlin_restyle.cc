// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_restyle.h"

#include <string>
#include <string_view>

#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/ui/modal_browser/merlin_design_tokens.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/url_constants.h"
#include "url/gurl.h"

namespace modal_browser {

namespace {

// Error pages (components/neterror) and interstitials (components/
// security_interstitials). Selectors are theirs; colors are Merlin's.
// body.safe-browsing and friends keep their red: a warning must still look
// like one.
constexpr char kErrorCss[] = R"CSS(
:root { --k-bg: var(--bg); --k-text: var(--text); --k-text2: var(--text2); --k-hair: var(--hair); --k-kbd: var(--kbd); }
body.neterror, body:not(.safe-browsing):not(.billing):not(.supervised-user-block):not([class*="red"]) {
  background: var(--k-bg) !important; color: var(--k-text2) !important;
  font-family: var(--font) !important;
}
body .interstitial-wrapper { max-width: 560px; padding-top: 14vh; margin-top: 0; }
body.neterror h1, body:not(.safe-browsing) #main-message h1 {
  color: var(--k-text) !important; font-weight: 650 !important; letter-spacing: -0.02em; font-size: 26px !important;
}
body.neterror .icon {
  width: 52px !important; height: 52px !important; margin-bottom: 28px !important;
  background-image: var(--merlin-product-icon) !important;
  background-size: contain !important; background-repeat: no-repeat !important; content: none !important;
  filter: none !important;
}
body.neterror :focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
body.neterror .runner-container, body.neterror #offline-resources, body.neterror .snackbar { display: none !important; }
body.neterror .error-code, body:not(.safe-browsing) .error-code { color: var(--k-text2) !important; font-family: ui-monospace, "SF Mono", Menlo, monospace !important; font-size: 12px !important; }
body.neterror a, body:not(.safe-browsing) #main-message a { color: var(--k-text) !important; text-decoration-color: var(--accent) !important; text-underline-offset: 2px; }
body.neterror .blue-button, body:not(.safe-browsing) #primary-button {
  background: var(--accent) !important; color: var(--on-accent) !important; border: 0 !important;
  border-radius: 9px !important; box-shadow: none !important; font-weight: 600 !important; padding: 8px 16px !important;
}
body.neterror .secondary-button, body:not(.safe-browsing) .secondary-button, body.neterror .link-button {
  background: var(--k-kbd) !important; color: var(--k-text) !important; border: 0 !important; border-radius: 9px !important;
}
body.ssl #enhanced-protection-message {
  background: var(--panel) !important; color: var(--text2) !important;
  border-color: var(--hair) !important; border-radius: var(--card-radius) !important;
}
body.ssl #enhanced-protection-message a { color: var(--link) !important; }
body.neterror .suggestions, body:not(.safe-browsing) #details { color: var(--k-text2) !important; }
body.safe-browsing, body.safe-browsing h1 { font-family: var(--font) !important; }
)CSS";

// Chromium's Settings app: hide its section menu (Google, AI and sync
// entries Merlin does not have) and the menu button that opens it in a
// narrow window. Polls a few frames while the app builds itself, then
// stops.
constexpr char kSettingsJs[] = R"JS((() => {
  if (window.__merlinRestyled) return;
  window.__merlinRestyled = true;
  let tries = 0;
  const step = () => {
    const ui = document.querySelector('settings-ui');
    const root = ui && ui.shadowRoot;
    const left = root && root.querySelector('#left');
    const toolbar = root && root.querySelector('cr-toolbar');
    if (left && toolbar) {
      left.style.display = 'none';
      toolbar.showMenu = false;
      const style = document.createElement('style');
      style.textContent = 'settings-ui { --settings-menu-width: 0px; }';
      document.head.append(style);
      return;
    }
    if (++tries < 120) requestAnimationFrame(step);
  };
  step();
})();)JS";

bool IsChromiumSettings(const GURL& url) {
  return url.SchemeIs(content::kChromeUIScheme) && url.host() == "settings";
}

}  // namespace

void RestyleMerlinPage(content::WebContents* contents) {
  if (!contents) {
    return;
  }
  content::RenderFrameHost* frame = contents->GetPrimaryMainFrame();
  if (!frame || !frame->IsRenderFrameLive()) {
    return;
  }
  if (frame->IsErrorDocument()) {
    const std::string script =
        "(() => { if (document.getElementById('merlin-style')) return;"
        " const s = document.createElement('style'); s.id = 'merlin-style';"
        " s.textContent = " +
        std::string("`") + design::kPageTokensCss +
        "\n:root { --merlin-product-icon: " + design::kProductIconCssUrl +
        "; }\n" + kErrorCss +
        "`; (document.head || document.documentElement).append(s); })();";
    frame->ExecuteJavaScriptInIsolatedWorld(base::UTF8ToUTF16(script),
                                            base::NullCallback(),
                                            ISOLATED_WORLD_ID_CHROME_INTERNAL);
    return;
  }
  if (IsChromiumSettings(frame->GetLastCommittedURL())) {
    // WebUI pages allow scripts from the browser in their own world.
    frame->ExecuteJavaScript(base::UTF8ToUTF16(std::string_view(kSettingsJs)),
                             base::NullCallback());
  }
}

}  // namespace modal_browser
