// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_restyle.h"

#include <string>
#include <string_view>

#include "base/strings/utf_string_conversions.h"
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
:root { color-scheme: light dark; --k-bg: #FDFCF8; --k-text: #1C1B18; --k-text2: #615C51; --k-hair: rgba(40,30,10,.09); --k-kbd: rgba(40,30,10,.06); }
@media (prefers-color-scheme: dark) { :root { --k-bg: #161512; --k-text: #ECE8DD; --k-text2: #A6A194; --k-hair: rgba(255,255,255,.07); --k-kbd: rgba(255,255,255,.08); } }
body.neterror, body:not(.safe-browsing):not(.billing):not(.supervised-user-block):not([class*="red"]) {
  background: var(--k-bg) !important; color: var(--k-text2) !important;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif !important;
}
body .interstitial-wrapper { max-width: 560px; padding-top: 14vh; margin-top: 0; }
body.neterror h1, body:not(.safe-browsing) #main-message h1 {
  color: var(--k-text) !important; font-weight: 650 !important; letter-spacing: -0.02em; font-size: 26px !important;
}
body.neterror .icon {
  width: 52px !important; height: 52px !important; margin-bottom: 28px !important;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200' role='img' aria-label='Merlin'%3E%3Crect width='200' height='200' rx='46' fill='%23F2ECE0'/%3E%3Cpath d='M85.15 135.77L19.81 102.47A90 90 0 0 1 40.95 75.41L89.07 130.75ZM89.97 130.02L45.84 71.46A90 90 0 0 1 76.71 56.4L95.69 127.23ZM104.31 127.23L123.29 56.4A90 90 0 0 1 154.16 71.46L110.03 130.02ZM110.93 130.75L159.05 75.41A90 90 0 0 1 180.19 102.47L114.85 135.77ZM87.5 143.33A12.5 12.5 0 1 1 112.5 143.33A12.5 12.5 0 1 1 87.5 143.33Z' fill='%2312352E'/%3E%3Cpath d='M96.82 126.97L82.83 54.99A90 90 0 0 1 117.17 54.99L103.18 126.97Z' fill='%23C4552D'/%3E%3C/svg%3E") !important;
  background-size: contain !important; background-repeat: no-repeat !important; content: none !important;
  filter: none !important;
}
body.neterror .runner-container, body.neterror #offline-resources, body.neterror .snackbar { display: none !important; }
body.neterror .error-code, body:not(.safe-browsing) .error-code { color: var(--k-text2) !important; font-family: ui-monospace, "SF Mono", Menlo, monospace !important; font-size: 12px !important; }
body.neterror a, body:not(.safe-browsing) #main-message a { color: var(--k-text) !important; text-decoration-color: #F6D44A !important; text-underline-offset: 2px; }
body.neterror .blue-button, body:not(.safe-browsing) #primary-button {
  background: #F6D44A !important; color: #1A1A1A !important; border: 0 !important;
  border-radius: 9px !important; box-shadow: none !important; font-weight: 600 !important; padding: 8px 16px !important;
}
body.neterror .secondary-button, body:not(.safe-browsing) .secondary-button, body.neterror .link-button {
  background: var(--k-kbd) !important; color: var(--k-text) !important; border: 0 !important; border-radius: 9px !important;
}
body.neterror .suggestions, body:not(.safe-browsing) #details { color: var(--k-text2) !important; }
body.safe-browsing, body.safe-browsing h1 { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif !important; }
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
        std::string("`") + kErrorCss +
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
