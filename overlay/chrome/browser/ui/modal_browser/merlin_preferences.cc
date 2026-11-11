// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_preferences.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "base/feature_list.h"
#include "base/files/file_path.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/version_info/version_info.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "chrome/browser/merlin_adblock/updater.h"
#include "chrome/browser/prefs/session_startup_pref.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/search_engines/template_url_service_factory.h"
#include "chrome/browser/themes/theme_service.h"
#include "chrome/browser/themes/theme_service_factory.h"
#include "chrome/browser/ui/modal_browser/merlin_ctrl_tab.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "chrome/browser/ui/zoom/chrome_zoom_level_prefs.h"
#include "chrome/common/pref_names.h"
#include "components/merlin_adblock/common/features.h"
#include "components/password_manager/core/common/password_manager_pref_names.h"
#include "components/performance_manager/public/user_tuning/prefs.h"
#include "components/prefs/pref_service.h"
#include "components/search_engines/template_url.h"
#include "components/search_engines/template_url_service.h"
#include "components/search_engines/template_url_starter_pack_data.h"
#include "extensions/browser/disable_reason.h"
#include "extensions/browser/extension_registrar.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_system.h"
#include "extensions/browser/management_policy.h"
#include "extensions/common/extension.h"
#include "extensions/common/manifest.h"
#include "third_party/blink/public/common/page/page_zoom.h"

