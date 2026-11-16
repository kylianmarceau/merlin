// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_urls.h"

#include <algorithm>
#include <string_view>

#include "base/command_line.h"
#include "base/strings/escape.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/ssl/chrome_security_state_util.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_vocabulary.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "components/modal_browser/ffi/src/lib.rs.h"
#include "components/security_state/core/security_state.h"
#include "components/url_formatter/url_formatter.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/url_constants.h"
#include "url/gurl.h"

namespace modal_browser {

ShellDisplayUrl FormatShellDisplayUrl(const GURL& url) {
  if (url.is_empty() || url == GURL(url::kAboutBlankURL)) {
    return {};
  }
  if (url.SchemeIs(content::kChromeUIScheme)) {
    std::string shown = MerlinDisplayUrl(url);
    return {shown, shown};
  }
  const url_formatter::FormatUrlTypes types =
      url_formatter::kFormatUrlOmitDefaults |
      url_formatter::kFormatUrlOmitHTTPS |
      url_formatter::kFormatUrlOmitTrivialSubdomains;
  const auto format = [&url](url_formatter::FormatUrlTypes extra) {
    return base::UTF16ToUTF8(url_formatter::FormatUrl(
        url, extra, base::UnescapeRule::NORMAL, nullptr, nullptr, nullptr));
  };
  ShellDisplayUrl shown{format(types), std::string()};
  if (url.IsStandard() && url.has_host()) {
    shown.host = format(types | url_formatter::kFormatUrlTrimAfterHost);
    // Trimming can leave a bare host's slash, as in "example.com/".
    if (shown.host.ends_with('/')) {
      shown.host.pop_back();
    }
    if (!shown.url.starts_with(shown.host)) {
      shown.host.clear();
    }
  }
  return shown;
}

std::string ShellSecurityState(content::WebContents* contents) {
  content::NavigationController& controller = contents->GetController();
  // An address being opened shows before its page commits; until then
  // nothing is known about its connection, and the last page's must not
  // be shown beside it.
  if (const content::NavigationEntry* pending = controller.GetPendingEntry();
      pending && pending == controller.GetVisibleEntry()) {
    return shell::security::kPending;
  }
  const security_state::SecurityLevel level =
      chrome_security_state::GetSecurityLevel(contents);
  if (level == security_state::DANGEROUS) {
    return shell::security::kDangerous;
  }
  const GURL url = contents->GetVisibleURL();
  if (!url.SchemeIsHTTPOrHTTPS()) {
    return shell::security::kInternal;
  }
  return level == security_state::SECURE ? shell::security::kSecure
                                          : shell::security::kInsecure;
}

GURL MerlinInternalUrl(std::u16string_view text) {
  return GURL(std::string(ffi::merlin_internal_url(base::UTF16ToUTF8(text))));
}

std::string MerlinDisplayUrl(const GURL& url) {
  if (!url.SchemeIs(content::kChromeUIScheme) ||
      base::CommandLine::ForCurrentProcess()->HasSwitch(
          kUpstreamDefaultsSwitch)) {
    return url.spec();
  }
  // Everything after the host: path, query and fragment.
  const std::string& spec = url.spec();
  const url::Parsed& parsed = url.parsed_for_possibly_invalid_spec();
  const size_t host_end =
      parsed.host.is_valid() ? static_cast<size_t>(parsed.host.end()) : 0;
  std::string_view rest = std::string_view(spec).substr(
      std::min(host_end, spec.size()));
  std::string host(url.host());
  if (host == "newtab") {
    host = "start";
  }
  // A bare "/" path reads as noise, as in Chromium's own address field.
  if (rest == "/") {
    rest = {};
  }
  std::string out = "merlin://";
  out.append(host);
  out.append(rest);
  return out;
}

}  // namespace modal_browser
