#ifndef TOOLS_HOST_HARNESS_CPP_FAKE_BROWSER_H_
#define TOOLS_HOST_HARNESS_CPP_FAKE_BROWSER_H_

#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include "chrome/browser/ui/modal_browser/modal_input_router.h"

namespace modal_browser::harness {

// An in-memory browser window: tabs with history, a scroll offset, a page
// with hint targets, a clipboard, a config file, and the UI state the modal
// layer controls. It records the calls it receives so scenarios can assert
// on them. Asynchronous requests (hints, clipboard, config) are recorded and
// answered by the scenario, as the real host answers them later.
class FakeBrowser : public BrowserOps {
 public:
  struct Tab {
    int32_t id = 0;
    std::vector<std::string> history;
    int index = 0;
    int scroll_y = 0;
    std::string title;
    bool pinned = false;
    // Tabs with the same non-zero value share a split view.
    int split = 0;
    ffi::SplitLayout layout = ffi::SplitLayout::SideBySide;
    const std::string& url() const { return history[index]; }
  };

  FakeBrowser();

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

  Tab& active() { return tabs[active_index]; }
  int split_partner() const;
  void AddTab(std::string url, std::string title, bool background = true);

  std::vector<Tab> tabs;
  int active_index = 0;
  int32_t next_tab_id = 1;
  std::vector<Tab> closed;

  bool address_bar_focused = false;
  bool find_bar_open = false;
  int find_steps = 0;  // +1 per next, -1 per previous
  int blur_count = 0;
  int reload_count = 0;
  bool last_reload_bypassed_cache = false;
  int last_scroll_step = 0;
  bool last_scroll_smooth = false;

  // Palette as rendered.
  bool palette_visible = false;
  ffi::PaletteKind palette_kind = ffi::PaletteKind::CommandLine;
  std::string palette_text;
  std::string palette_error;
  std::vector<std::string> palette_rows;  // primary texts
  int palette_selected = -1;
  int palette_renders = 0;

  // Page targets for hints, and what happened to them.
  std::vector<ffi::HintKind> page_targets;
  std::vector<std::string> page_target_urls;
  int collect_requests = 0;
  uint32_t collect_generation = 0;
  bool hints_visible = false;
  std::vector<HintLabelView> shown_hints;
  std::string hint_filter;
  int activated_target = -1;
  ffi::HintAction activated_action = ffi::HintAction::Follow;

  // Clipboard.
  std::string clipboard;
  int clipboard_reads = 0;
  ffi::OpenDisposition clipboard_disposition = ffi::OpenDisposition::CurrentTab;

  // Config file.
  int config_reads = 0;

  // Shell: the default layout, the user's own choice (if any), collapse.
  bool vertical_tabs_default = false;
  bool tabs_hidden = false;
  int vertical_tabs_user = -1;  // -1 unset, 0 off, 1 on
  bool sidebar_collapsed = false;
  bool vertical_tabs() const {
    return vertical_tabs_user < 0 ? vertical_tabs_default
                                  : vertical_tabs_user == 1;
  }

  // Phase 3.
  int next_split = 1;
  int windows_opened = 0;
  int private_windows_opened = 0;
  std::string snapshot_request;  // name of the pending SnapshotWorkspace
  bool snapshot_quiet = false;
  std::map<std::string, std::string> workspace_files;
  std::string workspace_read_request;
  bool restored = false;
  WorkspaceRestore last_restore;
  int items_requests = 0;
  ffi::ItemSource items_source = ffi::ItemSource::History;
  int devtools_toggles = 0;
  std::vector<std::string> browser_commands;
  int bookmarks_added = 0;
  ffi::BrowserPage last_page = ffi::BrowserPage::Settings;
  int pages_shown = 0;
  ffi::HintTargets hint_targets = ffi::HintTargets::Clickable;

  // Phase 4.
  int document_requests = 0;
  uint32_t document_generation = 0;
  int revealed_element = -1;
  std::string last_jump;  // "heading+2"
  std::string copied_what;
  std::vector<std::string> editor_argv;
  std::string editor_text;
  int field_inspections = 0;
  bool field_inspect_force = false;
  std::string selection_moves;  // "+line*1 -word*2 "
  int selection_clears = 0;
  std::string mark_request;  // letter asked to record
  std::string last_mark_jump;  // "a url y navigate"

  std::string message;
  std::string indicator;
  std::string pending;
  std::vector<KeyHintView> which_key;
  uint32_t timer_ms = 0;  // 0 = not running
};

}  // namespace modal_browser::harness

#endif  // TOOLS_HOST_HARNESS_CPP_FAKE_BROWSER_H_
