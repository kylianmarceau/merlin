// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/modal_input_router.h"

#include <algorithm>

namespace modal_browser {

namespace {

std::string_view View(const ::rust::String& s) {
  return std::string_view(s.data(), s.size());
}

// rust::Str requires valid UTF-8. Callers pass DOM key names and
// UTF16ToUTF8 output, which always are.
::rust::Str ToStr(std::string_view s) {
  return ::rust::Str(s.data(), s.size());
}

ffi::FocusState ToFocusState(PageFocus focus, bool ime_composing) {
  ffi::FocusKind kind = ffi::FocusKind::Page;
  switch (focus) {
    case PageFocus::kPage:
      kind = ffi::FocusKind::Page;
      break;
    case PageFocus::kPlainTextField:
      kind = ffi::FocusKind::PlainTextField;
      break;
    case PageFocus::kRichTextField:
      kind = ffi::FocusKind::RichTextField;
      break;
    case PageFocus::kBrowserUi:
      kind = ffi::FocusKind::BrowserUi;
      break;
  }
  return ffi::FocusState{kind, ime_composing};
}

int ToCount(uint32_t count) {
  // The core clamps counts to 9999; clamp again so a bridge bug cannot turn
  // into a huge loop in the browser.
  return static_cast<int>(std::clamp<uint32_t>(count, 1u, 9999u));
}

// Hosts report at most this many hint targets (matches the core's cap).
constexpr size_t kMaxHintTargets = 2000;

std::vector<std::string> ToStrings(const ::rust::Vec<::rust::String>& in) {
  std::vector<std::string> out;
  out.reserve(in.size());
  for (const ::rust::String& s : in) {
    out.emplace_back(s.data(), s.size());
  }
  return out;
}

}  // namespace

ModalInputRouter::ModalInputRouter() : session_(ffi::new_session()) {}

ModalInputRouter::~ModalInputRouter() = default;

bool ModalInputRouter::OnKeyDown(const KeyDown& key,
                                 PageFocus focus,
                                 BrowserOps& ops) {
  ffi::Modifiers modifiers{key.shift, key.ctrl, key.alt, key.meta};
  ffi::Outcome outcome = session_->handle_key(
      ToStr(key.dom_key), modifiers, ToFocusState(focus, key.ime_composing));
  Apply(outcome, ops);
  return outcome.disposition == ffi::KeyDisposition::Consumed;
}

void ModalInputRouter::OnFocusChanged(PageFocus focus, BrowserOps& ops) {
  Apply(session_->on_focus_changed(ToFocusState(focus, false)), ops);
}

void ModalInputRouter::OnPageChanged(std::string_view host, BrowserOps& ops) {
  Apply(session_->on_page_changed(ToStr(host)), ops);
}

void ModalInputRouter::OnTabActivated(int32_t id) {
  session_->on_tab_activated(id);
}

void ModalInputRouter::OnSequenceTimeout(BrowserOps& ops) {
  Apply(session_->on_timeout(), ops);
}

void ModalInputRouter::OnPaletteTextChanged(std::string_view text,
                                            BrowserOps& ops) {
  Apply(session_->palette_input(ToStr(text)), ops);
}

void ModalInputRouter::OnPaletteKey(ffi::PaletteKey key, BrowserOps& ops) {
  // Commands such as :buffer need a fresh view of the tabs.
  if (key == ffi::PaletteKey::Accept) {
    PushTabs(ops);
  }
  Apply(session_->palette_key(key), ops);
}

void ModalInputRouter::OnPaletteRowClicked(int index, BrowserOps& ops) {
  if (index < 0) {
    return;
  }
  const bool list = session_->palette_state().kind != ffi::PaletteKind::CommandLine;
  Apply(session_->palette_select(static_cast<uint32_t>(index)), ops);
  if (list) {
    OnPaletteKey(ffi::PaletteKey::Accept, ops);
  }
}

void ModalInputRouter::OnPointerActivity(BrowserOps& ops) {
  if (session_->mode() == ffi::Mode::Hint) {
    Apply(session_->on_pointer_activity(), ops);
  }
}

std::string ModalInputRouter::OnCommandLineSubmitted(std::string_view text,
                                                     BrowserOps& ops) {
  PushTabs(ops);
  ffi::Outcome outcome = session_->submit_command_line(ToStr(text));
  Apply(outcome, ops);
  return std::string(View(outcome.error));
}

std::string ModalInputRouter::OnOpenText(std::string_view text,
                                         ffi::OpenDisposition disposition,
                                         std::string_view source,
                                         BrowserOps& ops) {
  ffi::Outcome outcome =
      session_->open_text_from(ToStr(text), disposition, ToStr(source));
  Apply(outcome, ops);
  return std::string(View(outcome.error));
}

void ModalInputRouter::OnItems(ffi::ItemSource source,
                               ::rust::Vec<ffi::ListItem> items,
                               int64_t now,
                               BrowserOps& ops) {
  Apply(session_->set_items(source, std::move(items), now), ops);
}

void ModalInputRouter::OnDocumentCollected(uint32_t generation,
                                           std::string_view title,
                                           std::string_view url,
                                           ::rust::Vec<ffi::PageBlock> blocks,
                                           BrowserOps& ops) {
  Apply(session_->document_collected(generation, ToStr(title), ToStr(url),
                                     std::move(blocks)),
        ops);
}

void ModalInputRouter::OnFieldInfo(ffi::FieldInfo info,
                                   bool force,
                                   BrowserOps& ops) {
  Apply(session_->field_info(std::move(info), force), ops);
}

void ModalInputRouter::OnWorkspaceSnapshot(std::string_view name,
                                           bool quiet,
                                           ::rust::Vec<ffi::WindowTab> tabs,
                                           int64_t now,
                                           BrowserOps& ops) {
  Apply(session_->save_workspace(ToStr(name), quiet, std::move(tabs), now),
        ops);
}

void ModalInputRouter::OnWorkspaceRead(std::string_view name,
                                       bool found,
                                       std::string_view text,
                                       BrowserOps& ops) {
  // Restoring may reuse this window; the core decides from its tabs.
  PushTabs(ops);
  Apply(session_->workspace_read(ToStr(name), found, ToStr(found ? text : "")),
        ops);
}

void ModalInputRouter::OnMarkRecorded(std::string_view letter,
                                      std::string_view url,
                                      int64_t x,
                                      int64_t y,
                                      BrowserOps& ops) {
  Apply(session_->mark_recorded(ToStr(letter), ToStr(url), x, y), ops);
}

void ModalInputRouter::SetWindow(bool private_window) {
  session_->set_window(private_window);
}

void ModalInputRouter::SetEnvironment(std::string_view visual,
                                      std::string_view editor) {
  session_->set_environment(ToStr(visual), ToStr(editor));
}

void ModalInputRouter::SetWorkspace(std::string_view name) {
  session_->set_workspace(ToStr(name));
}

std::string ModalInputRouter::workspace() const {
  return std::string(session_->workspace());
}

std::string ModalInputRouter::autosave_workspace() const {
  return std::string(session_->autosave_workspace());
}

bool ModalInputRouter::restore_session_default() const {
  return session_->restore_session_default();
}

bool ModalInputRouter::browserctl_enabled() const {
  return session_->browserctl_enabled();
}

void ModalInputRouter::RefreshTabs(BrowserOps& ops) {
  if (!session_->palette_state().visible) {
    return;
  }
  PushTabs(ops);
  ops.ShowPalette(session_->palette_state());
}

void ModalInputRouter::OnHintsCollected(uint32_t generation,
                                        const std::vector<ffi::HintKind>& kinds,
                                        BrowserOps& ops) {
  const size_t n = std::min(kinds.size(), kMaxHintTargets);
  Apply(session_->hints_collected(
            generation, ::rust::Slice<const ffi::HintKind>(kinds.data(), n)),
        ops);
}

void ModalInputRouter::OnClipboardText(std::string_view text,
                                       ffi::OpenDisposition disposition,
                                       BrowserOps& ops) {
  Apply(session_->open_text(ToStr(text), disposition), ops);
}

void ModalInputRouter::OnConfigRead(bool found,
                                    std::string_view text,
                                    std::string_view path,
                                    bool announce,
                                    BrowserOps& ops) {
  // A missing file means defaults; loading "" resets to them.
  ffi::ConfigResult result = session_->load_config(ToStr(found ? text : ""));
  if (!result.errors.empty()) {
    std::string message = "Config " + std::string(path) + ": " +
                          std::string(View(result.errors[0]));
    if (result.errors.size() > 1) {
      message += " (+" + std::to_string(result.errors.size() - 1) + " more)";
    }
    ops.ShowMessage(ffi::MessageLevel::Error, message);
  } else if (announce) {
    ops.ShowMessage(
        ffi::MessageLevel::Info,
        found ? "Config reloaded: " + std::to_string(result.bindings) +
                    " bindings from " + std::string(path)
              : "No config at " + std::string(path) + "; using defaults");
  }
  ops.SetVerticalTabsDefault(session_->vertical_tabs_default());
  ops.UpdateStatus(session_->mode(), View(session_->mode_indicator()), "", {});
}

std::vector<std::pair<std::string, std::string>> ModalInputRouter::Complete(
    std::string_view text) const {
  std::vector<std::pair<std::string, std::string>> out;
  for (const ffi::Completion& c : session_->complete(ToStr(text))) {
    out.emplace_back(std::string(View(c.text)), std::string(View(c.summary)));
  }
  return out;
}

std::string ModalInputRouter::Bind(ffi::Mode mode,
                                   std::string_view keys,
                                   std::string_view command) {
  return std::string(session_->bind(mode, ToStr(keys), ToStr(command)));
}

ffi::Mode ModalInputRouter::mode() const {
  return session_->mode();
}

bool ModalInputRouter::vertical_tabs_default() const {
  return session_->vertical_tabs_default();
}

std::vector<ModalInputRouter::Binding> ModalInputRouter::key_bindings() const {
  std::vector<Binding> out;
  for (const ffi::ListItem& item : session_->key_bindings()) {
    out.push_back({std::string(View(item.value)), std::string(View(item.detail)),
                   std::string(View(item.title))});
  }
  return out;
}

std::string ModalInputRouter::hint_chars() const {
  return std::string(session_->hint_chars());
}

ffi::PaletteState ModalInputRouter::palette_state() const {
  return session_->palette_state();
}

void ModalInputRouter::PushTabs(BrowserOps& ops) {
  ::rust::Vec<ffi::TabInfo> tabs;
  for (const TabEntry& t : ops.GetTabs()) {
    tabs.push_back(ffi::TabInfo{t.id, ::rust::String::lossy(t.title),
                                ::rust::String::lossy(t.url), t.active});
  }
  session_->set_tabs(std::move(tabs));
}

void ModalInputRouter::Apply(const ffi::Outcome& outcome, BrowserOps& ops) {
  for (const ffi::Action& action : outcome.actions) {
    Perform(action, ops);
  }
  if (outcome.timeout_ms > 0) {
    ops.StartSequenceTimer(outcome.timeout_ms);
  } else {
    ops.StopSequenceTimer();
  }
  std::vector<KeyHintView> which_key;
  for (const ffi::KeyHint& h : outcome.which_key) {
    which_key.push_back({std::string(View(h.keys)), std::string(View(h.desc))});
  }
  ::rust::String indicator = session_->mode_indicator();
  ops.UpdateStatus(outcome.mode, View(indicator), View(outcome.pending),
                   which_key);
}

void ModalInputRouter::Perform(const ffi::Action& action, BrowserOps& ops) {
  switch (action.kind) {
    case ffi::ActionKind::OpenUrl:
      ops.OpenUrl(View(action.text), action.disposition);
      return;
    case ffi::ActionKind::OpenSearch:
      ops.OpenSearch(View(action.text), action.disposition);
      return;
    case ffi::ActionKind::NewTab:
      ops.NewTab();
      return;
    case ffi::ActionKind::CloseTab:
      ops.CloseTab();
      return;
    case ffi::ActionKind::RestoreTab:
      ops.RestoreTab();
      return;
    case ffi::ActionKind::NextTab:
      ops.SelectNextTab(ToCount(action.count));
      return;
    case ffi::ActionKind::PreviousTab:
      ops.SelectPreviousTab(ToCount(action.count));
      return;
    case ffi::ActionKind::FirstTab:
      ops.SelectFirstTab();
      return;
    case ffi::ActionKind::LastTab:
      ops.SelectLastTab();
      return;
    case ffi::ActionKind::ActivateTab:
      ops.ActivateTab(action.id);
      return;
    case ffi::ActionKind::Back:
      ops.GoBack(ToCount(action.count));
      return;
    case ffi::ActionKind::Forward:
      ops.GoForward(ToCount(action.count));
      return;
    case ffi::ActionKind::Reload:
      ops.Reload(action.bypass_cache);
      return;
    case ffi::ActionKind::NavigateUp:
      ops.NavigateUp(ToCount(action.count));
      return;
    case ffi::ActionKind::NavigateRoot:
      ops.NavigateRoot();
      return;
    case ffi::ActionKind::Scroll:
      ops.Scroll(action.scroll, ToCount(action.count),
                 static_cast<int>(std::clamp<uint32_t>(action.step, 1, 2000)),
                 action.smooth);
      return;
    case ffi::ActionKind::FocusAddressBar:
      ops.FocusAddressBar();
      return;
    case ffi::ActionKind::FindInPage:
      ops.FindInPage();
      return;
    case ffi::ActionKind::FindNext:
      ops.FindNext();
      return;
    case ffi::ActionKind::FindPrevious:
      ops.FindPrevious();
      return;
    case ffi::ActionKind::Yank:
      ops.Yank(action.yank);
      return;
    case ffi::ActionKind::OpenClipboard:
      ops.ReadClipboard(action.disposition);
      return;
    case ffi::ActionKind::OpenPalette:
      PushTabs(ops);
      ops.ShowPalette(session_->palette_state());
      return;
    case ffi::ActionKind::UpdatePalette:
      ops.ShowPalette(session_->palette_state());
      return;
    case ffi::ActionKind::ClosePalette:
      ops.HidePalette();
      return;
    case ffi::ActionKind::BlurFocusedElement:
      ops.BlurFocusedElement();
      return;
    case ffi::ActionKind::CollectHints:
      ops.CollectHints(action.index, action.hint_targets);
      return;
    case ffi::ActionKind::ShowHints: {
      std::vector<HintLabelView> hints;
      hints.reserve(action.hints.size());
      for (const ffi::HintLabel& h : action.hints) {
        hints.push_back({h.target, std::string(View(h.label))});
      }
      ops.ShowHints(hints, action.hint_action);
      return;
    }
    case ffi::ActionKind::FilterHints:
      ops.FilterHints(View(action.text));
      return;
    case ffi::ActionKind::HideHints:
      ops.HideHints();
      return;
    case ffi::ActionKind::ActivateHint:
      ops.ActivateHint(action.index, action.hint_action);
      return;
    case ffi::ActionKind::ReloadConfig:
      ops.ReadConfig();
      return;
    case ffi::ActionKind::VerticalTabs:
      ops.SetVerticalTabs(action.setting);
      return;
    case ffi::ActionKind::TabSidebar:
      ops.SetTabSidebar(action.setting);
      return;
    case ffi::ActionKind::ShowMessage:
      ops.ShowMessage(action.level, View(action.text));
      return;
    case ffi::ActionKind::Split:
      ops.Split(action.layout,
                OpenRequest{action.target, std::string(View(action.text))});
      return;
    case ffi::ActionKind::SplitFocusOther:
      ops.FocusOtherSplit();
      return;
    case ffi::ActionKind::SplitSwap:
      ops.SwapSplit();
      return;
    case ffi::ActionKind::Unsplit:
      ops.Unsplit();
      return;
    case ffi::ActionKind::PinTab:
      ops.PinTab(action.setting);
      return;
    case ffi::ActionKind::NewWindow:
      ops.NewWindow(action.flag);
      return;
    case ffi::ActionKind::SnapshotWorkspace:
      ops.SnapshotWorkspace(View(action.name), action.flag);
      return;
    case ffi::ActionKind::WriteWorkspace:
      ops.WriteWorkspace(View(action.name), View(action.text),
                         View(action.detail));
      return;
    case ffi::ActionKind::ReadWorkspace:
      ops.ReadWorkspace(View(action.name));
      return;
    case ffi::ActionKind::DeleteWorkspace:
      ops.DeleteWorkspace(View(action.name));
      return;
    case ffi::ActionKind::RestoreWorkspace: {
      WorkspaceRestore restore;
      restore.name = std::string(View(action.name));
      restore.new_window = action.flag;
      for (const ffi::WorkspaceTab& t : action.workspace_tabs) {
        const int n = static_cast<int>(action.workspace_tabs.size());
        restore.tabs.push_back(
            {std::string(View(t.url)), std::string(View(t.title)), t.pinned,
             (t.split_with >= 0 && t.split_with < n) ? t.split_with : -1,
             t.layout});
      }
      restore.active = std::min<size_t>(
          action.index, restore.tabs.empty() ? 0 : restore.tabs.size() - 1);
      ops.RestoreWorkspace(restore);
      return;
    }
    case ffi::ActionKind::SwitchProfile:
      ops.SwitchProfile(View(action.name));
      return;
    case ffi::ActionKind::RequestItems:
      ops.RequestItems(action.source);
      return;
    case ffi::ActionKind::ShowBrowserPage:
      ops.ShowBrowserPage(action.page);
      return;
    case ffi::ActionKind::BrowserCommand:
      ops.RunBrowserCommand(View(action.name), View(action.text));
      return;
    case ffi::ActionKind::ToggleDevTools:
      ops.ToggleDevTools();
      return;
    case ffi::ActionKind::AddBookmark:
      ops.AddBookmark();
      return;
    case ffi::ActionKind::CollectDocument:
      ops.CollectDocument(action.index);
      return;
    case ffi::ActionKind::RevealElement:
      ops.RevealElement(action.index);
      return;
    case ffi::ActionKind::JumpToBlock:
      ops.JumpToBlock(action.jump, action.flag, ToCount(action.count));
      return;
    case ffi::ActionKind::CopyText:
      ops.CopyText(View(action.text), View(action.detail));
      return;
    case ffi::ActionKind::OpenInEditor:
      ops.OpenInEditor(View(action.text), View(action.detail),
                       ToStrings(action.argv));
      return;
    case ffi::ActionKind::InspectField:
      ops.InspectField(action.flag);
      return;
    case ffi::ActionKind::EditField:
      ops.EditField(ToStrings(action.argv));
      return;
    case ffi::ActionKind::ExtendSelection:
      ops.ExtendSelection(action.flag, action.unit, ToCount(action.count));
      return;
    case ffi::ActionKind::ClearSelection:
      ops.ClearSelection();
      return;
    case ffi::ActionKind::RecordMark:
      ops.RecordMark(View(action.name));
      return;
    case ffi::ActionKind::GoToMark:
      ops.GoToMark(View(action.name), View(action.text), action.x, action.y,
                   action.flag);
      return;
  }
  // Unknown kind from a newer Rust side: ignore rather than crash.
}

}  // namespace modal_browser
