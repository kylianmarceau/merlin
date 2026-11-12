// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_process_policy.h"

#include <string>

#include "base/base_switches.h"
#include "base/command_line.h"
#include "base/containers/flat_set.h"
#include "base/feature_list.h"
#include "base/strings/strcat.h"
#include "base/strings/string_split.h"

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

bool ShouldPreloadTopChromeWebUI() {
  return UpstreamOrEnabledOnCommandLine("PreloadTopChromeWebUI");
}

bool ShouldPrewarmDefaultSearch() {
  return UpstreamOrEnabledOnCommandLine("Prewarm");
}

bool ShouldShowChromiumPromos() {
  return UpstreamDefaults();
}

void AddMerlinDisabledFeatures(base::CommandLine& command_line) {
  if (command_line.HasSwitch(kUpstreamDefaults)) {
    return;
  }
  // Entries look like "Name", "Name<Trial" or "Name:param/value".
  base::flat_set<std::string> enabled;
  for (std::string_view entry : base::SplitStringPiece(
           command_line.GetSwitchValueASCII(switches::kEnableFeatures), ",",
           base::TRIM_WHITESPACE, base::SPLIT_WANT_NONEMPTY)) {
    enabled.emplace(entry.substr(0, entry.find_first_of("<:")));
  }
  std::string disabled =
      command_line.GetSwitchValueASCII(switches::kDisableFeatures);
  for (const char* feature : kMerlinDisabledFeatures) {
    if (!enabled.contains(feature)) {
      base::StrAppend(&disabled, {disabled.empty() ? "" : ",", feature});
    }
  }
  command_line.AppendSwitchASCII(switches::kDisableFeatures, disabled);
}

}  // namespace modal_browser
