// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MODAL_INPUT_ROUTER_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MODAL_INPUT_ROUTER_H_

#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "components/modal_browser/ffi/src/lib.rs.h"

// This file deliberately includes nothing from Chromium. It connects the Rust
// session (through the cxx bridge) to an abstract BrowserOps interface, so the
// same code runs in the browser and in the Cargo-built host harness
// (tools/host_harness), where it is compiled and tested without a Chromium
// checkout.

namespace modal_browser {

// Where keyboard focus is when an event arrives.
enum class PageFocus {
  kPage,
  // content::EditableLevel::kPlaintextEditable
  kPlainTextField,
  // content::EditableLevel::kRichlyEditable
  kRichTextField,
  kBrowserUi,
};

// A key-down event in host-neutral form.
struct KeyDown {
  // DOM KeyboardEvent.key value, e.g. "j", ":", "Escape", "ArrowDown".
  std::string_view dom_key;
  bool shift = false;
  bool ctrl = false;
  bool alt = false;
  // Command on macOS.
  bool meta = false;
  bool ime_composing = false;
};

// One tab, as the host reports it for the tab switcher and :buffer.
struct TabEntry {
  // Stable handle (tabs::TabHandle raw value), not the strip position.
  int32_t id = -1;
  std::string title;
  std::string url;
  bool active = false;
};

struct HintLabelView {
  // Index into the host's collected targets.
  uint32_t target = 0;
  std::string label;
};

// One which-key entry: keys still to type, and what they do.
struct KeyHintView {
  std::string keys;
  std::string desc;
};

// Where a split or other open request goes: nothing (the new-tab page), a
// URL, or search terms.
struct OpenRequest {
  ffi::TargetKind kind = ffi::TargetKind::None;
  std::string text;
};

// A workspace to open, as the core validated it.
struct WorkspaceRestore {
  std::string name;
  std::string project;
  struct Tab {
    std::string url;
    std::string title;
    bool pinned = false;
    // Index of the tab this one shares a split with, or -1.
    int split_with = -1;
    ffi::SplitLayout layout = ffi::SplitLayout::SideBySide;
  };
  std::vector<Tab> tabs;
  size_t active = 0;
  // Open in a new window rather than this (empty) one.
  bool new_window = true;
};

// Everything the modal layer can ask the browser to do. The Chromium
// implementation (ModalBrowserController) maps each method to an existing
// chrome:: or content:: API; the harness implements it in memory.
//
// Methods that start asynchronous work (CollectHints, ReadClipboard,
// ReadConfig) report back through the matching ModalInputRouter::On* call.
class BrowserOps {
 public:
  virtual ~BrowserOps() = default;

  // Navigation and tabs.
  virtual void OpenUrl(std::string_view url,
                       ffi::OpenDisposition disposition) = 0;
  virtual void OpenSearch(std::string_view terms,
                          ffi::OpenDisposition disposition) = 0;
  virtual void NewTab() = 0;
  virtual void CloseTab() = 0;
  virtual void RestoreTab() = 0;
  virtual void SelectNextTab(int count) = 0;
  virtual void SelectPreviousTab(int count) = 0;
  virtual void SelectFirstTab() = 0;
  virtual void SelectLastTab() = 0;
  // Ignores ids that no longer exist.
  virtual void ActivateTab(int32_t id) = 0;
  virtual std::vector<TabEntry> GetTabs() = 0;
  virtual void GoBack(int count) = 0;
  virtual void GoForward(int count) = 0;
  virtual void Reload(bool bypass_cache) = 0;
  virtual void NavigateUp(int count) = 0;
  virtual void NavigateRoot() = 0;

  // Page.
  virtual void Scroll(ffi::ScrollKind scroll,
                      int count,
                      int step_px,
                      bool smooth) = 0;
  virtual void FocusAddressBar() = 0;
  virtual void FindInPage() = 0;
  virtual void FindNext() = 0;
  virtual void FindPrevious() = 0;
  virtual void BlurFocusedElement() = 0;
  virtual void Yank(ffi::YankKind kind) = 0;
  // Then ModalInputRouter::OnClipboardText.
  virtual void ReadClipboard(ffi::OpenDisposition disposition) = 0;

  // Link hints. CollectHints then ModalInputRouter::OnHintsCollected.
  virtual void CollectHints(uint32_t generation, ffi::HintTargets targets) = 0;
  virtual void ShowHints(const std::vector<HintLabelView>& hints,
                         ffi::HintAction action) = 0;
  virtual void FilterHints(std::string_view typed) = 0;
  virtual void HideHints() = 0;
  virtual void ActivateHint(uint32_t target, ffi::HintAction action) = 0;

