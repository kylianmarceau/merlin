// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MODAL_BROWSER_CONTROLLER_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MODAL_BROWSER_CONTROLLER_H_

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/callback_list.h"
#include "base/scoped_observation.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/sequence_checker.h"
#include "base/task/cancelable_task_tracker.h"
#include "base/timer/timer.h"
#include "url/origin.h"
#include "chrome/browser/ui/modal_browser/config_file.h"
#include "chrome/browser/ui/modal_browser/modal_input_router.h"
#include "chrome/browser/ui/modal_browser/page_scripts.h"
#include "chrome/browser/ui/modal_browser/palette_view.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/download/content/public/all_download_item_notifier.h"
#include "content/public/browser/editable_level.h"
#include "content/public/browser/global_routing_id.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/weak_document_ptr.h"
#include "ui/base/accelerators/accelerator.h"
#include "ui/base/unowned_user_data/scoped_unowned_user_data.h"
#include "ui/views/view.h"
#include "ui/views/view_observer.h"

class BrowserView;
class BrowserWindowInterface;
class GURL;
class LocationBarView;

namespace input {
struct NativeWebKeyboardEvent;
}

namespace views {
class FocusManager;
}

namespace modal_browser {
class MerlinAdblockButton;

// Keeps Chromium's own defaults for the UI the fork changes (tabs on top)
// and skips the user's config file. For running upstream test suites, which
// assume upstream defaults; see scripts/run_browser_tests.sh.
inline constexpr char kUpstreamDefaultsSwitch[] =
    "modal-browser-upstream-defaults";

class ExternalEditor;
class HintHost;
class MerlinAddressEditor;
class MerlinTabBarHost;
class PageColorSampler;
class MerlinAddressField;
class MerlinNavButton;
class StatusHost;

// Per-window owner of the modal layer. Created and destroyed by
// EmbedderBrowserWindowFeatures (the hook Chromium provides for embedders),
// so no core BrowserWindowFeatures code is patched.
//
// Responsibilities, all thin:
//  * convert keyboard events, focus, navigation and pointer activity into
//    router calls;
//  * implement BrowserOps with existing chrome:: and content:: APIs;
//  * own the palette, status and hint surfaces, the sequence timer, and the
//    page-side work (hint collection, scrolling) in Chrome's isolated world.
// All decisions about what keys mean live in Rust behind ModalInputRouter.
class ModalBrowserController : public BrowserOps,
                               public PaletteDelegate,
                               public TabStripModelObserver,
                               public content::WebContentsObserver,
                               public download::AllDownloadItemNotifier::Observer,
                               public ui::AcceleratorTarget {
 public:
  DECLARE_USER_DATA(ModalBrowserController);

  ModalBrowserController(BrowserWindowInterface* browser,
                         BrowserView* browser_view);
  ModalBrowserController(const ModalBrowserController&) = delete;
  ModalBrowserController& operator=(const ModalBrowserController&) = delete;
  ~ModalBrowserController() override;

  // Returns nullptr for windows without the modal layer.
  static ModalBrowserController* From(BrowserWindowInterface* browser);

  // Called from BrowserView::PreHandleKeyboardEvent for kRawKeyDown events
  // headed to web content. Returns true if the event was consumed; Chromium
  // then suppresses the matching char and key-up events.
  bool PreHandleKeyDown(const input::NativeWebKeyboardEvent& event);

  // Runs a command line as if typed after ':'. Returns the error, empty on
  // success.
  std::string RunCommandLine(std::string_view line);

  // For Merlin Settings (merlin_settings_page.cc).
  bool TabsInSidebar() const;
  bool TabsHidden() const { return tabs_hidden_; }

  // ui::AcceleratorTarget (Cmd-S, after the page had its chance):
  bool AcceleratorPressed(const ui::Accelerator& accelerator) override;
  bool CanHandleAccelerators() const override;
  // Rereads the config file in every window, after Settings saved it.
  // `announce` also confirms the reload in its status bar; errors show in
  // every window.
  static void ReloadConfigInAllWindows(ModalBrowserController* announce);
  std::vector<ModalInputRouter::Binding> KeyBindings() const;
  std::string HintChars() const;

  // Handles one browserctl request line (UI thread); replies once.
  static void HandleBrowserctlRequest(
      std::string line,
      base::OnceCallback<void(std::string)> reply);

  // BrowserOps:
  void OpenUrl(std::string_view url, ffi::OpenDisposition disposition) override;
  void OpenSearch(std::string_view terms,
                  ffi::OpenDisposition disposition) override;
  void NewTab() override;
  void CloseTab() override;
  void RestoreTab() override;
  void SelectNextTab(int count) override;
  void SelectPreviousTab(int count) override;
  void SelectFirstTab() override;
  void SelectLastTab() override;
  void ActivateTab(int32_t id) override;
  std::vector<TabEntry> GetTabs() override;
  void GoBack(int count) override;
  void GoForward(int count) override;
  void Reload(bool bypass_cache) override;
  void NavigateUp(int count) override;
  void NavigateRoot() override;
  void Scroll(ffi::ScrollKind scroll,
              int count,
              int step_px,
              bool smooth) override;
  void FocusAddressBar() override;
  void FindInPage() override;
  void FindNext() override;
  void FindPrevious() override;
  void BlurFocusedElement() override;
  void Yank(ffi::YankKind kind) override;
  void ReadClipboard(ffi::OpenDisposition disposition) override;
  void CollectHints(uint32_t generation, ffi::HintTargets targets) override;
  void ShowHints(const std::vector<HintLabelView>& hints,
                 ffi::HintAction action) override;
  void FilterHints(std::string_view typed) override;
  void HideHints() override;
  void ActivateHint(uint32_t target, ffi::HintAction action) override;
  void ShowPalette(const ffi::PaletteState& state) override;
  void HidePalette() override;
  void ReadConfig() override;
  void SetVerticalTabsDefault(bool vertical) override;
  void SetVerticalTabs(ffi::Switch value) override;
  void SetTabSidebar(ffi::Switch value) override;
  void SetTabsHiddenDefault(bool hidden) override;
  void SetTabsHidden(ffi::Switch value) override;
  void ShowMessage(ffi::MessageLevel level, std::string_view text) override;
  void UpdateStatus(ffi::Mode mode,
                    std::string_view indicator,
                    std::string_view pending,
                    const std::vector<KeyHintView>& which_key) override;
  void StartSequenceTimer(uint32_t delay_ms) override;
  void StopSequenceTimer() override;
  void Split(ffi::SplitLayout layout, const OpenRequest& target) override;
  void FocusOtherSplit() override;
  void SwapSplit() override;
  void Unsplit() override;
  void PinTab(ffi::Switch value) override;
  void NewWindow(bool private_window) override;
  void SnapshotWorkspace(std::string_view name, bool quiet) override;
  void WriteWorkspace(std::string_view name,
                      std::string_view contents,
                      std::string_view message) override;
  void ReadWorkspace(std::string_view name) override;
  void DeleteWorkspace(std::string_view name) override;
  void RestoreWorkspace(const WorkspaceRestore& workspace) override;
  void SwitchProfile(std::string_view name) override;
  void RequestItems(ffi::ItemSource source) override;
  void ShowBrowserPage(ffi::BrowserPage page) override;
  void RunBrowserCommand(std::string_view name, std::string_view arg) override;
  void ToggleDevTools() override;
  void AddBookmark() override;
  void CollectDocument(uint32_t generation) override;
  void RevealElement(uint32_t element) override;
  void JumpToBlock(ffi::BlockJump kind, bool forward, int count) override;
  void CopyText(std::string_view text, std::string_view what) override;
  void OpenInEditor(std::string_view text,
                    std::string_view extension,
                    const std::vector<std::string>& argv) override;
  void InspectField(bool force) override;
  void EditField(const std::vector<std::string>& argv) override;
  void ExtendSelection(bool forward, ffi::SelectUnit unit, int count) override;
  void ClearSelection() override;
  void RecordMark(std::string_view letter) override;
  void GoToMark(std::string_view letter,
                std::string_view url,
                int64_t x,
                int64_t y,
                bool navigate) override;

  // PaletteDelegate:
  void OnPaletteTextChanged(std::u16string_view text) override;
  void OnPaletteKey(ffi::PaletteKey key) override;
  void OnPaletteRowClicked(int index) override;
  gfx::ImageSkia GetTabIcon(int32_t tab_id) override;

  // TabStripModelObserver:
  void OnTabStripModelChanged(TabStripModel* tab_strip_model,
                              const TabStripModelChange& change,
                              const TabStripSelectionChange& selection) override;
  void OnTabChangedAt(tabs::TabInterface* tab,
                      TabChangeType change_type) override;

  // content::WebContentsObserver:
  void OnFocusChangedInPage(const content::FocusedNodeDetails& details) override;
  void PrimaryPageChanged(content::Page& page) override;
  void DidGetUserInteraction(const blink::WebInputEvent& event) override;
  void DocumentOnLoadCompletedInPrimaryMainFrame() override;
  void DidChangeVisibleSecurityState() override;

  // download::AllDownloadItemNotifier::Observer (the status bar's count):
  void OnDownloadCreated(content::DownloadManager* manager,
                         download::DownloadItem* item) override;
  void OnDownloadUpdated(content::DownloadManager* manager,
                         download::DownloadItem* item) override;
  void OnDownloadRemoved(content::DownloadManager* manager,
                         download::DownloadItem* item) override;

  ffi::Mode mode_for_testing() const { return router_.mode(); }
  StatusHost* status_for_testing() { return status_.get(); }
  PaletteHost* palette_for_testing() { return palette_.get(); }
  HintHost* hints_for_testing() { return hints_.get(); }
  std::string workspace_for_testing() const { return router_.workspace(); }
  ExternalEditor* field_editor_for_testing() { return field_editor_.get(); }
  MerlinAddressField* address_field_for_testing() { return address_field_; }
  MerlinAdblockButton* adblock_button_for_testing() { return adblock_button_; }
  MerlinTabBarHost* tab_bar_host_for_testing() { return tab_bar_host_.get(); }
  MerlinNavButton* back_button_for_testing() { return back_button_; }
  // Called after page-side work (hint collection, activation) finishes.
  void set_page_work_done_callback_for_testing(base::RepeatingClosure cb) {
    page_work_done_for_testing_ = std::move(cb);
  }

 private:
  content::WebContents* ActiveContents();
  PageFocus CurrentFocus();
  void ObserveActiveContents();
  // Hides Chromium's ⋮ menu and account buttons; the Merlin menu (M,
  // :palette menu) and the profiles palette replace them.
  void HideChromiumToolbarButtons();
  void StartWatchingDownloads();
  void UpdateDownloadStatus();
  void OnActiveTabChanged();
  // Workspace and title for the status bar, and the toolbar row's state.
  void UpdatePageContext();
  // Tabs moved between the top and the sidebar.
  void OnTabLayoutChanged();
  void ApplyTabLayout();
  // Puts Merlin's back, forward, reload and address field in the toolbar
  // row in place of Chromium's (once per window), then shows the field on
  // sites and hides it on the start page.
  // Gives the active tab, the toolbar and what is drawn on it the page's
  // color (nullopt: Merlin's own).
  void ApplyPageColor(std::optional<SkColor> color);
  // Shows or hides the tabs (tabs_hidden_) everywhere it shows.
  void ApplyTabsHidden();
  // Cmd-S on the window's focus manager, once the window has one.
  void RegisterAccelerators();
  void InstallMerlinToolbar(LocationBarView* location_bar);
  void UpdateMerlinToolbar(content::WebContents* contents, bool start_page);
  void ShowSiteInfo();
  bool ToolbarHidden() const { return toolbar_hidden_; }
  // Puts the cursor where the address is typed: the toolbar row's field on
  // sites (MerlinAddressEditor), the start page's own field there.
  void EditAddress();
  bool EditingAddress() const;
  // The palette's command line, pre-filled to edit the page address, for
  // when neither field is there.
  void EditAddressInPalette();
  float DeviceScaleFactor();
  void LoadConfig(bool announce);
  void OnConfigRead(bool announce, config_file::ReadResult result);
  void OnFrameHintTargets(uint32_t generation, size_t index, base::Value result);
  void OnActivationInfo(ffi::HintAction action,
                        content::GlobalRenderFrameHostId frame,
                        base::Value result);
  void ClickAt(content::RenderFrameHost* local_root, const gfx::PointF& point);
  void OnMarkPosition(std::string letter, base::Value result);
  void Navigate(const GURL& url, ffi::OpenDisposition disposition);
  void WriteClipboard(const std::u16string& text, std::u16string_view what);
  void PageWorkDone();
  // URL for a split, a search or a command, checked like OpenUrl does.
  std::optional<GURL> ResolveTarget(const OpenRequest& target);
  void OnDocument(uint32_t generation, base::Value result);
  void OnFieldInfo(uint64_t generation, bool force, base::Value result);
  void OnFieldValue(uint64_t generation, std::vector<std::string> argv, base::Value result);
  void WriteBackField(uint64_t generation, std::string text);
  void OnFieldWritten(uint64_t generation, base::Value result);
  void OnFieldEditDone(uint64_t generation, std::string error);
  void CancelFieldEdit();
  void ScheduleAutosave();
  void ApplyConfigToBrowser();
  void FocusTabNumber(uint32_t number, std::string* error);
  void ReadSelection(base::OnceCallback<void(std::string)> reply);
  content::RenderFrameHost* FocusedFrame();

  SEQUENCE_CHECKER(sequence_checker_);

  const raw_ptr<BrowserWindowInterface> browser_;
  const raw_ptr<BrowserView> browser_view_;
  ModalInputRouter router_;
  std::unique_ptr<StatusHost> status_;
  std::unique_ptr<PaletteHost> palette_;
  std::unique_ptr<HintHost> hints_;
  base::OneShotTimer sequence_timer_;
  base::CallbackListSubscription tab_layout_subscription_;
  bool toolbar_hidden_ = false;
  // Tabs hidden entirely (Cmd-S, :hide-tabs, config hide_tabs).
  bool tabs_hidden_ = false;
  // The config's hide_tabs as last applied; it applies again only when it
  // changes.
  std::optional<bool> tabs_hidden_default_;
  // The focus manager Cmd-S is registered with.
  raw_ptr<views::FocusManager> accelerator_focus_manager_ = nullptr;
  // Merlin's own UI is on (not --modal-browser-upstream-defaults).
  bool merlin_ui_ = false;
  // Started after startup; keeps the status bar's download count.
  std::unique_ptr<download::AllDownloadItemNotifier> download_notifier_;
  base::OneShotTimer download_status_timer_;
  // Owned by the toolbar row; see ApplyTabLayout() and
  // InstallMerlinToolbar(). The two spacers center the address field.
  raw_ptr<views::View> toolbar_spacer_ = nullptr;
  raw_ptr<views::View> toolbar_spacer_right_ = nullptr;
  raw_ptr<MerlinNavButton> back_button_ = nullptr;
  raw_ptr<MerlinNavButton> forward_button_ = nullptr;
  raw_ptr<MerlinNavButton> reload_button_ = nullptr;
  raw_ptr<MerlinAddressField> address_field_ = nullptr;
  raw_ptr<MerlinAdblockButton> adblock_button_ = nullptr;
  // Swaps Chromium's field in while the address is edited.
  std::unique_ptr<MerlinAddressEditor> address_editor_;
  // Merlin's tab bar over Chromium's, with tabs on top.
  std::unique_ptr<MerlinTabBarHost> tab_bar_host_;
  // The active page's color, which the active tab and the toolbar take.
  std::unique_ptr<PageColorSampler> page_color_;
  std::optional<SkColor> page_color_value_;
  // Last editable level reported for the observed tab, to tell plain text
  // fields from rich editors when IsFocusedElementEditable() is true.
  content::EditableLevel last_editable_level_ =
      content::EditableLevel::kNotEditable;
  // Targets from the last hint collection, and the frame they came from.
  // A hint request waiting for its frames to answer.
  struct HintCollection {
    uint32_t generation = 0;
    int pending = 0;
    std::vector<content::GlobalRenderFrameHostId> frames;
    std::vector<std::optional<page_scripts::HintTargets>> results;
  };
  std::optional<HintCollection> hint_collection_;
  // Targets of the hints on screen: the frame, the index in that frame's
  // list, and where the label goes in the web contents.
  struct PlacedHint {
    content::GlobalRenderFrameHostId frame;
    uint32_t index = 0;
    ffi::HintKind kind = ffi::HintKind::Other;
    gfx::PointF root_dip;
  };
  std::vector<PlacedHint> placed_hints_;
  base::RepeatingClosure page_work_done_for_testing_;
  // The frame the last document extraction came from.
  content::GlobalRenderFrameHostId document_frame_;
  // The field being edited externally: where it is, and the token its
  // page-side tag carries.
  struct EditTarget {
    int32_t tab = -1;
    content::GlobalRenderFrameHostId frame;
    url::Origin origin;
    uint64_t token = 0;
  };
  EditTarget edit_target_;
  content::WeakDocumentPtr edit_document_;
  uint64_t edit_generation_ = 0;
  size_t edit_writes_pending_ = 0;
  bool edit_done_ = false;
  std::unique_ptr<ExternalEditor> field_editor_;
  // Read-only exports (`:extract ... editor`), by increasing id.
  std::map<int, std::unique_ptr<ExternalEditor>> exports_;
  int next_export_ = 0;
  base::OneShotTimer autosave_timer_;
  base::CancelableTaskTracker history_tracker_;
  // Registers this object on the window so From() can find it. Declared
  // after everything it may call into, so it unregisters first.
  ui::ScopedUnownedUserData<ModalBrowserController> scoped_unowned_user_data_;
  base::WeakPtrFactory<ModalBrowserController> weak_factory_{this};
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MODAL_BROWSER_CONTROLLER_H_
