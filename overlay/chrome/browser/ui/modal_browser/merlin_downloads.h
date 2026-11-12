// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_DOWNLOADS_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_DOWNLOADS_H_

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "base/values.h"

class Profile;

namespace download {
class DownloadItem;
}

namespace modal_browser {

// Downloads as Merlin shows them: the Downloads page, the downloads
// palette (`:palette downloads`) and the status bar share these, so a file
// reads the same everywhere.

// The profile's downloads a person started (no transient ones), newest
// first.
std::vector<download::DownloadItem*> MerlinDownloads(Profile* profile);

// "progress", "paused", "done", "failed", "cancelled", "removed" (finished
// but the file is gone) or "dangerous" (held back until the user decides).
std::string MerlinDownloadState(const download::DownloadItem* item);

// One line under the file name: "45% · 3.1 of 7.0 MB · 1.2 MB/s",
// "2.1 MB · example.com", "Failed: network error".
std::string MerlinDownloadDetail(const download::DownloadItem* item);

// The shorter line the toolbar's downloads pop-up shows: "141.8/317.5 MB ·
// 21s", "Paused · 141.8/317.5 MB", "317.5 MB · example.com".
std::string MerlinDownloadShortDetail(const download::DownloadItem* item);

// {id, name, url, state, detail, percent, canResume, start} for the page.
base::DictValue DescribeMerlinDownload(const download::DownloadItem* item);

// The shell's view of downloads, newest first: every running download plus
// the most recent others up to `limit` in all. Window snapshots carry a short
// list; the Library asks for all of them.
base::ListValue MerlinDownloadsList(Profile* profile, size_t limit);

// Runs a `:browser download-*` action (open, show, cancel, pause (toggles),
// retry) or a page-only one (discard, forget). Returns an error to show,
// empty on success.
std::string RunMerlinDownloadAction(Profile* profile,
                                     std::string_view action,
                                     uint32_t id);

void OpenMerlinDownloadsFolder(Profile* profile);

// For the status bar: "↓ 2 · 45%" while files are downloading, empty
// otherwise.
std::string MerlinDownloadsStatus(Profile* profile);

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_DOWNLOADS_H_
