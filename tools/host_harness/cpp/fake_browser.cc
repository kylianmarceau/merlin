#include "cpp/fake_browser.h"

#include <algorithm>

namespace modal_browser::harness {

namespace {
constexpr int kViewportHeight = 800;
constexpr int kDocumentHeight = 10000;
constexpr const char kNewTabUrl[] = "chrome://newtab/";
}  // namespace

FakeBrowser::FakeBrowser() {
  tabs.push_back(Tab{next_tab_id++, {"https://example.com/"}, 0, 0, "Example"});
}

void FakeBrowser::AddTab(std::string url, std::string title, bool background) {
  tabs.push_back(Tab{next_tab_id++, {std::move(url)}, 0, 0, std::move(title)});
  if (!background) {
    active_index = static_cast<int>(tabs.size()) - 1;
  }
}

void FakeBrowser::OpenUrl(std::string_view url,
                          ffi::OpenDisposition disposition) {
  std::string u(url);
  if (disposition == ffi::OpenDisposition::CurrentTab) {
    Tab& tab = active();
    tab.history.resize(tab.index + 1);
    tab.history.push_back(u);
    tab.index++;
    tab.scroll_y = 0;
    return;
  }
  tabs.insert(tabs.begin() + active_index + 1,
              Tab{next_tab_id++, {u}, 0, 0, u});
  if (disposition != ffi::OpenDisposition::NewBackgroundTab) {
    active_index++;
  }
}

void FakeBrowser::OpenSearch(std::string_view terms,
                             ffi::OpenDisposition disposition) {
  OpenUrl("search:" + std::string(terms), disposition);
}

void FakeBrowser::NewTab() {
  tabs.push_back(Tab{next_tab_id++, {kNewTabUrl}, 0, 0, "New Tab"});
  active_index = static_cast<int>(tabs.size()) - 1;
  address_bar_focused = true;  // like chrome::NewTab
}

void FakeBrowser::CloseTab() {
  closed.push_back(active());
  tabs.erase(tabs.begin() + active_index);
  if (tabs.empty()) {
    tabs.push_back(Tab{next_tab_id++, {kNewTabUrl}, 0, 0, "New Tab"});
  }
  active_index = std::min(active_index, static_cast<int>(tabs.size()) - 1);
}

void FakeBrowser::RestoreTab() {
  if (closed.empty()) {
    return;
  }
  tabs.insert(tabs.begin() + active_index + 1, closed.back());
  closed.pop_back();
  active_index++;
}

void FakeBrowser::SelectNextTab(int count) {
  const int n = static_cast<int>(tabs.size());
  active_index = (active_index + count) % n;
}

void FakeBrowser::SelectPreviousTab(int count) {
  const int n = static_cast<int>(tabs.size());
  active_index = ((active_index - count) % n + n) % n;
}

void FakeBrowser::SelectFirstTab() {
  active_index = 0;
}

void FakeBrowser::SelectLastTab() {
  active_index = static_cast<int>(tabs.size()) - 1;
}

void FakeBrowser::ActivateTab(int32_t id) {
  for (size_t i = 0; i < tabs.size(); ++i) {
    if (tabs[i].id == id) {
      active_index = static_cast<int>(i);
      return;
    }
  }
}

std::vector<TabEntry> FakeBrowser::GetTabs() {
  std::vector<TabEntry> out;
  for (size_t i = 0; i < tabs.size(); ++i) {
    out.push_back({tabs[i].id, tabs[i].title, tabs[i].url(),
                   static_cast<int>(i) == active_index});
  }
  return out;
}

void FakeBrowser::GoBack(int count) {
  active().index = std::max(0, active().index - count);
}

void FakeBrowser::GoForward(int count) {
  Tab& tab = active();
  tab.index = std::min(static_cast<int>(tab.history.size()) - 1,
                       tab.index + count);
}

void FakeBrowser::Reload(bool bypass_cache) {
  reload_count++;
  last_reload_bypassed_cache = bypass_cache;
}

void FakeBrowser::NavigateUp(int count) {
  std::string url = active().url();
  for (int i = 0; i < count; ++i) {
    if (!url.empty() && url.back() == '/') {
      url.pop_back();
    }
    const size_t slash = url.rfind('/');
    if (slash == std::string::npos || url.compare(0, slash, "https:/") == 0) {
      break;
    }
    url.resize(slash + 1);
  }
  OpenUrl(url, ffi::OpenDisposition::CurrentTab);
}

void FakeBrowser::NavigateRoot() {
  const std::string& url = active().url();
  const size_t scheme = url.find("://");
  const size_t path =
      url.find('/', scheme == std::string::npos ? 0 : scheme + 3);
  OpenUrl(url.substr(0, path) + "/", ffi::OpenDisposition::CurrentTab);
}

void FakeBrowser::Scroll(ffi::ScrollKind scroll,
                         int count,
                         int step_px,
                         bool smooth) {
  last_scroll_step = step_px;
  last_scroll_smooth = smooth;
  int& y = active().scroll_y;
  switch (scroll) {
    case ffi::ScrollKind::Down:
      y += step_px * count;
      break;
    case ffi::ScrollKind::Up:
      y -= step_px * count;
      break;
    case ffi::ScrollKind::HalfPageDown:
      y += kViewportHeight / 2 * count;
      break;
    case ffi::ScrollKind::HalfPageUp:
      y -= kViewportHeight / 2 * count;
      break;
    case ffi::ScrollKind::PageDown:
      y += kViewportHeight * count;
      break;
    case ffi::ScrollKind::PageUp:
      y -= kViewportHeight * count;
      break;
    case ffi::ScrollKind::Top:
      y = 0;
      break;
    case ffi::ScrollKind::Bottom:
      y = kDocumentHeight - kViewportHeight;
      break;
    default:
      break;  // horizontal scrolling is not modelled
  }
  y = std::clamp(y, 0, kDocumentHeight - kViewportHeight);
}

void FakeBrowser::FocusAddressBar() {
  address_bar_focused = true;
}

void FakeBrowser::FindInPage() {
  find_bar_open = true;
}

void FakeBrowser::FindNext() {
  find_steps++;
}

void FakeBrowser::FindPrevious() {
  find_steps--;
}

void FakeBrowser::BlurFocusedElement() {
  blur_count++;
}

void FakeBrowser::Yank(ffi::YankKind kind) {
  switch (kind) {
    case ffi::YankKind::Url:
      clipboard = active().url();
      break;
    case ffi::YankKind::Title:
      clipboard = active().title;
      break;
    case ffi::YankKind::Markdown:
      clipboard = "[" + active().title + "](" + active().url() + ")";
      break;
    case ffi::YankKind::Selection:
      clipboard = "selected text";
      break;
  }
}

void FakeBrowser::ReadClipboard(ffi::OpenDisposition disposition) {
  clipboard_reads++;
  clipboard_disposition = disposition;
}

void FakeBrowser::CollectHints(uint32_t generation,
                               ffi::HintTargets targets) {
  collect_requests++;
  collect_generation = generation;
  hint_targets = targets;
}

void FakeBrowser::ShowHints(const std::vector<HintLabelView>& hints,
                            ffi::HintAction action) {
  hints_visible = true;
  shown_hints = hints;
  hint_filter.clear();
}

void FakeBrowser::FilterHints(std::string_view typed) {
  hint_filter = std::string(typed);
}

void FakeBrowser::HideHints() {
  hints_visible = false;
  shown_hints.clear();
  hint_filter.clear();
}

void FakeBrowser::ActivateHint(uint32_t target, ffi::HintAction action) {
  activated_target = static_cast<int>(target);
  activated_action = action;
  if (target >= page_target_urls.size()) {
    return;
  }
  // What the real host does for links: open or copy the URL.
  const std::string& url = page_target_urls[target];
  switch (action) {
    case ffi::HintAction::Follow:
      OpenUrl(url, ffi::OpenDisposition::CurrentTab);
      break;
    case ffi::HintAction::OpenInNewTab:
      OpenUrl(url, ffi::OpenDisposition::NewBackgroundTab);
      break;
    case ffi::HintAction::YankLink:
      clipboard = url;
      break;
    default:
      break;
  }
}

void FakeBrowser::ShowPalette(const ffi::PaletteState& state) {
  palette_renders++;
  palette_visible = state.visible;
  palette_kind = state.kind;
  palette_text = std::string(state.text);
  palette_error = std::string(state.error);
  palette_selected = state.selected;
  palette_rows.clear();
  for (const ffi::PaletteRow& row : state.rows) {
    palette_rows.emplace_back(std::string(row.primary));
  }
}

void FakeBrowser::HidePalette() {
  palette_visible = false;
  palette_text.clear();
  palette_error.clear();
  palette_rows.clear();
  palette_selected = -1;
}

void FakeBrowser::ReadConfig() {
  config_reads++;
}

void FakeBrowser::SetVerticalTabsDefault(bool vertical) {
  vertical_tabs_default = vertical;
}

void FakeBrowser::SetVerticalTabs(ffi::Switch value) {
  const bool on = value == ffi::Switch::Toggle ? !vertical_tabs()
                                               : value == ffi::Switch::On;
  vertical_tabs_user = on ? 1 : 0;
}

void FakeBrowser::SetTabsHiddenDefault(bool hidden) {
  tabs_hidden = hidden;
}

void FakeBrowser::SetTabsHidden(ffi::Switch value) {
  tabs_hidden = value == ffi::Switch::Toggle ? !tabs_hidden
                                             : value == ffi::Switch::On;
}

void FakeBrowser::SetTabSidebar(ffi::Switch value) {
  if (!vertical_tabs()) {
    message = "error: tabs are not in a sidebar";
    return;
  }
  // On = expanded.
  sidebar_collapsed = value == ffi::Switch::Toggle ? !sidebar_collapsed
                                                   : value == ffi::Switch::Off;
}

void FakeBrowser::ShowMessage(ffi::MessageLevel level, std::string_view text) {
  message = (level == ffi::MessageLevel::Error ? "error: " : "") +
            std::string(text);
}

void FakeBrowser::UpdateStatus(ffi::Mode mode,
                               std::string_view indicator_text,
                               std::string_view pending_keys,
                               const std::vector<KeyHintView>& hints) {
  indicator = std::string(indicator_text);
  pending = std::string(pending_keys);
  which_key = hints;
}

void FakeBrowser::StartSequenceTimer(uint32_t delay_ms) {
  timer_ms = delay_ms;
}

void FakeBrowser::StopSequenceTimer() {
  timer_ms = 0;
}

int FakeBrowser::split_partner() const {
  const int group = tabs[active_index].split;
  if (group == 0) {
    return -1;
  }
  for (int i = 0; i < static_cast<int>(tabs.size()); ++i) {
    if (i != active_index && tabs[i].split == group) {
      return i;
    }
  }
  return -1;
}

void FakeBrowser::Split(ffi::SplitLayout layout, const OpenRequest& target) {
  if (active().split != 0) {
    message = "error: this tab is already split";
    return;
  }
  std::string url = kNewTabUrl;
  if (target.kind == ffi::TargetKind::Url) {
    url = target.text;
  } else if (target.kind == ffi::TargetKind::Search) {
    url = "search:" + target.text;
  }
  const int group = next_split++;
  active().split = group;
  active().layout = layout;
  Tab tab{next_tab_id++, {url}, 0, 0, url};
  tab.split = group;
  tab.layout = layout;
  tabs.insert(tabs.begin() + active_index + 1, tab);
  active_index++;
}

void FakeBrowser::FocusOtherSplit() {
  const int other = split_partner();
  if (other < 0) {
    message = "error: this tab is not split";
    return;
  }
  active_index = other;
}

void FakeBrowser::SwapSplit() {
  const int other = split_partner();
  if (other >= 0) {
    std::swap(tabs[active_index], tabs[other]);
    active_index = other;
  }
}

void FakeBrowser::Unsplit() {
  const int other = split_partner();
  if (other < 0) {
    message = "error: this tab is not split";
    return;
  }
  tabs[other].split = 0;
  active().split = 0;
}

void FakeBrowser::PinTab(ffi::Switch value) {
  active().pinned = value == ffi::Switch::Toggle ? !active().pinned
                                                 : value == ffi::Switch::On;
}

void FakeBrowser::NewWindow(bool private_window) {
  (private_window ? private_windows_opened : windows_opened)++;
}

void FakeBrowser::SnapshotWorkspace(std::string_view name, bool quiet) {
  snapshot_request = std::string(name);
  snapshot_quiet = quiet;
}

void FakeBrowser::WriteWorkspace(std::string_view name,
                                 std::string_view contents,
                                 std::string_view text) {
  workspace_files[std::string(name)] = std::string(contents);
  if (!text.empty()) {
    message = std::string(text);
  }
}

void FakeBrowser::ReadWorkspace(std::string_view name) {
  workspace_read_request = std::string(name);
}

void FakeBrowser::DeleteWorkspace(std::string_view name) {
  workspace_files.erase(std::string(name));
}

void FakeBrowser::RestoreWorkspace(const WorkspaceRestore& workspace) {
  restored = true;
  last_restore = workspace;
}

void FakeBrowser::RequestItems(ffi::ItemSource source) {
  items_requests++;
  items_source = source;
}

void FakeBrowser::ShowBrowserPage(ffi::BrowserPage page) {
  pages_shown++;
  last_page = page;
}

void FakeBrowser::RunBrowserCommand(std::string_view name,
                                    std::string_view arg) {
  browser_commands.push_back(std::string(name) + " " + std::string(arg));
}

void FakeBrowser::ToggleDevTools() {
  devtools_toggles++;
}

void FakeBrowser::AddBookmark() {
  bookmarks_added++;
}

void FakeBrowser::CollectDocument(uint32_t generation) {
  document_requests++;
  document_generation = generation;
}

void FakeBrowser::RevealElement(uint32_t element) {
  revealed_element = static_cast<int>(element);
}

void FakeBrowser::JumpToBlock(ffi::BlockJump kind, bool forward, int count) {
  const char* name = kind == ffi::BlockJump::Heading ? "heading"
                     : kind == ffi::BlockJump::Code  ? "code"
                     : kind == ffi::BlockJump::Table ? "table"
                                                     : "other";
  last_jump = std::string(name) + (forward ? "+" : "-") + std::to_string(count);
}

void FakeBrowser::CopyText(std::string_view text, std::string_view what) {
  clipboard = std::string(text);
  copied_what = std::string(what);
}

void FakeBrowser::OpenInEditor(std::string_view text,
                               std::string_view extension,
                               const std::vector<std::string>& argv) {
  editor_text = std::string(text);
  editor_argv = argv;
}

void FakeBrowser::InspectField(bool force) {
  field_inspections++;
  field_inspect_force = force;
}

void FakeBrowser::EditField(const std::vector<std::string>& argv) {
  editor_argv = argv;
}

void FakeBrowser::ExtendSelection(bool forward,
                                  ffi::SelectUnit unit,
                                  int count) {
  const char* name = unit == ffi::SelectUnit::Line   ? "line"
                     : unit == ffi::SelectUnit::Word ? "word"
                                                     : "other";
  selection_moves += std::string(forward ? "+" : "-") + name + "*" +
                     std::to_string(count) + " ";
}

void FakeBrowser::ClearSelection() {
  selection_clears++;
}

void FakeBrowser::RecordMark(std::string_view letter) {
  mark_request = std::string(letter);
}

void FakeBrowser::GoToMark(std::string_view letter,
                           std::string_view url,
                           int64_t x,
                           int64_t y,
                           bool navigate) {
  last_mark_jump = std::string(letter) + " " + std::string(url) + " " +
                   std::to_string(y) + (navigate ? " navigate" : "");
  if (url == active().url()) {
    active().scroll_y = static_cast<int>(y);
  }
}

}  // namespace modal_browser::harness
