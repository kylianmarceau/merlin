// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_downloads.h"

#include <algorithm>
#include <array>

#include "base/files/file_path.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/stringprintf.h"
#include "chrome/browser/download/download_prefs.h"
#include "chrome/browser/platform_util.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_vocabulary.h"
#include "components/download/public/common/download_interrupt_reasons.h"
#include "components/download/public/common/download_item.h"
#include "content/public/browser/download_manager.h"

namespace modal_browser {

namespace {

std::string Size(int64_t bytes) {
  if (bytes <= 0) {
    return std::string();
  }
  static constexpr std::array<const char*, 5> kUnits = {"B", "KB", "MB", "GB",
                                                        "TB"};
  double value = bytes;
  size_t unit = 0;
  while (value >= 1000 && unit + 1 < kUnits.size()) {
    value /= 1000;
    ++unit;
  }
  return unit == 0 || value >= 10
             ? base::StringPrintf("%.0f %s", value, kUnits.at(unit))
             : base::StringPrintf("%.1f %s", value, kUnits.at(unit));
}

std::string Host(const download::DownloadItem* item) {
  std::string host(item->GetURL().host());
  if (base::StartsWith(host, "www.")) {
    host = host.substr(4);
  }
  return host;
}

// Download interrupt reasons are grouped by number (download_interrupt_
// reason_values.h): 1-19 file, 20-29 network, 30-39 server, 40-49 user.
std::string Reason(download::DownloadInterruptReason reason) {
  const int value = static_cast<int>(reason);
  if (value >= 1 && value < 20) {
    return "could not save the file";
  }
  if (value >= 20 && value < 30) {
    return "network error";
  }
  if (value >= 30 && value < 40) {
    return "the server refused";
  }
  if (value >= 40 && value < 50) {
    return "cancelled";
  }
  return "interrupted";
}

download::DownloadItem* Find(Profile* profile, uint32_t id) {
  content::DownloadManager* manager =
      profile ? profile->GetDownloadManager() : nullptr;
  download::DownloadItem* item = manager ? manager->GetDownload(id) : nullptr;
  return item && !item->IsTransient() ? item : nullptr;
}

}  // namespace

std::vector<download::DownloadItem*> MerlinDownloads(Profile* profile) {
  std::vector<download::DownloadItem*> out;
  content::DownloadManager* manager =
      profile ? profile->GetDownloadManager() : nullptr;
  if (!manager) {
    return out;
  }
  content::DownloadManager::DownloadVector all;
  manager->GetAllDownloads(&all);
  for (download::DownloadItem* item : all) {
    if (!item->IsTransient() && !item->GetFileNameToReportUser().empty()) {
      out.push_back(item);
    }
  }
  std::sort(out.begin(), out.end(), [](const auto* a, const auto* b) {
    return a->GetStartTime() > b->GetStartTime();
  });
  return out;
}

base::ListValue MerlinDownloadsList(Profile* profile, size_t limit) {
  base::ListValue list;
  for (download::DownloadItem* d : MerlinDownloads(profile)) {
    const bool running = d->GetState() == download::DownloadItem::IN_PROGRESS;
    if (!running && list.size() >= limit) {
      continue;
    }
    const char* state =
        d->GetState() == download::DownloadItem::COMPLETE    ? "complete"
        : d->GetState() == download::DownloadItem::CANCELLED ? "cancelled"
        : d->GetState() == download::DownloadItem::INTERRUPTED
            ? "interrupted"
            : "progress";
    base::DictValue entry =
        base::DictValue()
            .Set("id", base::NumberToString(d->GetId()))
            .Set("name", d->GetFileNameToReportUser().AsUTF8Unsafe())
            .Set("received", static_cast<double>(d->GetReceivedBytes()))
            .Set("total",
                 static_cast<double>(std::max<int64_t>(0, d->GetTotalBytes())))
            .Set("state", state)
            .Set("status", MerlinDownloadState(d))
            .Set("detail", MerlinDownloadShortDetail(d))
            .Set("url", d->GetURL().spec());
    // A finished file's place on disk, so the shell can drag it out to
    // Finder, Mail or a page's upload field.
    if (d->GetState() == download::DownloadItem::COMPLETE &&
        !d->GetFileExternallyRemoved() && !d->GetTargetFilePath().empty()) {
      entry.Set("path", d->GetTargetFilePath().AsUTF8Unsafe());
    }
    list.Append(std::move(entry));
  }
  return list;
}

std::string MerlinDownloadState(const download::DownloadItem* item) {
  switch (item->GetState()) {
    case download::DownloadItem::IN_PROGRESS:
      if (item->IsDangerous() || item->IsInsecure()) {
        return "dangerous";
      }
      return item->IsPaused() ? "paused" : "progress";
    case download::DownloadItem::COMPLETE:
      return item->GetFileExternallyRemoved() ? "removed" : "done";
    case download::DownloadItem::CANCELLED:
      return "cancelled";
    case download::DownloadItem::INTERRUPTED:
      return "failed";
    case download::DownloadItem::MAX_DOWNLOAD_STATE:
      break;
  }
  return "failed";
}

std::string MerlinDownloadDetail(const download::DownloadItem* item) {
  const std::string state = MerlinDownloadState(item);
  const std::string host = Host(item);
  const std::string total = Size(item->GetTotalBytes());
  if (state == "progress" || state == "paused") {
    std::string line;
    if (item->PercentComplete() >= 0) {
      line = base::NumberToString(item->PercentComplete()) + "% · ";
    }
    line += Size(item->GetReceivedBytes());
    if (!total.empty()) {
      line += " of " + total;
    }
    if (state == "paused") {
      line += " · paused";
    } else if (item->CurrentSpeed() > 0) {
      line += " · " + Size(item->CurrentSpeed()) + "/s";
    }
    return line;
  }
  if (state == "dangerous") {
    return "This file may be harmful, so Merlin kept it back";
  }
  if (state == "failed") {
    return "Failed: " + Reason(item->GetLastReason());
  }
  if (state == "cancelled") {
    return "Cancelled" + (host.empty() ? std::string() : " · " + host);
  }
  if (state == "removed") {
    return "Deleted from disk";
  }
  std::string line = total.empty() ? Size(item->GetReceivedBytes()) : total;
  if (!host.empty()) {
    line += (line.empty() ? "" : " · ") + host;
  }
  return line;
}

namespace {

// "141.8/317.5 MB": both in the total's unit, so they read as a fraction.
std::string Fraction(int64_t received, int64_t total) {
  static constexpr std::array<const char*, 5> kUnits = {"B", "KB", "MB", "GB",
                                                        "TB"};
  double scale = 1;
  size_t unit = 0;
  while (total / scale >= 1000 && unit + 1 < kUnits.size()) {
    scale *= 1000;
    ++unit;
  }
  return unit == 0 ? base::StringPrintf("%.0f/%.0f %s", received / scale,
                                        total / scale, kUnits.at(unit))
                   : base::StringPrintf("%.1f/%.1f %s", received / scale,
                                        total / scale, kUnits.at(unit));
}

std::string TimeLeft(base::TimeDelta left) {
  const int64_t s = std::max<int64_t>(1, left.InSeconds());
  if (s < 60) {
    return base::NumberToString(s) + "s";
  }
  if (s < 3600) {
    return base::NumberToString(s / 60) + " min";
  }
  return base::NumberToString(s / 3600) + " h";
}

}  // namespace

std::string MerlinDownloadShortDetail(const download::DownloadItem* item) {
  const std::string state = MerlinDownloadState(item);
  const int64_t received = item->GetReceivedBytes();
  const int64_t total = item->GetTotalBytes();
  if (state == "progress" || state == "paused") {
    std::string amount =
        total > 0 ? Fraction(received, total) : Size(received);
    if (amount.empty()) {
      amount = "Starting";
    }
    if (state == "paused") {
      return "Paused · " + amount;
    }
    base::TimeDelta left;
    if (item->TimeRemaining(&left)) {
      return amount + " · " + TimeLeft(left);
    }
    if (item->CurrentSpeed() > 0) {
      return amount + " · " + Size(item->CurrentSpeed()) + "/s";
    }
    return amount;
  }
  if (state == "dangerous") {
    return "Held back · open to decide";
  }
  return MerlinDownloadDetail(item);
}

base::DictValue DescribeMerlinDownload(const download::DownloadItem* item) {
  base::DictValue d;
  d.Set("id", static_cast<int>(item->GetId()));
  d.Set("name", item->GetFileNameToReportUser().AsUTF8Unsafe());
  d.Set("url", item->GetURL().spec());
  d.Set("state", MerlinDownloadState(item));
  d.Set("detail", MerlinDownloadDetail(item));
  d.Set("percent", std::max(0, item->PercentComplete()));
  d.Set("canResume", item->CanResume());
  d.Set("start", item->GetStartTime().InSecondsFSinceUnixEpoch());
  return d;
}

std::string RunMerlinDownloadAction(Profile* profile,
                                     std::string_view action,
                                     uint32_t id) {
  download::DownloadItem* item = Find(profile, id);
  if (!item) {
    return "No download " + base::NumberToString(id);
  }
  const std::string state = MerlinDownloadState(item);
  if (action == shell::download_action::kOpen) {
    if (state != "done") {
      return "The file is not ready to open";
    }
    item->OpenDownload();
  } else if (action == shell::download_action::kShow) {
    if (state == "removed" || state == "cancelled") {
      return "The file is no longer on disk";
    }
    item->ShowDownloadInShell();
  } else if (action == shell::download_action::kCancel) {
    if (state != "progress" && state != "paused") {
      return "The download is not running";
    }
    item->Cancel(/*user_cancel=*/true);
  } else if (action == shell::download_action::kPause) {
    if (state == "progress") {
      item->Pause();
    } else if (state == "paused" || (state == "failed" && item->CanResume())) {
      item->Resume(/*user_resume=*/true);
    } else {
      return "The download is not running";
    }
  } else if (action == shell::download_action::kRetry) {
    if (!item->CanResume()) {
      return "This download cannot be resumed";
    }
    item->Resume(/*user_resume=*/true);
  } else if (action == shell::download_action::kDiscard) {
    // Discarding a held-back file deletes it, as Chromium's own page does.
    if (state != "dangerous") {
      return "Only held-back files are discarded";
    }
    item->Remove();
  } else if (action == shell::download_action::kForget) {
    if (state == "progress" || state == "paused" || state == "dangerous") {
      return "Cancel the download first";
    }
    item->Remove();
  } else {
    return "Unknown download action";
  }
  return std::string();
}

void OpenMerlinDownloadsFolder(Profile* profile) {
  DownloadPrefs* prefs = DownloadPrefs::FromBrowserContext(profile);
  if (!prefs) {
    return;
  }
  platform_util::OpenItem(profile, prefs->DownloadPath(),
                          platform_util::OPEN_FOLDER,
                          platform_util::OpenOperationCallback());
}

std::string MerlinDownloadsStatus(Profile* profile) {
  int running = 0;
  int64_t received = 0;
  int64_t total = 0;
  bool unknown = false;
  for (download::DownloadItem* item : MerlinDownloads(profile)) {
    if (MerlinDownloadState(item) != "progress") {
      continue;
    }
    ++running;
    received += item->GetReceivedBytes();
    if (item->GetTotalBytes() > 0) {
      total += item->GetTotalBytes();
    } else {
      unknown = true;
    }
  }
  if (!running) {
    return std::string();
  }
  std::string text = "↓ " + base::NumberToString(running);
  if (!unknown && total > 0) {
    text += " · " +
            base::NumberToString(static_cast<int>(received * 100 / total)) +
            "%";
  }
  return text;
}

}  // namespace modal_browser
