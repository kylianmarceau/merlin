// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_process_policy.h"

#include "base/command_line.h"
#include "base/feature_list.h"

namespace modal_browser {

namespace {

// Same string as kUpstreamDefaultsSwitch (modal_browser_controller.h); this
// target links into //chrome/browser and cannot depend on the controller.
constexpr char kUpstreamDefaults[] = "modal-browser-upstream-defaults";

bool UpstreamDefaults() {
  return base::CommandLine::ForCurrentProcess()->HasSwitch(kUpstreamDefaults);
}

// Chromium's behaviour comes back with --modal-browser-upstream-defaults or
// when the user enables the feature by name on the command line.
bool UpstreamOrEnabledOnCommandLine(const char* feature) {
  if (UpstreamDefaults()) {
    return true;
  }
  const base::FeatureList* features = base::FeatureList::GetInstance();
  return features && features->IsFeatureOverriddenFromCommandLine(
                         feature, base::FeatureList::OVERRIDE_ENABLE_FEATURE);
}

}  // namespace

bool ShouldShareMerlinPageProcess(std::string_view host) {
  return host == kMerlinStartHost && !UpstreamDefaults();
}

bool ShouldPreloadTopChromeWebUI() {
  return UpstreamOrEnabledOnCommandLine("PreloadTopChromeWebUI");
}

bool ShouldPrewarmDefaultSearch() {
  return UpstreamOrEnabledOnCommandLine("Prewarm");
}

bool ShouldShowChromiumPromos() {
  return UpstreamDefaults();
}

}  // namespace modal_browser