  // Palette: render the state the session holds.
  virtual void ShowPalette(const ffi::PaletteState& state) = 0;
  virtual void HidePalette() = 0;

  // Configuration. ReadConfig then ModalInputRouter::OnConfigRead.
  virtual void ReadConfig() = 0;

  // Browser shell. The default applies only where the user has not picked
  // a tab layout in the browser's own UI.
  virtual void SetVerticalTabsDefault(bool vertical) = 0;
  virtual void SetVerticalTabs(ffi::Switch value) = 0;
  virtual void SetTabSidebar(ffi::Switch value) = 0;
  // Hide the tabs entirely, or show them. The default (config `hide_tabs`)
  // applies when it changes, so a window toggled with Cmd-S keeps its state
  // across config reloads that leave it alone.
  virtual void SetTabsHiddenDefault(bool hidden) = 0;
  virtual void SetTabsHidden(ffi::Switch value) = 0;

  // Status.
  virtual void ShowMessage(ffi::MessageLevel level, std::string_view text) = 0;
  // Called after every event with the current mode and pending keys.
  virtual void UpdateStatus(ffi::Mode mode,
                            std::string_view indicator,
                            std::string_view pending,
                            const std::vector<KeyHintView>& which_key) = 0;

  // One-shot timer for ambiguous key sequences. Starting replaces any
  // running timer. When it fires the host calls
  // ModalInputRouter::OnSequenceTimeout.
  virtual void StartSequenceTimer(uint32_t delay_ms) = 0;
  virtual void StopSequenceTimer() = 0;

  // -- Phase 3: splits, windows, workspaces ---------------------------------

  virtual void Split(ffi::SplitLayout layout, const OpenRequest& target) = 0;
  virtual void FocusOtherSplit() = 0;
  virtual void SwapSplit() = 0;
  virtual void Unsplit() = 0;
  virtual void PinTab(ffi::Switch value) = 0;
  virtual void NewWindow(bool private_window) = 0;
  // Then ModalInputRouter::OnWorkspaceSnapshot with this window's tabs.
  virtual void SnapshotWorkspace(std::string_view name, bool quiet) = 0;
  // Write atomically; show `message` on success (unless empty).
  virtual void WriteWorkspace(std::string_view name,
                              std::string_view contents,
                              std::string_view message) = 0;
  // Then ModalInputRouter::OnWorkspaceRead.
  virtual void ReadWorkspace(std::string_view name) = 0;
  virtual void DeleteWorkspace(std::string_view name) = 0;
  virtual void RestoreWorkspace(const WorkspaceRestore& workspace) = 0;
  // Then ModalInputRouter::OnItems.
  virtual void RequestItems(ffi::ItemSource source) = 0;
  virtual void ShowBrowserPage(ffi::BrowserPage page) = 0;
  // A `:browser` action (print, zoom-in, download-open…); `arg` is the
  // download id for the download-* ones, else empty.
  virtual void RunBrowserCommand(std::string_view name,
                                 std::string_view arg) = 0;
  virtual void ToggleDevTools() = 0;
  virtual void AddBookmark() = 0;

  // -- Phase 4: page structure, selection, external editor ------------------

  // Then ModalInputRouter::OnDocumentCollected.
  virtual void CollectDocument(uint32_t generation) = 0;
  virtual void RevealElement(uint32_t element) = 0;
  virtual void JumpToBlock(ffi::BlockJump kind, bool forward, int count) = 0;
  virtual void CopyText(std::string_view text, std::string_view what) = 0;
  // A read-only temporary file; nothing is written back.
  virtual void OpenInEditor(std::string_view text,
                            std::string_view extension,
                            const std::vector<std::string>& argv) = 0;
  // Then ModalInputRouter::OnFieldInfo.
  virtual void InspectField(bool force) = 0;
  virtual void EditField(const std::vector<std::string>& argv) = 0;
  virtual void ExtendSelection(bool forward, ffi::SelectUnit unit, int count) = 0;
  virtual void ClearSelection() = 0;

  // -- Marks ------------------------------------------------------------------

  // Then ModalInputRouter::OnMarkRecorded with the page's URL and scroll.
  virtual void RecordMark(std::string_view letter) = 0;
  // Scroll to (x, y) if the active page is `url`; else open it when
  // `navigate`, or say the mark is on another page.
  virtual void GoToMark(std::string_view letter,
                        std::string_view url,
                        int64_t x,
                        int64_t y,
                        bool navigate) = 0;
};

// Owns the Rust session for one browser window and turns its outcomes into
// BrowserOps calls. Must be used on a single sequence (the UI thread).
class ModalInputRouter {
 public:
  ModalInputRouter();
  ModalInputRouter(const ModalInputRouter&) = delete;
  ModalInputRouter& operator=(const ModalInputRouter&) = delete;
  ~ModalInputRouter();

