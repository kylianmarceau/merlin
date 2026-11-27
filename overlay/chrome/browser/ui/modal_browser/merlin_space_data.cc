// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_space_data.h"

#include <algorithm>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/functional/callback_helpers.h"
#include "base/memory/raw_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "chrome/browser/profiles/delete_profile_helper.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_attributes_storage.h"
#include "chrome/browser/profiles/profile_avatar_icon_util.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/profiles/profile_metrics.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "chrome/browser/search_engines/template_url_service_factory.h"
#include "chrome/browser/ui/modal_browser/merlin_auto_pip.h"
#include "chrome/common/pref_names.h"
#include "components/password_manager/core/common/password_manager_pref_names.h"
#include "components/prefs/pref_change_registrar.h"
#include "components/prefs/pref_service.h"
#include "components/search_engines/template_url.h"
#include "components/search_engines/template_url_data.h"
#include "components/search_engines/template_url_service.h"
#include "chrome/browser/ui/zoom/chrome_zoom_level_prefs.h"

namespace modal_browser {

namespace {

// The settings kept the same in every space's data: what Settings, the
// :set and :adblock commands and Chromium's own pages change. A site's
// permissions, extensions, and anything a page stores stay with the data.
constexpr const char* kSharedPrefs[] = {
    prefs::kBrowserColorScheme,
    prefs::kCtrlTabMru,
    prefs::kRestoreOnStartup,
    prefs::kURLsToRestoreOnStartup,
    prefs::kPromptForDownload,
    prefs::kDownloadDefaultDirectory,
    password_manager::prefs::kCredentialsEnableService,
    kAutoPipPref,
    merlin_adblock::kEnabledPref,
    merlin_adblock::kExceptionsPref,
    merlin_adblock::kUpdatesPref,
    merlin_adblock::kListsPref,
    "merlin.shell.appearance",
};

ProfileManager* Manager() {
  return g_browser_process ? g_browser_process->profile_manager() : nullptr;
}

// The folder `id` names, when Merlin knows of such data.
base::FilePath KnownPath(std::string_view id) {
  ProfileManager* manager = Manager();
  if (!manager || !IsSpaceDataId(id)) {
    return base::FilePath();
  }
  const base::FilePath path = manager->user_data_dir().AppendASCII(id);
  if (id != kFirstSpaceData &&
      !manager->GetProfileAttributesStorage().GetProfileAttributesWithPath(
          path)) {
    return base::FilePath();
  }
  return path;
}

// Runs `done` once `profile`'s search engines have loaded.
void WhenEnginesLoaded(Profile* profile, base::OnceClosure done) {
  TemplateURLService* service =
      TemplateURLServiceFactory::GetForProfile(profile);
  if (!service) {
    return;
  }
  if (service->loaded()) {
    std::move(done).Run();
    return;
  }
  // Kept while the list may still call; a subscription to a list that has
  // gone is harmless (the list cancels through a weak pointer).
  static base::NoDestructor<std::vector<base::CallbackListSubscription>> waits;
  std::erase_if(*waits, [](const auto& wait) { return !wait; });
  waits->push_back(service->RegisterOnLoadedCallback(std::move(done)));
  service->Load();
}

// `to` takes `from`'s default search engine, adding it when `to` lacks it.
void CopyEngine(base::WeakPtr<Profile> from, base::WeakPtr<Profile> to) {
  if (!from || !to) {
    return;
  }
  TemplateURLService* source = TemplateURLServiceFactory::GetForProfile(from.get());
  TemplateURLService* target = TemplateURLServiceFactory::GetForProfile(to.get());
  if (!source || !target || !source->loaded() || !target->loaded() ||
      target->is_default_search_managed()) {
    return;
  }
  const TemplateURL* engine = source->GetDefaultSearchProvider();
  if (!engine) {
    return;
  }
  const TemplateURL* current = target->GetDefaultSearchProvider();
  if (current && current->keyword() == engine->keyword() &&
      current->url() == engine->url()) {
    return;
  }
  TemplateURL* match = target->GetTemplateURLForKeyword(engine->keyword());
  if (!match || match->url() != engine->url()) {
    TemplateURLData data;
    data.SetShortName(engine->short_name());
    data.SetKeyword(engine->keyword());
    data.SetURL(engine->url());
    match = target->Add(std::make_unique<TemplateURL>(data));
  }
  if (match && target->CanMakeDefault(match)) {
    target->SetUserSelectedDefaultSearchProvider(match);
  }
}

void SpreadEngine(Profile* from, Profile* to) {
  auto copy = base::BindOnce(&CopyEngine, from->GetWeakPtr(), to->GetWeakPtr());
  // Both lists must have loaded; each waits for its own.
  WhenEnginesLoaded(from, base::BindOnce(
      [](base::WeakPtr<Profile> to, base::OnceClosure copy) {
        if (to) {
          WhenEnginesLoaded(to.get(), std::move(copy));
        }
      },
      to->GetWeakPtr(), std::move(copy)));
}

void SpreadZoom(Profile* from, Profile* to) {
  ChromeZoomLevelPrefs* source = from->GetZoomLevelPrefs();
  ChromeZoomLevelPrefs* target = to->GetZoomLevelPrefs();
  if (source && target &&
      target->GetDefaultZoomLevelPref() != source->GetDefaultZoomLevelPref()) {
    target->SetDefaultZoomLevelPref(source->GetDefaultZoomLevelPref());
  }
}

// Keeps the loaded data's settings in step: a change in one is copied to
// the others. Home's data is the reference for data opened later.
class SharedSettings : public ProfileObserver {
 public:
  static SharedSettings& Get() {
    static base::NoDestructor<SharedSettings> settings;
    return *settings;
  }

