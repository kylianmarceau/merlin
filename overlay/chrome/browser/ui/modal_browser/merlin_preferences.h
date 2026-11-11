// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PREFERENCES_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PREFERENCES_H_

#include <string>
#include <string_view>

#include "base/values.h"

class Profile;

namespace modal_browser {

class ModalBrowserController;

// Merlin's preferences, shared by the React shell's Settings and the legacy
// settings page so both read and write them identically. Browser UI thread.

// {theme, tabs, ctrlTab, bindings, hintChars, engines, engine, engineManaged,
//  startup, zoom, zoomChoices, downloadDir, askWhere, memorySaver,
//  energySaver, savePasswords, extensions, adblock, about}
base::DictValue MerlinPreferences(Profile* profile,
                                  ModalBrowserController* controller);

// {available, enabled, automatic, private, status, updateStatus, lastUpdate,
//  groups, exceptions}
base::DictValue MerlinAdblockState(Profile* profile);

// User-installed extensions, by name:
// [{id, name, version, enabled, canToggle}]
base::ListValue MerlinExtensionList(Profile* profile);

// Applies one preference by key (see MerlinPreferences for the keys, plus
// "adblockUpdates", "adblockLists", "adblockRefresh", "adblockException" and
// "extension": {id, enabled}). Returns an error or message to show; empty
// when there is nothing to say.
std::string SetMerlinPreference(Profile* profile,
                                ModalBrowserController* controller,
                                std::string_view key,
                                const base::Value& value);

// The Chromium page a Settings link opens, or empty for an unknown key.
std::string MerlinPreferenceLink(std::string_view key);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PREFERENCES_H_