  // Returns true if the key was consumed and must not reach the page.
  bool OnKeyDown(const KeyDown& key, PageFocus focus, BrowserOps& ops);
  void OnFocusChanged(PageFocus focus, BrowserOps& ops);
  // The active tab's page changed (navigation or tab switch). `host` is the
  // page's host name, empty if none.
  void OnPageChanged(std::string_view host, BrowserOps& ops);
  void OnTabActivated(int32_t id);
  void OnSequenceTimeout(BrowserOps& ops);

  // From the palette's text field.
  void OnPaletteTextChanged(std::string_view text, BrowserOps& ops);
  void OnPaletteKey(ffi::PaletteKey key, BrowserOps& ops);
  // A palette row was clicked: select it, and in list palettes run it.
  void OnPaletteRowClicked(int index, BrowserOps& ops);
  // The user clicked or scrolled the page with the pointer.
  void OnPointerActivity(BrowserOps& ops);
  // Runs a command line as if typed after ':' (no palette needed). Returns
  // the error, empty on success.
  std::string OnCommandLineSubmitted(std::string_view text, BrowserOps& ops);
  // Tabs changed while the palette is open.
  void RefreshTabs(BrowserOps& ops);

  // Answers to asynchronous BrowserOps requests.
  void OnHintsCollected(uint32_t generation,
                        const std::vector<ffi::HintKind>& kinds,
                        BrowserOps& ops);
  void OnClipboardText(std::string_view text,
                       ffi::OpenDisposition disposition,
                       BrowserOps& ops);
  // `found` is false when there is no config file. `announce` shows a
  // message on success (reloads); errors are always shown.
  void OnConfigRead(bool found,
                    std::string_view text,
                    std::string_view path,
                    bool announce,
                    BrowserOps& ops);

  // Opens a URL or search from outside the command line (browserctl).
  // Returns the error, empty on success.
  std::string OnOpenText(std::string_view text,
                         ffi::OpenDisposition disposition,
                         std::string_view source,
                         BrowserOps& ops);
  void OnItems(ffi::ItemSource source,
               ::rust::Vec<ffi::ListItem> items,
               int64_t now,
               BrowserOps& ops);
  void OnDocumentCollected(uint32_t generation,
                           std::string_view title,
                           std::string_view url,
                           ::rust::Vec<ffi::PageBlock> blocks,
                           BrowserOps& ops);
  void OnFieldInfo(ffi::FieldInfo info, bool force, BrowserOps& ops);
  void OnWorkspaceSnapshot(std::string_view name,
                           bool quiet,
                           ::rust::Vec<ffi::WindowTab> tabs,
                           int64_t now,
                           BrowserOps& ops);
  void OnMarkRecorded(std::string_view letter,
                      std::string_view url,
                      int64_t x,
                      int64_t y,
                      BrowserOps& ops);
  // `found` is false when there is no such file.
  void OnWorkspaceRead(std::string_view name,
                       bool found,
                       std::string_view text,
                       BrowserOps& ops);

  // Window facts the core needs.
  void SetWindow(bool private_window);
  void SetEnvironment(std::string_view visual, std::string_view editor);
  void SetWorkspace(std::string_view name, std::string_view project = {});
  std::string workspace() const;
  // Empty when the window's workspace should not be saved automatically.
  std::string autosave_workspace() const;
  bool restore_session_default() const;
  bool browserctl_enabled() const;

  // Completion candidates as (text, summary) pairs.
  std::vector<std::pair<std::string, std::string>> Complete(
      std::string_view text) const;

  // Adds a key binding. Returns an empty string on success, otherwise a
  // user-readable error.
  std::string Bind(ffi::Mode mode,
                   std::string_view keys,
                   std::string_view command);

  ffi::Mode mode() const;
  bool vertical_tabs_default() const;
  bool hide_tabs_default() const;
  ffi::PaletteState palette_state() const;

  // Normal-mode bindings, most useful first, for Merlin Settings.
  struct Binding {
    std::string keys;
    std::string command;
    std::string description;
  };
  std::vector<Binding> key_bindings() const;
  std::string hint_chars() const;

 private:
  void Apply(const ffi::Outcome& outcome, BrowserOps& ops);
  void Perform(const ffi::Action& action, BrowserOps& ops);
  void PushTabs(BrowserOps& ops);

  ::rust::Box<ffi::Session> session_;
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MODAL_INPUT_ROUTER_H_
