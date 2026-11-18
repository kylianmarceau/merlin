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
#include <utility>
#include <vector>

#include "base/callback_list.h"
#include "base/scoped_observation.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/sequence_checker.h"
#include "base/task/cancelable_task_tracker.h"
#include "base/timer/timer.h"
#include "base/values.h"
#include "url/origin.h"
#include "chrome/browser/ui/modal_browser/config_file.h"
#include "chrome/browser/ui/modal_browser/modal_input_router.h"
#include "chrome/browser/ui/modal_browser/page_scripts.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "content/public/browser/editable_level.h"
#include "content/public/browser/global_routing_id.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/weak_document_ptr.h"
#include "ui/base/unowned_user_data/scoped_unowned_user_data.h"

class BrowserWindowInterface;
class GURL;

namespace input {
struct NativeWebKeyboardEvent;
}

namespace modal_browser {

// Keeps Chromium's own defaults for the UI the fork changes (tabs on top)
// and skips the user's config file. For running upstream test suites, which
// assume upstream defaults; see scripts/run_browser_tests.sh.
inline constexpr char kUpstreamDefaultsSwitch[] =
    "modal-browser-upstream-defaults";

class ExternalEditor;

// Per-window owner of the modal layer in Merlin's React shell windows.
// Created and destroyed by EmbedderBrowserWindowFeatures (the hook Chromium
// provides for embedders), so no core BrowserWindowFeatures code is patched.
//
// Responsibilities, all thin:
//  * convert keyboard events, focus, navigation and pointer activity into
//    router calls;
//  * implement BrowserOps with existing chrome:: and content:: APIs;
//  * keep the presentation-neutral state the shell draws (mode, messages,
//    palette rows, hint labels), the sequence timer, and the page-side work
//    (hint collection, scrolling) in Chrome's isolated world.
// All decisions about what keys mean live in Rust behind ModalInputRouter.
// It draws nothing: the React shell renders ShellModalState().
class ModalBrowserController : public BrowserOps,
                               public TabStripModelObserver,
                               public content::WebContentsObserver {
 public:
  DECLARE_USER_DATA(ModalBrowserController);

  explicit ModalBrowserController(BrowserWindowInterface* browser);
  ModalBrowserController(const ModalBrowserController&) = delete;
  ModalBrowserController& operator=(const ModalBrowserController&) = delete;
  ~ModalBrowserController() override;

  // Returns nullptr for windows without the modal layer.
  static ModalBrowserController* From(BrowserWindowInterface* browser);

  // Called from the window's PreHandleKeyboardEvent for kRawKeyDown events
  // headed to web content. Returns true if the event was consumed; Chromium
  // then suppresses the matching char and key-up events.
  bool PreHandleKeyDown(const input::NativeWebKeyboardEvent& event);

  // Runs a command line as if typed after ':'. Returns the error, empty on
  // success.
  std::string RunCommandLine(std::string_view line);

  // Tabs in the sidebar rather than along the top (Chromium's vertical tabs
  // preference, which `tabs = "top"` and :vertical-tabs change).
  bool TabsInSidebar() const;
  // Presentation-neutral modal state for the React shell.
  base::DictValue ShellModalState() const;
  bool TabsHidden() const { return tabs_hidden_; }

  // Shortcuts the window offers after the page declined them: Cmd-S hides
  // the tabs (Save Page As is Shift-Cmd-S, patches/0012) and Cmd-K opens
  // Merlin's menu. Sites with their own Cmd-S or Cmd-K keep them.
  bool HandleUnhandledShortcut(const input::NativeWebKeyboardEvent& event);
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

  // The shell's command palette.
  void OnPaletteTextChanged(std::u16string_view text);
  void OnPaletteKey(ffi::PaletteKey key);
  void OnPaletteRowClicked(int index);

  // The window moved or changed size; its workspace keeps where it is.
  void OnWindowBoundsChanged();

  // TabStripModelObserver:
  void OnTabStripModelChanged(TabStripModel* tab_strip_model,
                              const TabStripModelChange& change,
                              const TabStripSelectionChange& selection) override;
  void OnTabChangedAt(tabs::TabInterface* tab,
                      TabChangeType change_type) override;
  // Changes a workspace keeps that move no tab: groups made, renamed,
  // recoloured or collapsed, pins and splits.
  void TabGroupedStateChanged(TabStripModel* tab_strip_model,
                              std::optional<tab_groups::TabGroupId> old_group,
                              std::optional<tab_groups::TabGroupId> new_group,
                              tabs::TabInterface* tab,
                              int index) override;
  void OnTabGroupChanged(const TabGroupChange& change) override;
  void OnTabPinnedStateChanged(tabs::TabInterface* tab, int index) override;
  void OnSplitTabChanged(const SplitTabChange& change) override;
  void WillCloseAllTabs(TabStripModel* tab_strip_model) override;

  // content::WebContentsObserver:
  void OnFocusChangedInPage(const content::FocusedNodeDetails& details) override;
  void PrimaryPageChanged(content::Page& page) override;
  void PrimaryMainFrameRenderProcessGone(
      base::TerminationStatus status) override;
  void DidGetUserInteraction(const blink::WebInputEvent& event) override;

  ffi::Mode mode_for_testing() const { return router_.mode(); }
  std::string workspace_for_testing() const { return router_.workspace(); }
  ExternalEditor* field_editor_for_testing() { return field_editor_.get(); }
  // Config `modal_browsing`; pages that show key labels hide them when off.
  bool modal_browsing() const { return router_.modal_browsing(); }
  bool browserctl_enabled_for_testing() const {
    return router_.browserctl_enabled();
  }
  // Called after page-side work (hint collection, activation) finishes.
  void set_page_work_done_callback_for_testing(base::RepeatingClosure cb) {
    page_work_done_for_testing_ = std::move(cb);
  }

 private:
  content::WebContents* ActiveContents();
  // Says so and returns true when the active tab is shown in WebKit, whose
  // page Chromium's page commands (hints, find, the outline, editing) can't
  // reach; they would act on Chromium's hidden page.
  bool RefuseInWebKit();
  PageFocus CurrentFocus();
  void ObserveActiveContents();
  void OnActiveTabChanged();
  // Tells the shell its window state changed.
  void NotifyShell();
  // Status line state, as the shell shows it.
  void SetStatusMessage(std::u16string text, bool is_error);
  void ClearStatusMessage();
  void ShowSiteInfo();
  // Another normal window kept under workspace `name`, front first.
  ModalBrowserController* WindowWithWorkspace(std::string_view name);
  // Detaches other windows from this window's workspace, so only this one
  // keeps saving it.
  void ReleaseWorkspaceInOtherWindows();
  // The window is closing its tabs on its way out.
  bool WindowClosing() const;
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
  void KeepEditedFileOnClose();
  void ScheduleAutosave();
  // What a workspace save of this window would record now.
  struct WorkspaceCapture {
    ::rust::Vec<ffi::WindowTab> tabs;
    ffi::WindowState window{0, 0, 0, 0, false};
  };
  WorkspaceCapture CaptureWorkspace();
  // Writes a pending autosave now, from the last capture taken before the
  // window began closing its tabs.
  void FlushAutosave();
  void ApplyConfigToBrowser();
  void FocusTabNumber(uint32_t number, std::string* error);
  void ReadSelection(base::OnceCallback<void(std::string)> reply);
  content::RenderFrameHost* FocusedFrame();

  SEQUENCE_CHECKER(sequence_checker_);

  const raw_ptr<BrowserWindowInterface> browser_;
  ModalInputRouter router_;
  // What the shell shows; see ShellModalState().
  struct Status {
    ffi::Mode mode = ffi::Mode::Normal;
    std::u16string indicator;
    std::u16string pending;
    std::u16string message;
    bool message_is_error = false;
    // Continuations of the pending keys, shown after a short pause.
    std::vector<std::pair<std::u16string, std::u16string>> which_key;
    bool show_which_key = false;
  };
  Status status_;
  base::OneShotTimer which_key_timer_;
  base::DictValue shell_palette_;
  base::ListValue shell_hints_;
  std::string shell_hint_prefix_;
  base::OneShotTimer sequence_timer_;
  base::CallbackListSubscription tab_layout_subscription_;
  // Tabs hidden entirely (Cmd-S, :hide-tabs, config hide_tabs).
  bool tabs_hidden_ = false;
  // The config's hide_tabs as last applied; it applies again only when it
  // changes.
  std::optional<bool> tabs_hidden_default_;
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
  // The window as the pending autosave will save it, taken at each change
  // while the window is open. Closing tabs one by one never updates it.
  std::optional<WorkspaceCapture> autosave_capture_;
  base::CancelableTaskTracker history_tracker_;
  // Registers this object on the window so From() can find it. Declared
  // after everything it may call into, so it unregisters first.
  ui::ScopedUnownedUserData<ModalBrowserController> scoped_unowned_user_data_;
  base::WeakPtrFactory<ModalBrowserController> weak_factory_{this};
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MODAL_BROWSER_CONTROLLER_H_
