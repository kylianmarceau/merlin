// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_DOWNLOADS_BUTTON_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_DOWNLOADS_BUTTON_H_

#include <memory>
#include <optional>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "components/download/content/public/all_download_item_notifier.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/controls/button/button.h"
#include "ui/views/view_tracker.h"

class BrowserWindowInterface;
class Profile;

namespace download {
class DownloadItem;
}

namespace views {
class Widget;
}

namespace modal_browser {

// Merlin's downloads button, in place of Chromium's: an arrow over a small
// progress pill, shown while there are recent downloads. It opens a pop-up
// listing them (progress rings, file icons, cancel and show-in-Finder) with
// a Clear pill and a link to the Downloads page.
class MerlinDownloadsButton
    : public views::Button,
      public download::AllDownloadItemNotifier::Observer {
  METADATA_HEADER(MerlinDownloadsButton, views::Button)

 public:
  // `show_all` opens the Downloads page.
  MerlinDownloadsButton(BrowserWindowInterface* browser,
                        base::RepeatingClosure show_all);
  MerlinDownloadsButton(const MerlinDownloadsButton&) = delete;
  MerlinDownloadsButton& operator=(const MerlinDownloadsButton&) = delete;
  ~MerlinDownloadsButton() override;

  // What the button and pop-up list, newest first: running and held-back
  // downloads, and others started in the last day since the last Clear.
  static std::vector<download::DownloadItem*> Recent(Profile* profile);
  // Clear: finished downloads leave the list (not the Downloads page).
  static void ClearRecent(Profile* profile);

  // As MerlinNavButton::SetSurface.
  void SetSurface(std::optional<SkColor> surface);
  void Update();

  views::Widget* popover_for_testing();
  // Overall progress drawn in the pill: 0..1, or nullopt with nothing
  // running.
  std::optional<double> progress_for_testing() const { return progress_; }

  // views::Button:
  gfx::Size CalculatePreferredSize(
      const views::SizeBounds& available_size) const override;
  void PaintButtonContents(gfx::Canvas* canvas) override;
  void StateChanged(ButtonState old_state) override;

  // download::AllDownloadItemNotifier::Observer:
  void OnDownloadCreated(content::DownloadManager* manager,
                         download::DownloadItem* item) override;
  void OnDownloadUpdated(content::DownloadManager* manager,
                         download::DownloadItem* item) override;
  void OnDownloadRemoved(content::DownloadManager* manager,
                         download::DownloadItem* item) override;

 private:
  void Pressed();

  const raw_ptr<BrowserWindowInterface> browser_;
  base::RepeatingClosure show_all_;
  std::optional<SkColor> surface_;
  std::optional<double> progress_;
  std::unique_ptr<download::AllDownloadItemNotifier> notifier_;
  views::ViewTracker popover_;
  base::WeakPtrFactory<MerlinDownloadsButton> weak_factory_{this};
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_DOWNLOADS_BUTTON_H_
