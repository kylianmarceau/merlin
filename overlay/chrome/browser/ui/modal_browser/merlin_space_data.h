// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SPACE_DATA_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SPACE_DATA_H_

#include <string>
#include <string_view>

#include "base/functional/callback_forward.h"

class Profile;

namespace modal_browser {

// A space's data, as Arc's spaces have their profiles: its cookies, logins,
// passwords, history, bookmarks, extensions, favourites and site settings.
// Several spaces can share the same data. Underneath, each set of data is a
// Chromium profile; its ID is the name of the profile's folder in the user
// data directory: "Default" for the data Merlin started with (Home's), and
// Chromium's "Profile 1", "Profile 2"… for the others. The interface never
// calls them profiles (apps/browser/src/state/spaces.ts).
inline constexpr char kFirstSpaceData[] = "Default";

// The data `profile` holds (its original profile's for a private window).
std::string SpaceDataId(Profile* profile);

// Whether `id` can name a space's data: "Default" or "Profile <number>".
bool IsSpaceDataId(std::string_view id);

// Loads the data `id` names, if Merlin has it, and runs `done` with its
// profile; with nullptr when there is no such data or it can't be opened.
void LoadSpaceData(std::string_view id, base::OnceCallback<void(Profile*)> done);

// Makes new data for a space named `name` (the name is only Chromium's
// record of it). `done` gets the new data, with Merlin's settings already
// copied in, or nullptr.
void CreateSpaceData(std::string_view name,
                     base::OnceCallback<void(Profile*)> done);

// Deletes the data `id` names, closing its windows first, without asking.
// Home's data ("Default") is never deleted. Returns an error to show, or
// empty once the deletion is under way.
std::string DeleteSpaceData(std::string_view id);

// Merlin's settings are the same in every space's data: these keep them so.
// Starts keeping `profile`'s settings the same as the others', taking Home's
// first when `profile` is other data. Safe to call more than once.
void ShareSpaceSettings(Profile* profile);

// A setting that is not a plain preference (the search engine, the default
// zoom) changed in `from`: every other loaded space's data takes it.
void SpreadSpaceSetting(Profile* from, std::string_view key);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SPACE_DATA_H_