namespace modal_browser {

namespace {

constexpr std::array<int, 11> kZoomChoices = {50,  67,  75,  80,  90, 100,
                                              110, 125, 150, 175, 200};

// Chromium pages Settings links to, for what Merlin does not reimplement.
const std::map<std::string, std::string, std::less<>>& Links() {
  static const base::NoDestructor<
      std::map<std::string, std::string, std::less<>>>
      links({
          {"site-permissions", "chrome://settings/content"},
          {"cookies", "chrome://settings/cookies"},
          {"security", "chrome://settings/security"},
          {"clear-data", "chrome://settings/clearBrowserData"},
          {"certificates", "chrome://certificate-manager/"},
          {"passwords", "chrome://password-manager/passwords"},
          {"password-checkup", "chrome://password-manager/checkup"},
          {"addresses", "chrome://settings/addresses"},
          {"payments", "chrome://settings/payments"},
          {"extensions", "chrome://extensions/"},
          {"extension-shortcuts", "chrome://extensions/shortcuts"},
          {"search-engines", "chrome://settings/searchEngines"},
          {"languages", "chrome://settings/languages"},
          {"fonts", "chrome://settings/fonts"},
          {"accessibility", "chrome://settings/accessibility"},
          {"system", "chrome://settings/system"},
          {"import", "chrome://settings/importData"},
          {"reset", "chrome://settings/reset"},
          {"version", "chrome://version/"},
          {"credits", "chrome://credits/"},
          {"history", "chrome://merlin-history/"},
          {"downloads", "chrome://merlin-downloads/"},
      });
  return *links;
}

namespace tuning = performance_manager::user_tuning::prefs;

std::string SetEngine(Profile* profile, const std::string& value) {
  int64_t id = 0;
  TemplateURLService* service =
      TemplateURLServiceFactory::GetForProfile(profile);
  if (!service || !base::StringToInt64(value, &id)) {
    return "Unknown search engine";
  }
  for (TemplateURL* url : service->GetTemplateURLs()) {
    if (url->id().value() == id && service->CanMakeDefault(url)) {
      service->SetUserSelectedDefaultSearchProvider(url);
      return {};
    }
  }
  return "That search engine cannot be the default";
}

std::string SetExtensionEnabled(Profile* profile, const base::DictValue& args) {
  const std::string* id = args.FindString("id");
  const std::optional<bool> on = args.FindBool("enabled");
  auto* registry = extensions::ExtensionRegistry::Get(profile);
  auto* system = extensions::ExtensionSystem::Get(profile);
  auto* registrar = extensions::ExtensionRegistrar::Get(profile);
  if (!id || !on || !registry || !system || !registrar) {
    return "Invalid extension setting";
  }
  const extensions::Extension* ext = registry->GetInstalledExtension(*id);
  extensions::ManagementPolicy* policy = system->management_policy();
  if (!ext || (policy && (!policy->UserMayModifySettings(ext, nullptr) ||
                          policy->MustRemainEnabled(ext, nullptr)))) {
    return "This extension is managed and cannot be changed";
  }
  if (*on) {
    registrar->EnableExtension(*id);
  } else {
    registrar->DisableExtension(
        *id, {extensions::disable_reason::DISABLE_USER_ACTION});
  }
  return {};
}

}  // namespace

base::DictValue MerlinAdblockState(Profile* profile) {
  PrefService* prefs = profile->GetPrefs();
  auto* service = merlin_adblock::Service::Get(profile);
  base::DictValue data;
  data.Set("available",
           base::FeatureList::IsEnabled(merlin_adblock::kMerlinAdblock));
  data.Set("enabled", prefs->GetBoolean(merlin_adblock::kEnabledPref));
  data.Set("automatic", prefs->GetBoolean(merlin_adblock::kUpdatesPref));
  data.Set("private", profile->IsOffTheRecord());
  data.Set("status", service->Status());
  data.Set("updateStatus", service->UpdateStatus());
  data.Set("lastUpdate", prefs->GetDouble(merlin_adblock::kLastUpdatePref));
  base::ListValue groups, exceptions;
  for (const auto& group : service->Groups()) {
    groups.Append(group);
  }
  for (const auto& host : service->Exceptions()) {
    exceptions.Append(host);
  }
  data.Set("groups", std::move(groups));
  data.Set("exceptions", std::move(exceptions));
  return data;
}

base::ListValue MerlinExtensionList(Profile* profile) {
  base::ListValue list;
  auto* registry = extensions::ExtensionRegistry::Get(profile);
  auto* system = extensions::ExtensionSystem::Get(profile);
  if (!registry || !system) {
    return list;
  }
  extensions::ManagementPolicy* policy = system->management_policy();
  std::vector<scoped_refptr<const extensions::Extension>> all;
  for (const auto& ext : registry->GenerateInstalledExtensionsSet()) {
    if (!ext->is_extension() ||
        extensions::Manifest::IsComponentLocation(ext->location())) {
      continue;
    }
    all.push_back(ext);
  }
  std::sort(all.begin(), all.end(),
            [](const auto& a, const auto& b) { return a->name() < b->name(); });
  for (const auto& ext : all) {
    base::DictValue item;
    item.Set("id", ext->id());
    item.Set("name", ext->name());
    item.Set("version", ext->VersionString());
    item.Set("enabled", registry->enabled_extensions().Contains(ext->id()));
    item.Set("canToggle",
             !policy || (policy->UserMayModifySettings(ext.get(), nullptr) &&
                         !policy->MustRemainEnabled(ext.get(), nullptr)));
    list.Append(std::move(item));
  }
  return list;
}

base::DictValue MerlinPreferences(Profile* profile,
                                  ModalBrowserController* controller) {
  PrefService* prefs = profile->GetPrefs();
  base::DictValue data;
  data.Set("adblock", MerlinAdblockState(profile));

  ThemeService* theme = ThemeServiceFactory::GetForProfile(profile);
  data.Set("theme",
           theme ? static_cast<int>(theme->GetBrowserColorScheme()) : 0);
  data.Set("tabs", controller && !controller->TabsInSidebar() ? "top" : "side");
  data.Set("ctrlTab", CtrlTabSwitcher::RecentOrder(prefs) ? "recent" : "order");

  base::ListValue bindings;
  if (controller) {
    for (const ModalInputRouter::Binding& b : controller->KeyBindings()) {
      bindings.Append(base::DictValue()
                          .Set("keys", b.keys)
                          .Set("command", b.command)
                          .Set("desc", b.description));
    }
  }
  data.Set("bindings", std::move(bindings));
  data.Set("hintChars", controller ? controller->HintChars() : "");

  base::ListValue engines;
  std::string current_engine;
  bool managed = false;
  if (TemplateURLService* service =
          TemplateURLServiceFactory::GetForProfile(profile)) {
    if (!service->loaded()) {
      service->Load();
    }
    managed = service->is_default_search_managed();
    const TemplateURL* current = service->GetDefaultSearchProvider();
    for (TemplateURL* url : service->GetTemplateURLs()) {
      if (url != current && !service->CanMakeDefault(url)) {
        continue;
      }
      if (url->starter_pack_id() !=
              template_url_starter_pack_data::StarterPackId::kNone ||
          url->url().empty()) {
        continue;
      }
      engines.Append(base::DictValue()
                         .Set("id", base::NumberToString(url->id().value()))
                         .Set("name", url->short_name()));
      if (url == current) {
        current_engine = base::NumberToString(url->id().value());
      }
    }
  }
  data.Set("engines", std::move(engines));
  data.Set("engine", current_engine);
  data.Set("engineManaged", managed);

  const SessionStartupPref startup = SessionStartupPref::GetStartupPref(profile);
  data.Set("startup", startup.type == SessionStartupPref::LAST ||
                              startup.type == SessionStartupPref::LAST_AND_URLS
                          ? "last"
                          : "start");

  double level = 0;
  if (ChromeZoomLevelPrefs* zoom = profile->GetZoomLevelPrefs()) {
    level = zoom->GetDefaultZoomLevelPref();
  }
  data.Set("zoom", static_cast<int>(std::lround(
                       blink::ZoomLevelToZoomFactor(level) * 100)));
  base::ListValue zoom_choices;
  for (int z : kZoomChoices) {
    zoom_choices.Append(z);
  }
  data.Set("zoomChoices", std::move(zoom_choices));

  data.Set("downloadDir",
           prefs->GetFilePath(prefs::kDownloadDefaultDirectory).AsUTF8Unsafe());
  data.Set("askWhere", prefs->GetBoolean(prefs::kPromptForDownload));
  // Memory and Energy Saver are machine-wide (local state).
  PrefService* local = g_browser_process->local_state();
  data.Set("memorySaver",
           local && local->GetInteger(tuning::kMemorySaverModeState) ==
                        static_cast<int>(tuning::MemorySaverModeState::kEnabled));
  data.Set("energySaver",
           local && local->GetInteger(tuning::kBatterySaverModeState) !=
                        static_cast<int>(
                            tuning::BatterySaverModeState::kDisabled));
  data.Set("savePasswords",
           prefs->GetBoolean(password_manager::prefs::kCredentialsEnableService));
  data.Set("extensions", MerlinExtensionList(profile));
  data.Set("about",
           base::DictValue()
               .Set("version", std::string(version_info::GetVersionNumber()))
               .Set("os", std::string(version_info::GetOSType())));
  return data;
}

std::string SetMerlinPreference(Profile* profile,
                                ModalBrowserController* controller,
                                std::string_view key,
                                const base::Value& value) {
  PrefService* prefs = profile->GetPrefs();
  PrefService* local = g_browser_process->local_state();
  auto* adblock = merlin_adblock::Service::Get(profile);
  const std::string* text = value.is_string() ? &value.GetString() : nullptr;
  const std::optional<bool> on =
      value.is_bool() ? std::optional<bool>(value.GetBool()) : std::nullopt;

  if (key == "theme") {
    ThemeService* theme = ThemeServiceFactory::GetForProfile(profile);
    if (!theme || !value.is_int() || value.GetInt() < 0 || value.GetInt() > 2) {
      return "Invalid color scheme";
    }
    theme->SetBrowserColorScheme(
        static_cast<ThemeService::BrowserColorScheme>(value.GetInt()));
  } else if (key == "tabs") {
    if (!text || !controller || (*text != "side" && *text != "top")) {
      return "Invalid tab layout";
    }
    return controller->RunCommandLine("set tabs=" + *text);
  } else if (key == "ctrlTab") {
    if (!text || (*text != "recent" && *text != "order")) {
      return "Invalid tab switching order";
    }
    prefs->SetBoolean(prefs::kCtrlTabMru, *text == "recent");
  } else if (key == "engine") {
    return text ? SetEngine(profile, *text) : "Unknown search engine";
  } else if (key == "startup") {
    if (!text || (*text != "last" && *text != "start")) {
      return "Invalid startup choice";
    }
    SessionStartupPref pref = SessionStartupPref::GetStartupPref(profile);
    pref.type = *text == "last" ? SessionStartupPref::LAST
                                : SessionStartupPref::DEFAULT;
    SessionStartupPref::SetStartupPref(profile, pref);
  } else if (key == "zoom") {
    if (!value.is_int() ||
        std::find(kZoomChoices.begin(), kZoomChoices.end(), value.GetInt()) ==
            kZoomChoices.end()) {
      return "Invalid zoom level";
    }
    if (ChromeZoomLevelPrefs* zoom = profile->GetZoomLevelPrefs()) {
      zoom->SetDefaultZoomLevelPref(
          blink::ZoomFactorToZoomLevel(value.GetInt() / 100.0));
    }
  } else if (key == "askWhere" && on) {
    prefs->SetBoolean(prefs::kPromptForDownload, *on);
  } else if (key == "memorySaver" && on && local) {
    local->SetInteger(
        tuning::kMemorySaverModeState,
        static_cast<int>(*on ? tuning::MemorySaverModeState::kEnabled
                             : tuning::MemorySaverModeState::kDisabled));
  } else if (key == "energySaver" && on && local) {
    // On means Chromium's default: when the battery is low.
    local->SetInteger(
        tuning::kBatterySaverModeState,
        static_cast<int>(*on
                             ? tuning::BatterySaverModeState::kEnabledBelowThreshold
                             : tuning::BatterySaverModeState::kDisabled));
  } else if (key == "savePasswords" && on) {
    prefs->SetBoolean(password_manager::prefs::kCredentialsEnableService, *on);
  } else if (key == "adblock" && on) {
    adblock->SetEnabled(*on);
  } else if (key == "adblockUpdates" && on) {
    if (profile->IsOffTheRecord()) {
      return "Filter updates are managed by your main profile";
    }
    prefs->SetBoolean(merlin_adblock::kUpdatesPref, *on);
  } else if (key == "adblockLists" && value.is_list()) {
    std::vector<std::string> groups;
    for (const auto& group : value.GetList()) {
      if (!group.is_string()) {
        return "Invalid filter lists";
      }
      groups.push_back(group.GetString());
    }
    adblock->SetGroups(std::move(groups));
  } else if (key == "adblockRefresh") {
    adblock->Refresh();
  } else if (key == "adblockException" && text) {
    adblock->SetException(*text, false);
  } else if (key == "extension" && value.is_dict()) {
    return SetExtensionEnabled(profile, value.GetDict());
  } else {
    return "Unknown setting";
  }
  return {};
}

std::string MerlinPreferenceLink(std::string_view key) {
  auto it = Links().find(key);
  return it == Links().end() ? std::string() : it->second;
}

}  // namespace modal_browser