  void Share(Profile* profile) {
    if (!profile || profile->IsOffTheRecord() || watched_.contains(profile)) {
      return;
    }
    if (SpaceDataId(profile) != kFirstSpaceData) {
      // Other data starts from Home's settings, loading Home's data if it
      // isn't open (it never goes away).
      LoadSpaceData(kFirstSpaceData,
                    base::BindOnce(&SharedSettings::TakeFromHome,
                                   base::Unretained(this),
                                   profile->GetWeakPtr()));
      return;
    }
    Watch(profile);
  }

  void Spread(Profile* from, std::string_view key) {
    for (const auto& [profile, _] : watched_) {
      if (profile == from) {
        continue;
      }
      if (key == "engine") {
        SpreadEngine(from, profile);
      } else if (key == "zoom") {
        SpreadZoom(from, profile);
      }
    }
  }

 private:
  friend class base::NoDestructor<SharedSettings>;
  SharedSettings() = default;

  void TakeFromHome(base::WeakPtr<Profile> profile, Profile* home) {
    if (!profile || watched_.contains(profile.get())) {
      return;
    }
    if (home) {
      Copy(home, profile.get());
      SpreadEngine(home, profile.get());
      SpreadZoom(home, profile.get());
      Watch(home);
    }
    Watch(profile.get());
  }

  void Watch(Profile* profile) {
    if (watched_.contains(profile)) {
      return;
    }
    auto registrar = std::make_unique<PrefChangeRegistrar>();
    registrar->Init(profile->GetPrefs());
    for (const char* pref : kSharedPrefs) {
      if (!profile->GetPrefs()->FindPreference(pref)) {
        continue;
      }
      registrar->Add(pref, base::BindRepeating(&SharedSettings::Changed,
                                               base::Unretained(this),
                                               base::Unretained(profile),
                                               std::string(pref)));
    }
    watched_.emplace(profile, std::move(registrar));
    profile->AddObserver(this);
  }

  // `to` takes every shared setting `from` has.
  void Copy(Profile* from, Profile* to) {
    for (const char* pref : kSharedPrefs) {
      CopyPref(from, to, pref);
    }
  }

