// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SAFETY_CONTROLS_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SAFETY_CONTROLS_H_

#include <memory>
#include <optional>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/scoped_observation.h"
#include "chrome/browser/media/webrtc/media_stream_capture_indicator.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/weak_document_ptr.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/menus/simple_menu_model.h"
#include "ui/views/layout/box_layout_view.h"

class BrowserWindowInterface;
namespace views {
class Button;
class MenuRunner;
}  // namespace views

namespace modal_browser {

// Always reachable site controls, explicit private-window identification and
// recording/sharing controls independent of the tab strip's visibility.
class MerlinSafetyControls : public views::BoxLayoutView,
                             public TabStripModelObserver,
                             public MediaStreamCaptureIndicator::Observer,
                             public ui::SimpleMenuModel::Delegate {
  METADATA_HEADER(MerlinSafetyControls, views::BoxLayoutView)

 public:
  MerlinSafetyControls(BrowserWindowInterface* browser,
                       base::RepeatingClosure show_site_info);
  ~MerlinSafetyControls() override;

  void Update();
  void UpdateSiteInfo();
  void SetSurface(std::optional<SkColor> surface);

  // The model retains handles rather than WebContents pointers: actions
  // revalidate both the tab and its window when the menu is used.
  void ExecuteCommand(int command_id, int event_flags) override;
  bool IsCommandIdEnabled(int command_id) const override;

  void OnTabStripModelChanged(
      TabStripModel* model,
      const TabStripModelChange& change,
      const TabStripSelectionChange& selection) override;
  void OnTabChangedAt(tabs::TabInterface* tab, TabChangeType type) override;
  void OnIsCapturingVideoChanged(content::WebContents*, bool) override;
  void OnIsCapturingAudioChanged(content::WebContents*, bool) override;
  void OnIsBeingMirroredChanged(content::WebContents*, bool) override;
  void OnIsCapturingTabChanged(content::WebContents*, bool) override;
  void OnIsCapturingWindowChanged(content::WebContents*, bool) override;
  void OnIsCapturingDisplayChanged(content::WebContents*, bool) override;

  views::Button* site_button_for_testing() { return site_button_; }
  views::Button* capture_button_for_testing() { return capture_button_; }
  views::View* private_badge_for_testing() { return private_badge_; }
  ui::SimpleMenuModel* BuildCaptureMenuForTesting();

 private:
  struct Capture {
    tabs::TabHandle tab;
    content::WeakDocumentPtr document;
    std::u16string description;
    bool sharing = false;
  };
  std::vector<Capture> Captures() const;
  content::WebContents* MenuContents(int command_id) const;
  void BuildCaptureMenu();
  void ShowCaptureMenu(const ui::Event& event);

  const raw_ptr<BrowserWindowInterface> browser_;
  scoped_refptr<MediaStreamCaptureIndicator> indicator_;
  base::ScopedObservation<MediaStreamCaptureIndicator,
                          MediaStreamCaptureIndicator::Observer>
      observation_{this};
  raw_ptr<views::Button> site_button_;
  raw_ptr<views::Button> capture_button_;
  raw_ptr<views::View> private_badge_;
  std::vector<Capture> menu_captures_;
  std::unique_ptr<ui::SimpleMenuModel> menu_model_;
  std::unique_ptr<views::MenuRunner> menu_runner_;
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_SAFETY_CONTROLS_H_
