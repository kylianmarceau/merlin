// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_urls.h"

#include <algorithm>
#include <string_view>

#include "base/command_line.h"
#include "chrome/browser/ui/modal_browser/merlin_start_page.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "content/public/common/url_constants.h"
#include "url/gurl.h"

namespace modal_browser {

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
  if (host == kMerlinStartHost || host == "newtab") {
    host = "start";
  } else if (host.starts_with("merlin-")) {
    // Merlin's own pages: merlin-settings reads as merlin://settings.
    host = host.substr(std::string_view("merlin-").size());
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