  void CopyPref(Profile* from, Profile* to, const std::string& pref) {
    PrefService* source = from->GetPrefs();
    PrefService* target = to->GetPrefs();
    const PrefService::Preference* setting = source->FindPreference(pref);
    if (!setting || !target->FindPreference(pref) ||
        !target->IsUserModifiablePreference(pref)) {
      return;
    }
    copying_ = true;
    if (setting->IsDefaultValue()) {
      target->ClearPref(pref);
    } else if (target->GetValue(pref) != *setting->GetValue()) {
      target->Set(pref, setting->GetValue()->Clone());
    }
    copying_ = false;
  }

  void Changed(Profile* from, const std::string& pref) {
    // A copy made here changes the others' preferences too; those changes
    // are this one's echo.
    if (copying_) {
      return;
    }
    for (const auto& [profile, _] : watched_) {
      if (profile != from) {
        CopyPref(from, profile, pref);
      }
    }
  }

  // ProfileObserver:
  void OnProfileWillBeDestroyed(Profile* profile) override {
    profile->RemoveObserver(this);
    watched_.erase(profile);
  }

  std::map<raw_ptr<Profile>, std::unique_ptr<PrefChangeRegistrar>> watched_;
  bool copying_ = false;
};

}  // namespace

std::string SpaceDataId(Profile* profile) {
  if (!profile) {
    return std::string();
  }
  return profile->GetOriginalProfile()->GetBaseName().AsUTF8Unsafe();
}

bool IsSpaceDataId(std::string_view id) {
  if (id == kFirstSpaceData) {
    return true;
  }
  constexpr std::string_view kPrefix = "Profile ";
  if (!id.starts_with(kPrefix) || id.size() > kPrefix.size() + 9) {
    return false;
  }
  unsigned number = 0;
  const std::string_view digits = id.substr(kPrefix.size());
  return !digits.empty() && digits.front() != '0' &&
         base::StringToUint(digits, &number);
}

void LoadSpaceData(std::string_view id,
                   base::OnceCallback<void(Profile*)> done) {
  const base::FilePath path = KnownPath(id);
  ProfileManager* manager = Manager();
  if (path.empty() || !manager) {
    std::move(done).Run(nullptr);
    return;
  }
  if (Profile* loaded = manager->GetProfileByPath(path)) {
    std::move(done).Run(loaded);
    return;
  }
  // LoadProfileByPath runs the callback itself, with nullptr on failure.
  auto [first, second] = base::SplitOnceCallback(std::move(done));
  if (!manager->LoadProfileByPath(path, /*incognito=*/false,
                                  std::move(first))) {
    std::move(second).Run(nullptr);
  }
}

void CreateSpaceData(std::string_view name,
                     base::OnceCallback<void(Profile*)> done) {
  std::u16string title = base::UTF8ToUTF16(name);
  if (title.empty()) {
    title = u"Space";
  }
  ProfileManager::CreateMultiProfileAsync(
      title, profiles::GetPlaceholderAvatarIndex(), /*is_hidden=*/false,
      base::BindOnce(
          [](base::OnceCallback<void(Profile*)> done, Profile* profile) {
            if (profile) {
              ShareSpaceSettings(profile);
            }
            std::move(done).Run(profile);
          },
          std::move(done)));
}

std::string DeleteSpaceData(std::string_view id) {
  if (id == kFirstSpaceData) {
    return "Home’s data can’t be deleted";
  }
  const base::FilePath path = KnownPath(id);
  ProfileManager* manager = Manager();
  if (path.empty() || !manager) {
    return "That space’s data is already gone";
  }
  manager->GetDeleteProfileHelper().MaybeScheduleProfileForDeletion(
      path, base::DoNothing(), ProfileMetrics::DELETE_PROFILE_SETTINGS);
  return std::string();
}

void ShareSpaceSettings(Profile* profile) {
  SharedSettings::Get().Share(profile);
}

void SpreadSpaceSetting(Profile* from, std::string_view key) {
  if (from && !from->IsOffTheRecord()) {
    SharedSettings::Get().Spread(from, key);
  }
}

}  // namespace modal_browser
