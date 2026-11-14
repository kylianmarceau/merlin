// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_shell_api.h"

#import <AppKit/AppKit.h>
#include <algorithm>
#include <array>
#include <string_view>
#include <deque>
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "base/time/time.h"
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include "base/command_line.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/no_destructor.h"
#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/task/single_thread_task_runner.h"
#include "base/scoped_observation.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/uuid.h"
#include "base/values.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/autocomplete/autocomplete_classifier_factory.h"
#include "chrome/browser/ui/modal_browser/merlin_urls.h"
#include "components/omnibox/browser/autocomplete_classifier.h"
#include "components/omnibox/browser/autocomplete_match.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/pref_change_registrar.h"
#include "components/download/content/public/all_download_item_notifier.h"
#include "content/public/browser/browser_task_traits.h"
#include "ui/base/base_window.h"
#include "chrome/browser/ui/browser_tabstrip.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_manager.h"
#include "chrome/browser/ui/exclusive_access/fullscreen_controller.h"
#include "chrome/browser/ui/find_bar/find_bar.h"
#include "chrome/browser/ui/find_bar/find_bar_controller.h"
#include "components/find_in_page/find_tab_helper.h"
#include "components/find_in_page/find_types.h"
#include "ui/gfx/range/range.h"
#include "chrome/browser/ui/browser_window/public/browser_collection_observer.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/modal_browser/merlin_downloads.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_services.h"
#include "chrome/browser/ui/modal_browser/merlin_react_extension_popup.h"
#include "chrome/browser/ui/modal_browser/merlin_suggestions.h"
#include "chrome/browser/ui/modal_browser/merlin_tab_switcher.h"
#include "chrome/browser/ui/modal_browser/merlin_page_color.h"
#include "base/base64.h"
#include "base/hash/hash.h"
#include "content/public/browser/favicon_status.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/page_navigator.h"
#include "base/strings/stringprintf.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/gfx/color_analysis.h"
#include "ui/gfx/color_utils.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/gfx/image/image_skia_rep.h"
#include "chrome/browser/themes/theme_service.h"
#include "chrome/browser/themes/theme_service_factory.h"
#include "components/split_tabs/split_tab_id.h"
#include "components/split_tabs/split_tab_visual_data.h"
#include "components/tabs/public/split_tab_data.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "chrome/browser/ui/tabs/split_tab_metrics.h"
#include "ui/display/screen.h"
#include "ui/gfx/geometry/rect.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/download/public/common/download_item.h"
#include "components/tabs/public/tab_interface.h"
#include "components/url_formatter/url_fixer.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/visibility.h"
#include "content/public/browser/navigation_handle.h"
#include "base/timer/timer.h"

namespace {
using Dict = base::DictValue;
using List = base::ListValue;
std::string WindowId(BrowserWindowInterface* b) {
  return base::NumberToString(b->GetSessionID().id());
}
std::string TabId(tabs::TabInterface* tab) {
  return base::NumberToString(tab->GetHandle().raw_value());
}
char* Encode(Dict value) {
  auto json = base::WriteJson(value).value_or("{\"ok\":false,\"error\":\"Encoding failed\"}");
  return strdup(json.c_str());
}
char* Error(std::string error) { return Encode(Dict().Set("ok", false).Set("error", std::move(error))); }
char* Ok(base::Value value = base::Value()) { return Encode(Dict().Set("ok", true).Set("value", std::move(value))); }
bool Enabled() {
  return base::CommandLine::ForCurrentProcess()->HasSwitch("merlin-react-shell");
}
// Shell windows: browser windows and the pop-ups pages open.
bool ShellWindowType(BrowserWindowInterface* b) {
  return b->GetType() == BrowserWindowInterface::TYPE_NORMAL ||
         b->GetType() == BrowserWindowInterface::TYPE_POPUP;
}
// Tab IDs are numeric; this one names the window's open extension popup.
constexpr std::string_view kExtensionPopupView = "extension-popup";
// Changes whenever the page's icon does. Hashed: a data: icon URL can be long.
std::string FaviconKey(content::WebContents* contents) {
  auto* entry = contents->GetController().GetLastCommittedEntry();
  if (!entry || !entry->GetFavicon().valid || entry->GetFavicon().image.IsEmpty()) return {};
  const auto& url = entry->GetFavicon().url;
  return base::NumberToString(base::PersistentHash(
      url.is_valid() ? url.spec() : entry->GetURL().DeprecatedGetOriginAsURL().spec()));
}
// "#RRGGBB" for an opaque colour.
std::string HexColor(SkColor color) {
  return base::StringPrintf("#%02X%02X%02X", SkColorGetR(color), SkColorGetG(color), SkColorGetB(color));
}
// Near-white colours say nothing about a site and would vanish on the shell.
bool Washed(SkColor color) {
  return color_utils::GetRelativeLuminance(color) > 0.86f;
}
// The colour the joined tab and toolbar take: the page's theme-color, else
// the main colour of its icon. Icons are analysed once per icon key.
std::string SiteColor(content::WebContents* contents, std::map<std::string, std::string>& icon_colors) {
  if (const auto theme = contents->GetThemeColor(); theme && SkColorGetA(*theme) == SK_AlphaOPAQUE && !Washed(*theme)) {
    return HexColor(*theme);
  }
  const auto key = FaviconKey(contents);
  if (key.empty()) return {};
  if (const auto found = icon_colors.find(key); found != icon_colors.end()) return found->second;
  const gfx::ImageSkia image = contents->GetController().GetLastCommittedEntry()->GetFavicon().image.AsImageSkia();
  const gfx::ImageSkiaRep& rep = image.GetRepresentation(1.0f);
  std::string color;
  if (!rep.is_null() && !rep.GetBitmap().drawsNothing()) {
    const SkColor mean = color_utils::CalculateKMeanColorOfBitmap(rep.GetBitmap());
    if (!Washed(mean)) color = HexColor(SkColorSetA(mean, SK_AlphaOPAQUE));
  }
  if (icon_colors.size() > 256) icon_colors.clear();
  icon_colors[key] = color;
  return color;
}
// The icon as a 2x PNG data URL, so it stays sharp on Retina displays.
base::Value FaviconData(content::WebContents* contents) {
  const auto key = FaviconKey(contents);
  if (key.empty()) return base::Value();
  const gfx::ImageSkia image = contents->GetController().GetLastCommittedEntry()->GetFavicon().image.AsImageSkia();
  const gfx::ImageSkiaRep& rep = image.GetRepresentation(2.0f);
  if (rep.is_null()) return base::Value();
  const auto png = gfx::PNGCodec::EncodeBGRASkBitmap(rep.GetBitmap(), /*discard_transparency=*/false);
  if (!png) return base::Value();
  return base::Value(Dict().Set("key", key).Set("url", "data:image/png;base64," + base::Base64Encode(*png)));
}
// Query IDs come from the shell; they only match results to their query.
bool ValidToken(const std::string* token) {
  return token && !token->empty() && token->size() <= 64 &&
         std::all_of(token->begin(), token->end(), [](char c) {
           return base::IsAsciiAlphaNumeric(c) || c == '-' || c == '_';
         });
}
struct Listener { MerlinEventCallback callback; raw_ptr<void> context; };
class Registry;
Registry& GetRegistry();

struct ShellPrompt {
  Dict description;
  base::OnceCallback<void(modal_browser::ShellPromptReply)> reply;
  modal_browser::ShellPromptReply draft;
  base::TimeTicks shown;
};
class WindowState : public TabStripModelObserver, public content::WebContentsObserver,
                    public download::AllDownloadItemNotifier::Observer {
 public:
  explicit WindowState(BrowserWindowInterface* browser) : browser_(browser) {
    browser_->GetTabStripModel()->AddObserver(this);
    Observe(browser_->GetTabStripModel()->GetActiveWebContents());
    prefs_.Init(browser_->GetProfile()->GetPrefs());
    prefs_.Add("merlin.shell.appearance", base::BindRepeating(&WindowState::Changed, base::Unretained(this)));
    switcher = std::make_unique<modal_browser::TabSwitcher>(
        browser_, base::BindRepeating(&WindowState::Changed, base::Unretained(this)));
    content::GetUIThreadTaskRunner({})->PostTask(FROM_HERE, base::BindOnce(
        &WindowState::WatchDownloads, weak_factory_.GetWeakPtr()));
    // Headers change colour as pages script, scroll and switch theme.
    edge_timer_.Start(FROM_HERE, base::Milliseconds(1200),
        base::BindRepeating(&WindowState::SampleEdge, base::Unretained(this)));
  }
  ~WindowState() override {
    browser_->GetTabStripModel()->RemoveObserver(this);
    // Resolve abandoned requests asynchronously, outside collection teardown.
    for (auto& prompt : prompts) {
      if (prompt.reply) content::GetUIThreadTaskRunner({})->PostTask(
          FROM_HERE, base::BindOnce(std::move(prompt.reply), modal_browser::ShellPromptReply()));
    }
  }
  std::deque<ShellPrompt> prompts;
  // Ctrl-Tab's cards.
  std::unique_ptr<modal_browser::TabSwitcher> switcher;
  // Address-bar suggestions, created on first use.
  std::unique_ptr<modal_browser::MerlinSuggestions> suggestions;
  std::string suggest_query;
  void Suggest(const std::string& query, const std::string& text, bool prevent_inline);
  // Opens a suggestion; false when the results changed since `query`.
  bool OpenSuggestion(const std::string& query, size_t index, bool new_tab);
  Dict find = Dict().Set("visible", false).Set("text", "").Set("matches", 0).Set("ordinal", 0).Set("focus", 0);
  std::string find_focused_tab;
  void OnTabStripModelChanged(TabStripModel*, const TabStripModelChange&,
                              const TabStripSelectionChange&) override;
  void OnTabChangedAt(tabs::TabInterface*, TabChangeType) override { Changed(); }
  void DidStartLoading() override { Changed(); }
  void DidStopLoading() override { Changed(); SampleEdgeSoon(); }
  void DocumentOnLoadCompletedInPrimaryMainFrame() override { SampleEdgeSoon(); }
  void PrimaryPageChanged(content::Page&) override { Changed(); }
  void DidStartNavigation(content::NavigationHandle* navigation) override;
  void DidFinishNavigation(content::NavigationHandle* navigation) override;
  void DidFirstVisuallyNonEmptyPaint() override;
  bool ShowsStartPage(content::WebContents* contents) const;
  // The joined tab and toolbar take the site's colour.
  void DidChangeThemeColor() override { Changed(); }
  // The shell shows a crashed page's own view (no sad tab: BrowserView draws it).
  void PrimaryMainFrameRenderProcessGone(base::TerminationStatus) override { Changed(); }
  void OnDownloadCreated(content::DownloadManager*, download::DownloadItem*) override { Changed(); }
  void OnDownloadUpdated(content::DownloadManager*, download::DownloadItem*) override { Changed(); }
  void OnDownloadRemoved(content::DownloadManager*, download::DownloadItem*) override { Changed(); }
  void OnDownloadDestroyed(content::DownloadManager*, download::DownloadItem*) override { Changed(); }
  void WatchDownloads() {
    downloads_ = std::make_unique<download::AllDownloadItemNotifier>(browser_->GetProfile()->GetDownloadManager(), this);
    Changed();
  }
  void Changed();
  void SyncSplitVisibility();
  void Deliver();
  void OnSuggestions(const std::vector<modal_browser::MerlinSuggestions::Suggestion>& results);
  Dict Snapshot();
  BrowserWindowInterface* browser() { return browser_; }
  // The view that holds the active page when it is shown alone (no split);
  // a tab switch moves the new page into it without waiting for React.
  NSView* __weak page_container = nil;
 private:
  raw_ptr<BrowserWindowInterface> browser_;
  int revision_ = 0;
  bool delivery_pending_ = false;
  base::TimeTicks last_delivery_;
  void StopHoldingStartPage();
  // The active page's top edge colour (see PageEdgeColor): read now, and again
  // shortly after, once the page has styled itself.
  void SampleEdge();
  void SampleEdgeSoon();
  base::RepeatingTimer edge_timer_;
  base::OneShotTimer edge_soon_;
  // A navigation that started on the start page, and then the page it
  // committed to, which is drawing its first content: the shell keeps the
  // start page up meanwhile instead of an empty page.
  int64_t navigation_from_start_ = 0;
  base::WeakPtr<content::WebContents> painting_;
  base::OneShotTimer paint_timeout_;
  // Icon colours by icon key (see SiteColor).
  std::map<std::string, std::string> icon_colors_;
  PrefChangeRegistrar prefs_;
  std::unique_ptr<download::AllDownloadItemNotifier> downloads_;
  base::WeakPtrFactory<WindowState> weak_factory_{this};
};

class Registry : public BrowserCollectionObserver {
 public:
  Registry() : session(base::Uuid::GenerateRandomV4().AsLowercaseString()) {
    observation.Observe(GlobalBrowserCollection::GetInstance());
    GlobalBrowserCollection::GetInstance()->ForEach([this](BrowserWindowInterface* b) {
      OnBrowserCreated(b); return true;
    });
  }
  void OnBrowserCreated(BrowserWindowInterface* b) override {
    if (ShellWindowType(b))
      windows.try_emplace(WindowId(b), std::make_unique<WindowState>(b));
  }
  void OnBrowserClosed(BrowserWindowInterface* b) override { windows.erase(WindowId(b)); }
  void Emit(Dict event) {
    const auto json = base::WriteJson(event);
    if (!json) return;
    // Callbacks can unsubscribe while delivering an event.
    const auto copy = listeners;
    for (const auto& [id, listener] : copy)
      if (listeners.contains(id)) listener.callback(json->c_str(), listener.context);
  }
  std::map<std::string, std::unique_ptr<WindowState>> windows;
  std::map<uint64_t, Listener> listeners;
  uint64_t next_listener = 0;
  const std::string session;
  base::ScopedObservation<GlobalBrowserCollection, BrowserCollectionObserver> observation{this};
};
Registry& GetRegistry() { static base::NoDestructor<Registry> registry; return *registry; }
void WindowState::Changed() {
  ++revision_;
  // Never call into JS while TabStripModel is in a mutation/notification.
  // Coalesce download progress and cancel pending delivery when the window closes.
  // At most one snapshot a frame: a page load, a busy download or a test
  // harness can change a window many times a frame, and each snapshot is
  // serialized, parsed and rendered by React.
  if (delivery_pending_) return;
  delivery_pending_ = true;
  constexpr base::TimeDelta kFrame = base::Milliseconds(16);
  const base::TimeDelta wait = kFrame - (base::TimeTicks::Now() - last_delivery_);
  content::GetUIThreadTaskRunner({})->PostDelayedTask(FROM_HERE,
      base::BindOnce(&WindowState::Deliver, weak_factory_.GetWeakPtr()),
      wait.is_positive() ? wait : base::TimeDelta());
}
void WindowState::Deliver() {
  delivery_pending_ = false;
  last_delivery_ = base::TimeTicks::Now();
  GetRegistry().Emit(Dict().Set("type", "snapshot").Set("snapshot", Snapshot()));
}
bool CommittedStartPage(content::WebContents* contents) {
  auto* entry = contents->GetController().GetLastCommittedEntry();
  return entry && !entry->IsInitialEntry() && modal_browser::IsShellStartUrl(entry->GetURL());
}
bool WindowState::ShowsStartPage(content::WebContents* contents) const {
  if (modal_browser::IsShellStartUrl(contents->GetVisibleURL())) return true;
  // Typed on the start page: until it commits, and then until it has drawn.
  if (contents == web_contents() && navigation_from_start_ && CommittedStartPage(contents)) return true;
  return painting_ && painting_.get() == contents;
}
void WindowState::DidStartNavigation(content::NavigationHandle* navigation) {
  if (!navigation->IsInPrimaryMainFrame() || navigation->IsSameDocument()) return;
  navigation_from_start_ = CommittedStartPage(web_contents()) ? navigation->GetNavigationId() : 0;
}
void WindowState::SampleEdge() {
  modal_browser::PageEdgeColor::Sample(web_contents(),
      base::BindRepeating(&WindowState::Changed, weak_factory_.GetWeakPtr()));
}
void WindowState::SampleEdgeSoon() {
  SampleEdge();
  edge_soon_.Start(FROM_HERE, base::Milliseconds(250),
      base::BindOnce(&WindowState::SampleEdge, base::Unretained(this)));
}
void WindowState::DidFinishNavigation(content::NavigationHandle* navigation) {
  if (navigation->IsInPrimaryMainFrame() && !navigation->IsSameDocument() && navigation->HasCommitted())
    modal_browser::PageEdgeColor::PageChanged(web_contents());
  if (!navigation->IsInPrimaryMainFrame() || navigation->IsSameDocument() ||
      navigation->GetNavigationId() != navigation_from_start_)
    return;
  navigation_from_start_ = 0;
  if (navigation->HasCommitted() && !modal_browser::IsShellStartUrl(navigation->GetURL())) {
    painting_ = web_contents()->GetWeakPtr();
    // A page that never draws anything still replaces the start page.
    paint_timeout_.Start(FROM_HERE, base::Seconds(3),
        base::BindOnce(&WindowState::StopHoldingStartPage, base::Unretained(this)));
  }
  Changed();
}
void WindowState::DidFirstVisuallyNonEmptyPaint() {
  SampleEdgeSoon();
  if (painting_ && painting_.get() == web_contents()) StopHoldingStartPage();
}
void WindowState::StopHoldingStartPage() {
  paint_timeout_.Stop();
  if (!painting_) return;
  painting_.reset();
  Changed();
}
void WindowState::OnTabStripModelChanged(TabStripModel*, const TabStripModelChange&,
                                        const TabStripSelectionChange&) {
  Observe(browser_->GetTabStripModel()->GetActiveWebContents());
  // The hold belongs to the tab it started in.
  if (painting_ && painting_.get() != web_contents()) StopHoldingStartPage();
  if (!web_contents()) navigation_from_start_ = 0;
  if (switcher) switcher->TabsChanged();
  SyncSplitVisibility();
  SampleEdgeSoon();
  Changed();
}
// Both halves of a split are on screen. The window only hears about the
// active tab changing, and `:vsplit` makes the split after its new tab is
// active, so the page it was split from was left hidden (and stayed blank).
// `:only` hides the side that leaves the screen. Occluded pages are left to
// Chromium's occlusion tracking.
void WindowState::SyncSplitVisibility() {
  auto* strip = browser_->GetTabStripModel();
  const int active = strip->active_index();
  auto* window = browser_->GetWindow();
  // A minimized or hidden window shows nothing.
  if (active < 0 || !window || !window->IsVisible() || window->IsMinimized()) return;
  const auto split = strip->GetSplitForTab(active);
  for (int i = 0; i < strip->count(); ++i) {
    auto* contents = strip->GetWebContentsAt(i);
    const bool shown = i == active || (split && strip->GetSplitForTab(i) == split);
    const auto visibility = contents->GetVisibility();
    if (shown && visibility == content::Visibility::HIDDEN) contents->WasShown();
    else if (!shown && visibility == content::Visibility::VISIBLE) contents->WasHidden();
  }
}
Dict WindowState::Snapshot() {
  auto* strip = browser_->GetTabStripModel();
  List tabs;
  for (int i = 0; i < strip->count(); ++i) {
    auto* tab = strip->GetTabAtIndex(i);
    auto* contents = tab->GetContents();
    Dict entry = Dict().Set("id", TabId(tab))
      .Set("title", base::UTF16ToUTF8(contents->GetTitle()))
      .Set("url", contents->GetVisibleURL().spec()).Set("loading", contents->IsLoading()).Set("crashed", contents->IsCrashed())
      .Set("pinned", strip->IsTabPinned(i)).Set("audible", contents->IsCurrentlyAudible())
      .Set("canGoBack", contents->GetController().CanGoBack())
      .Set("canGoForward", contents->GetController().CanGoForward())
      .Set("favicon", FaviconKey(contents)).Set("start", ShowsStartPage(contents));
    if (auto color = SiteColor(contents, icon_colors_); !color.empty()) entry.Set("color", std::move(color));
    if (const auto edge = modal_browser::PageEdgeColor::Get(contents)) entry.Set("surface", HexColor(*edge));
    tabs.Append(std::move(entry));
  }
  // Running downloads and the most recent others; the Library asks for all
  // of them with "downloads.list". The history can hold thousands.
  List downloads = modal_browser::MerlinDownloadsList(browser_->GetProfile(), 10);
  Dict appearance = browser_->GetProfile()->GetPrefs()->GetDict("merlin.shell.appearance").Clone();
  if (!appearance.FindString("mode")) appearance.Set("mode", "system");
  if (!appearance.FindString("accent")) appearance.Set("accent", "fern");  // Sage, the default workspace colour.
  if (!appearance.FindBool("reduceMotion")) appearance.Set("reduceMotion", false);
  base::Value split;
  if (const int active = strip->active_index(); active >= 0) {
    if (const auto id = strip->GetSplitForTab(active)) {
      List members;
      for (auto* member : strip->GetSplitData(*id)->ListTabs()) members.Append(TabId(member));
      const auto* visual = strip->GetSplitData(*id)->visual_data();
      split = base::Value(Dict().Set("tabs", std::move(members))
          .Set("layout", visual->split_layout() == split_tabs::SplitTabLayout::kStacked ? "stacked" : "sideBySide")
          .Set("ratio", visual->split_ratio()));
    }
  }
  auto* controller = modal_browser::ModalBrowserController::From(browser_);
  return Dict().Set("session", GetRegistry().session).Set("windowId", WindowId(browser_))
    .Set("revision", revision_).Set("private", browser_->GetProfile()->IsOffTheRecord())
    .Set("kind", browser_->GetType() == BrowserWindowInterface::TYPE_POPUP ? "popup" : "normal")
    .Set("extensionPopup", modal_browser::ShellExtensionPopupState(browser_))
    .Set("tabs", std::move(tabs))
    .Set("activeTabId", strip->active_index() >= 0 ? base::Value(TabId(strip->GetTabAtIndex(strip->active_index()))) : base::Value())
    .Set("downloads", std::move(downloads)).Set("prompt", prompts.empty() ? base::Value() : base::Value(prompts.front().description.Clone()))
    .Set("appearance", std::move(appearance)).Set("find", find.Clone()).Set("split", std::move(split))
    .Set("switcher", switcher ? switcher->State() : base::Value())
    // A page in fullscreen (HTML video, a PDF, a game) fills the window
    // alone, as in Chrome; browser fullscreen (Control-Command-F) keeps the
    // tabs and toolbar.
    .Set("fullscreen", ExclusiveAccessManager::From(browser_)->fullscreen_controller()->IsWindowFullscreenForTabOrPending())
    .Set("modal", controller ? controller->ShellModalState() : Dict().Set("mode", "Normal").Set("pending", "").Set("message", ""));
}
void WindowState::Suggest(const std::string& query, const std::string& text, bool prevent_inline) {
  if (!suggestions) {
    // Owned here, so the callback never outlives this window.
    suggestions = std::make_unique<modal_browser::MerlinSuggestions>(browser_->GetProfile(),
        base::BindRepeating(&WindowState::OnSuggestions, base::Unretained(this)));
  }
  suggestions->SetTarget(browser_->GetTabStripModel()->GetActiveWebContents());
  suggest_query = query;
  suggestions->Query(base::UTF8ToUTF16(text), prevent_inline);
}
void WindowState::OnSuggestions(const std::vector<modal_browser::MerlinSuggestions::Suggestion>& results) {
  using Kind = modal_browser::MerlinSuggestions::Kind;
  List items;
  for (const auto& s : results) {
    items.Append(Dict().Set("kind", s.kind == Kind::kSearch ? "search" : s.kind == Kind::kTab ? "tab" : "url")
        .Set("title", base::UTF16ToUTF8(s.title)).Set("detail", base::UTF16ToUTF8(s.detail))
        .Set("url", s.destination.spec()).Set("completion", base::UTF16ToUTF8(s.inline_completion))
        .Set("default", s.is_default));
  }
  // Results can arrive inside Query(); never re-enter the shell during its call.
  content::GetUIThreadTaskRunner({})->PostTask(FROM_HERE, base::BindOnce(
      [](Dict event) { GetRegistry().Emit(std::move(event)); },
      Dict().Set("type", "omnibox.results").Set("windowId", WindowId(browser_))
          .Set("queryId", suggest_query).Set("items", std::move(items))));
}
bool WindowState::OpenSuggestion(const std::string& query, size_t index, bool new_tab) {
  if (!suggestions || query != suggest_query || index >= suggestions->results().size()) return false;
  auto choice = suggestions->results()[index];
  if (!modal_browser::MerlinSuggestions::IsOpenable(choice.destination)) return false;
  suggestions->Opened(choice.destination);
  suggestions->Stop();
  auto* contents = browser_->GetTabStripModel()->GetActiveWebContents();
  const auto disposition = choice.kind == modal_browser::MerlinSuggestions::Kind::kTab
      ? WindowOpenDisposition::SWITCH_TO_TAB
      : new_tab || !contents ? WindowOpenDisposition::NEW_FOREGROUND_TAB : WindowOpenDisposition::CURRENT_TAB;
  content::OpenURLParams params(choice.destination, content::Referrer(), disposition, choice.transition,
                                /*is_renderer_initiated=*/false);
  // Opening can switch or close tabs; nothing touches `choice` afterwards.
  if (contents) contents->OpenURL(params, /*navigation_handle_callback=*/{});
  else chrome::AddTabAt(browser_, choice.destination, -1, true);
  return true;
}
WindowState* FindWindow(const char* id) {
  auto& windows = GetRegistry().windows;
  auto it = windows.find(id ? id : "");
  return it == windows.end() ? nullptr : it->second.get();
}
int FindTab(TabStripModel* strip, const std::string* id) {
  if (id) for (int i = 0; i < strip->count(); ++i)
    if (TabId(strip->GetTabAtIndex(i)) == *id) return i;
  return -1;
}
GURL ResolveAddress(Profile* profile, const std::string& text) {
  if (text.empty()) return GURL();
  if (auto internal = modal_browser::MerlinInternalUrl(base::UTF8ToUTF16(text)); internal.is_valid()) return internal;
  AutocompleteMatch match;
  AutocompleteClassifierFactory::GetForProfile(profile)->Classify(
      base::UTF8ToUTF16(text), false, false, metrics::OmniboxEventProto::OTHER, &match, nullptr);
  const auto& url = match.destination_url;
  // Address input must not execute script or invoke arbitrary external handlers.
  return url.SchemeIsHTTPOrHTTPS() || url.SchemeIs("chrome") || url == GURL("about:blank") ? url : GURL();
}
char* Call(const char* window, const char* method, const char* json) {
  if (!content::BrowserThread::CurrentlyOn(content::BrowserThread::UI)) return Error("Engine call requires the browser UI thread");
  if (!Enabled()) return Error("React shell host is not enabled");
  if (!method || !json || strlen(json) > 64 * 1024) return Error("Invalid engine request");
  const auto args = base::JSONReader::ReadDict(json, base::JSON_PARSE_RFC);
  if (!args) return Error("Expected an argument object");
  const std::string name(method);
  if (name == "application.windows") {
    List ids;
    for (const auto& [id, _] : GetRegistry().windows) ids.Append(id);
    return Ok(base::Value(std::move(ids)));
  }
  auto* state = FindWindow(window);
  if (!state) return Error("Browser window has closed");
  auto* browser = state->browser();
  auto* strip = browser->GetTabStripModel();
  if (name == "window.snapshot") return Ok(base::Value(state->Snapshot()));
  if (const auto* request = args->FindString("requestId")) {
    // Requests answer with a "reply" event after this call returns, so a
    // synchronous answer never re-enters the shell during its own call.
    if (request->empty() || request->size() > 64 ||
        !std::all_of(request->begin(), request->end(), [](char c) {
          return base::IsAsciiAlphaNumeric(c) || c == '-' || c == '_';
        }))
      return Error("Invalid request ID");
    auto reply = base::BindOnce([](std::string window_id, std::string request_id,
                                   modal_browser::ShellServiceResult result) {
      Dict event = Dict().Set("type", "reply").Set("windowId", window_id)
          .Set("requestId", request_id).Set("ok", result.error.empty());
      if (result.error.empty()) event.Set("value", std::move(result.value));
      else event.Set("error", result.error);
      content::GetUIThreadTaskRunner({})->PostTask(FROM_HERE, base::BindOnce(
          [](Dict event) { GetRegistry().Emit(std::move(event)); }, std::move(event)));
    }, WindowId(browser), *request);
    if (!modal_browser::RunShellService(browser, name, *args, std::move(reply)))
      return Error("Unsupported engine request");
    return Ok();
  }
  if (name == "tabs.thumbnail") {
    const int at = FindTab(strip, args->FindString("tabId"));
    if (at < 0) return Error("Tab has closed or belongs to another window");
    return Ok(modal_browser::TabSwitcher::Thumbnail(strip->GetTabAtIndex(at)));
  }
  if (name == "switcher.choose") {
    const auto index = args->FindInt("index");
    if (!index) return Error("Invalid tab choice");
    state->switcher->CommitIndex(*index);
    return Ok();
  }
  if (name == "switcher.cancel") {
    state->switcher->Cancel();
    return Ok();
  }
  if (name == "favicons.get") {
    const int at = FindTab(strip, args->FindString("tabId"));
    if (at < 0) return Error("Tab has closed or belongs to another window");
    return Ok(FaviconData(strip->GetWebContentsAt(at)));
  }
  if (name == "omnibox.query") {
    const auto* query = args->FindString("queryId");
    const auto* text = args->FindString("text");
    const auto prevent = args->FindBool("preventInline");
    if (!ValidToken(query) || !text || text->size() > 4096 || !prevent) return Error("Invalid suggestion request");
    state->Suggest(*query, *text, *prevent);
    return Ok();
  }
  if (name == "omnibox.stop") {
    if (state->suggestions) state->suggestions->Stop();
    return Ok();
  }
  if (name == "omnibox.open") {
    const auto* query = args->FindString("queryId");
    const auto index = args->FindInt("index");
    const auto new_tab = args->FindBool("newTab");
    if (!ValidToken(query) || !index || *index < 0 || !new_tab) return Error("Invalid suggestion");
    return state->OpenSuggestion(*query, static_cast<size_t>(*index), *new_tab) ? Ok()
        : Error("The suggestions changed; choose one again");
  }
  if (name == "omnibox.enter") {
    // Enter opens the top suggestion when the field still shows it, as in
    // Chromium's address bar, so a page readied for it is used.
    const auto* query = args->FindString("queryId");
    const auto* text = args->FindString("text");
    const auto new_tab = args->FindBool("newTab");
    if (!text || text->size() > 4096 || !new_tab) return Error("Invalid address");
    if (state->suggestions && ValidToken(query) && *query == state->suggest_query) {
      const auto& results = state->suggestions->results();
      if (const auto* top = state->suggestions->DefaultFor(base::UTF8ToUTF16(*text)); top && !results.empty() &&
          top == &results.front() && top->kind != modal_browser::MerlinSuggestions::Kind::kTab &&
          state->OpenSuggestion(*query, 0, *new_tab))
        return Ok();
    }
    const GURL url = ResolveAddress(browser->GetProfile(), *text);
    if (!url.is_valid()) return Error("This address cannot be opened");
    if (state->suggestions) state->suggestions->Stop();
    auto* contents = strip->GetActiveWebContents();
    if (*new_tab || !contents) chrome::AddTabAt(browser, url, -1, true);
    else contents->GetController().LoadURL(url, content::Referrer(), ui::PAGE_TRANSITION_TYPED, std::string());
    return Ok();
  }
  if (name == "site.info") {
    // The active page's security and blocking, as a popover by the address.
    modal_browser::ShowShellSiteInfo(browser);
    return Ok();
  }
  if (name == "extensions.closePopup") {
    modal_browser::CloseShellExtensionPopup(browser);
    return Ok();
  }
  if (name == "find.close") {
    FindBarController::From(browser)->EndFindSession(find_in_page::SelectionAction::kKeep, find_in_page::ResultAction::kKeep);
    return Ok();
  }
  if (name == "tabs.create") {
    const auto* url = args->FindString("url");
    GURL destination("about:blank");
    if (url && !url->empty()) destination = ResolveAddress(browser->GetProfile(), *url);
    if (!destination.is_valid()) return Error("This address cannot be opened");
    chrome::AddTabAt(browser, destination, -1, true);
    return Ok();
  }
  if (name == "page.focus") {
    // Keys go back to the page after a panel, popover or the address field.
    if (auto* contents = strip->GetActiveWebContents(); contents && !contents->IsCrashed()) contents->Focus();
    return Ok();
  }
  if (name == "modal.command") {
    const auto* text = args->FindString("text");
    auto* c = modal_browser::ModalBrowserController::From(browser);
    if (!text || !c) return Error("Invalid modal command");
    const auto error = c->RunCommandLine(*text);
    return error.empty() ? Ok() : Error(error);
  }
  if (name.starts_with("modal.palette.")) {
    auto* controller = modal_browser::ModalBrowserController::From(browser);
    if (!controller) return Error("Command service unavailable");
    const auto modal = controller->ShellModalState();
    const auto* palette = modal.FindDict("palette");
    if (!palette || !palette->FindBool("visible").value_or(false)) return Error("The command menu has closed");
    if (name == "modal.palette.text") {
      const auto* text = args->FindString("text");
      if (!text) return Error("Missing command menu text");
      controller->OnPaletteTextChanged(base::UTF8ToUTF16(*text));
    } else if (name == "modal.palette.select") {
      const auto index = args->FindInt("index");
      const auto revision = args->FindInt("revision");
      const auto* rows = palette->FindList("rows");
      if (!index || *index < 0 || !rows || static_cast<size_t>(*index) >= rows->size() ||
          !revision || state->Snapshot().FindInt("revision") != revision)
        return Error("The command results changed; choose the item again");
      controller->OnPaletteRowClicked(*index);
    } else if (name == "modal.palette.key") {
      const auto* key = args->FindString("key");
      if (!key) return Error("Missing command menu key");
      using Key = modal_browser::ffi::PaletteKey;
      if (*key == "accept") controller->OnPaletteKey(Key::Accept);
      else if (*key == "cancel") controller->OnPaletteKey(Key::Cancel);
      else if (*key == "next") controller->OnPaletteKey(Key::Next);
      else if (*key == "previous") controller->OnPaletteKey(Key::Previous);
      else return Error("Invalid command menu key");
    } else return Error("Unknown command menu action");
    return Ok();
  }
  if (name == "downloads.openFolder") {
    modal_browser::OpenMerlinDownloadsFolder(browser->GetProfile());
    return Ok();
  }
  if (name == "downloads.open" || name == "downloads.cancel" || name == "downloads.act") {
    uint32_t id;
    const auto* value = args->FindString("downloadId");
    if (!value || !base::StringToUint(*value, &id)) return Error("Invalid download ID");
    std::string action = name == "downloads.open" ? "open" : "cancel";
    if (name == "downloads.act") {
      const auto* requested = args->FindString("action");
      static constexpr std::array<std::string_view, 7> kActions = {
          "open", "show", "cancel", "pause", "retry", "discard", "forget"};
      if (!requested || std::find(kActions.begin(), kActions.end(), *requested) == kActions.end())
        return Error("Invalid download action");
      action = *requested;
    }
    const auto error = modal_browser::RunMerlinDownloadAction(browser->GetProfile(), action, id);
    return error.empty() ? Ok() : Error(error);
  }
  if (name == "appearance.set") {
    const auto* mode = args->FindString("mode");
    const auto* accent = args->FindString("accent");
    const auto reduced = args->FindBool("reduceMotion");
    if (!mode || (*mode != "system" && *mode != "light" && *mode != "dark") ||
        !accent || (*accent != "ocean" && *accent != "iris" && *accent != "fern") || !reduced)
      return Error("Invalid appearance preference");
    browser->GetProfile()->GetPrefs()->SetDict("merlin.shell.appearance",
        Dict().Set("mode", *mode).Set("accent", *accent).Set("reduceMotion", *reduced));
    // Pages and native dialogs follow the same scheme as the shell.
    if (auto* theme = ThemeServiceFactory::GetForProfile(browser->GetProfile()))
      theme->SetBrowserColorScheme(*mode == "light" ? ThemeService::BrowserColorScheme::kLight
          : *mode == "dark" ? ThemeService::BrowserColorScheme::kDark
          : ThemeService::BrowserColorScheme::kSystem);
    return Ok();
  }
  if (name == "permissions.answer" || name == "prompts.update") {
    const auto* id = args->FindString("promptId");
    const auto* action = args->FindString("actionId");
    if (!id || (name == "permissions.answer" && !action) || state->prompts.empty() ||
        *state->prompts.front().description.FindString("id") != *id)
      return Error("This prompt is no longer active");
    auto& pending = state->prompts.front();
    if (const auto* text = args->FindString("text")) {
      if (!pending.description.FindDict("input") || text->size() > 32 * 1024) return Error("Invalid prompt input");
      pending.draft.text = *text;
    }
    if (const auto suppress = args->FindBool("suppress")) {
      if (*suppress && !pending.description.FindBool("canSuppress").value_or(false)) return Error("Invalid prompt option");
      pending.draft.suppress = *suppress;
    }
    if (name == "prompts.update") return Ok();
    const auto* actions = pending.description.FindList("actions");
    bool allowed = false;
    if (actions) for (const auto& candidate : *actions) {
      const auto* candidate_id = candidate.GetDict().FindString("id");
      if (candidate_id && *candidate_id == *action) allowed = true;
    }
    if (!allowed) return Error("Invalid prompt action");
    if (base::TimeTicks::Now() - pending.shown < base::Milliseconds(500))
      return Error("Wait a moment before answering this prompt");
    auto callback = std::move(pending.reply);
    auto reply = std::move(pending.draft);
    reply.action = *action;
    state->prompts.pop_front();
    if (!state->prompts.empty()) state->prompts.front().shown = base::TimeTicks::Now();
    state->Changed();
    // The callback may close this browser. Do not touch state afterwards.
    if (callback) std::move(callback).Run(std::move(reply));
    return Ok();
  }
  const int index = FindTab(strip, args->FindString("tabId"));
  if (index < 0) return Error("Tab has closed or belongs to another window");
  auto* contents = strip->GetWebContentsAt(index);
  if (name == "find.focus") {
    const auto focused = args->FindBool("focused");
    if (!focused) return Error("Missing find focus state");
    const auto id = *args->FindString("tabId");
    if (*focused && index == strip->active_index()) state->find_focused_tab = id;
    else if (state->find_focused_tab == id) state->find_focused_tab.clear();
  } else if (name == "find.query") {
    const auto* text = args->FindString("text");
    const auto forward = args->FindBool("forward");
    if (!text || !forward || index != strip->active_index()) return Error("Find is only available in the current tab");
    auto* controller = FindBarController::From(browser);
    auto value = base::UTF8ToUTF16(*text);
    controller->find_bar()->SetFindTextAndSelectedRange(value, gfx::Range(value.size()));
    controller->OnUserChangedFindText(value);
    find_in_page::FindTabHelper::FromWebContents(contents)->StartFinding(value, *forward, false, true);
  } else if (name == "tabs.bookmark") {
    if (index != strip->active_index() || !chrome::CanBookmarkCurrentTab(browser)) return Error("This tab cannot be bookmarked");
    chrome::BookmarkCurrentTab(browser);
  } else if (name == "tabs.activate") strip->ActivateTabAt(index);
  else if (name == "tabs.close") strip->CloseWebContentsAt(index, TabCloseTypes::CLOSE_USER_GESTURE | TabCloseTypes::CLOSE_CREATE_HISTORICAL_TAB);
  else if (name == "tabs.pin") {
    auto pinned = args->FindBool("pinned");
    if (!pinned) return Error("Missing pinned state");
    strip->SetTabPinned(index, *pinned);
  } else if (name == "tabs.move") {
    const auto* before = args->Find("beforeId");
    if (!before || (!before->is_none() && !before->is_string())) return Error("Invalid tab destination");
    int target = before->is_none() ? strip->count() - 1 : FindTab(strip, &before->GetString());
    if (target < 0) return Error("Destination tab has closed");
    if (!before->is_none() && target > index) --target;
    strip->MoveWebContentsAt(index, target, false);
  } else if (name == "navigation.back") {
    if (contents->GetController().CanGoBack()) contents->GetController().GoBack();
  } else if (name == "navigation.forward") {
    if (contents->GetController().CanGoForward()) contents->GetController().GoForward();
  } else if (name == "navigation.reload") contents->GetController().Reload(content::ReloadType::NORMAL, true);
  else if (name == "navigation.stop") contents->Stop();
  else if (name == "navigation.open") {
    auto* text = args->FindString("text");
    if (!text) return Error("Missing navigation text");
    GURL url = ResolveAddress(browser->GetProfile(), *text);
    if (!url.is_valid()) return Error("This address cannot be opened");
    contents->GetController().LoadURL(url, content::Referrer(), ui::PAGE_TRANSITION_TYPED, std::string());
  } else if (name == "tabs.split") {
    // A tab dropped on the page: it shows beside the active tab, on the side
    // it was dropped on, and takes the focus.
    const auto* side = args->FindString("side");
    if (!side || (*side != "left" && *side != "right" && *side != "top" && *side != "bottom"))
      return Error("Invalid split side");
    if (browser->GetType() != BrowserWindowInterface::TYPE_NORMAL) return Error("This window can't show a split view");
    const int active = strip->active_index();
    if (active < 0 || index == active) return Error("Choose another tab to show beside this one");
    tabs::TabInterface* dropped = strip->GetTabAtIndex(index);
    // Splits hold two tabs: the dropped one replaces the other side.
    if (const auto current = strip->GetSplitForTab(active)) strip->RemoveSplit(*current);
    if (const auto other = strip->GetSplitForTab(strip->GetIndexOfTab(dropped))) strip->RemoveSplit(*other);
    const bool stacked = *side == "top" || *side == "bottom";
    const auto id = strip->AddToNewSplit({strip->GetIndexOfTab(dropped)},
        split_tabs::SplitTabVisualData(stacked ? split_tabs::SplitTabLayout::kStacked : split_tabs::SplitTabLayout::kSideBySide),
        split_tabs::SplitTabCreatedSource::kDragAndDropTab);
    const auto members = strip->GetSplitData(id)->ListTabs();
    const bool first = *side == "left" || *side == "top";
    if (!members.empty() && (members.front() == dropped) != first) strip->ReverseTabsInSplit(id);
    strip->ActivateTabAt(strip->GetIndexOfTab(dropped));
  } else if (name == "tabs.detach") {
    // A tab dragged out of the window becomes a window of its own, the size
    // of this one, with its tabs under the pointer.
    if (browser->GetType() != BrowserWindowInterface::TYPE_NORMAL) return Error("This tab can't move to a new window");
    if (const auto split = strip->GetSplitForTab(index)) strip->RemoveSplit(*split);
    tabs::TabInterface* moving = strip->GetTabAtIndex(index);
    const int at = strip->GetIndexOfTab(moving);
    if (!chrome::CanMoveTabsToNewWindow(browser, {at})) return Error("This is the window's only tab");
    const gfx::Rect old_bounds = browser->GetWindow()->GetRestoredBounds();
    const gfx::Point cursor = display::Screen::Get()->GetCursorScreenPoint();
    chrome::MoveTabsToNewWindow(browser, {at});
    if (auto* target = moving->GetBrowserWindowInterface(); target && target != browser && target->GetWindow()) {
      constexpr int kGrabX = 96, kGrabY = 18;
      target->GetWindow()->SetBounds(gfx::Rect(cursor.x() - kGrabX, cursor.y() - kGrabY,
                                               old_bounds.width(), old_bounds.height()));
    }
  } else return Error("Unsupported engine method");
  return Ok();
}
uint64_t Subscribe(MerlinEventCallback callback, void* context) {
  if (!callback || !Enabled() || !content::BrowserThread::CurrentlyOn(content::BrowserThread::UI)) return 0;
  auto& registry = GetRegistry();
  const auto id = ++registry.next_listener;
  registry.listeners.emplace(id, Listener{callback, context});
  return id;
}
void Unsubscribe(uint64_t id) {
  if (content::BrowserThread::CurrentlyOn(content::BrowserThread::UI)) GetRegistry().listeners.erase(id);
}
// MERLIN_TRACE_FILE=<file> appends "page-shown <tab> <ms since the Unix
// epoch>" whenever a page's view goes into the window, so benchmarks can time
// a tab switch to the page actually on screen.
void TracePageShown(const std::string& tab) {
  static FILE* file = [] {
    const char* path = getenv("MERLIN_TRACE_FILE");
    return path && path[0] ? fopen(path, "a") : nullptr;
  }();
  if (!file) return;
  fprintf(file, "page-shown %s %.1f\n", tab.c_str(), base::Time::Now().InMillisecondsFSinceUnixEpoch());
  fflush(file);
}
// Chromium gives a page a new RenderWidgetHostViewCocoa on most navigations
// and removes the old one a moment later. The page view's layer has no view
// delegate to veto implicit actions inside the shell, so each sublayer change
// cross-faded the whole page over a quarter second. Pages appear at once.
void DisableImplicitAnimations(NSView* page) {
  CALayer* layer = page.layer;
  if (!layer || layer.actions[@"sublayers"] == NSNull.null) return;
  NSMutableDictionary* actions = [layer.actions mutableCopy] ?: [NSMutableDictionary dictionary];
  for (NSString* key in @[ @"sublayers", @"onOrderIn", @"onOrderOut", @"transition", @"contents", @"hidden", @"opacity",
                           @"bounds", @"position" ])
    actions[key] = NSNull.null;
  layer.actions = actions;
}
// Puts the page at `index` into `container`. As BrowserView restores focus to
// the page on a tab switch: modal keys and page shortcuts need the page to
// hold focus. A text field (the address, the command menu, a panel's field)
// keeps it.
NSView* PlacePage(TabStripModel* strip, int index, NSView* container) {
  NSView* page = strip->GetWebContentsAt(index)->GetNativeView().GetNativeNSView();
  if (page.window && page.window != container.window) return nil;
  if (page.superview != container) [container addSubview:page];
  DisableImplicitAnimations(page);
  page.frame = container.bounds;
  // Chromium creates a background tab's view hidden and relies on Views'
  // NativeViewHost to unhide it (WebContentsViewMac::CreateView). Without
  // this, a tab opened in the background stays blank once shown.
  page.hidden = NO;
  NSResponder* responder = container.window.firstResponder;
  if (index == strip->active_index() && ![responder isKindOfClass:NSText.class] &&
      ![responder isKindOfClass:NSTextField.class])
    strip->GetWebContentsAt(index)->Focus();
  TracePageShown(TabId(strip->GetTabAtIndex(index)));
  return page;
}
void* AttachPage(const char* window, const char* tab, void* parent) {
  if (!Enabled() || !parent || !content::BrowserThread::CurrentlyOn(content::BrowserThread::UI)) return nullptr;
  auto* state = FindWindow(window);
  if (!state || !tab) return nullptr;
  auto* owner = state->browser()->GetWindow();
  NSView* container = (__bridge NSView*)parent;
  if (!owner || !container.window || container.window != owner->GetNativeWindow().GetNativeNSWindow()) return nullptr;
  if (tab == kExtensionPopupView) {
    auto* contents = modal_browser::ShellExtensionPopupContents(state->browser());
    NSView* popup = contents ? contents->GetNativeView().GetNativeNSView() : nil;
    if (!popup || (popup.window && popup.window != container.window)) return nullptr;
    [container addSubview:popup];
    DisableImplicitAnimations(popup);
    popup.frame = container.bounds;
    popup.hidden = NO;  // As in PlacePage.
    contents->WasShown();
    contents->Focus();
    return (__bridge void*)popup;
  }
  auto* strip = state->browser()->GetTabStripModel();
  const std::string id(tab);
  const int index = FindTab(strip, &id);
  const int active = strip->active_index();
  const auto split = active >= 0 ? strip->GetSplitForTab(active) : std::nullopt;
  if (index < 0 || (index != active && (!split || strip->GetSplitForTab(index) != split))) return nullptr;
  NSView* page = PlacePage(strip, index, container);
  if (!page) return nullptr;
  // A page shown alone: its view is where the next tab switch shows the
  // next page, before React has re-rendered.
  if (index == active && !split) state->page_container = container;
  return (__bridge void*)page;
}
void DetachPage(const char* window, const char* tab, void* parent) {
  if (!Enabled() || !parent || !tab || !content::BrowserThread::CurrentlyOn(content::BrowserThread::UI)) return;
  auto* state = FindWindow(window);
  if (!state) return;
  if (tab == kExtensionPopupView) {
    auto* contents = modal_browser::ShellExtensionPopupContents(state->browser());
    NSView* popup = contents ? contents->GetNativeView().GetNativeNSView() : nil;
    if (popup.superview == (__bridge NSView*)parent) [popup removeFromSuperview];
    return;
  }
  const std::string id(tab);
  auto* strip = state->browser()->GetTabStripModel();
  int index = FindTab(strip, &id);
  if (index < 0) return;
  NSView* page = strip->GetWebContentsAt(index)->GetNativeView().GetNativeNSView();
  if (page.superview == (__bridge NSView*)parent) [page removeFromSuperview];
}
}  // namespace

namespace modal_browser {
void RevealActivePage(BrowserWindowInterface* browser, bool start_page) {
  if (!Enabled() || !browser) return;
  auto* state = FindWindow(WindowId(browser).c_str());
  NSView* container = state ? state->page_container : nil;
  auto* strip = browser->GetTabStripModel();
  const int active = strip->active_index();
  // Split views and the start page are laid out by React; so is a window
  // whose page view React has not placed yet.
  if (!container || !container.window || active < 0 || start_page || strip->GetSplitForTab(active)) return;
  NSView* next = strip->GetWebContentsAt(active)->GetNativeView().GetNativeNSView();
  for (NSView* view in [container.subviews copy])
    if (view != next) [view removeFromSuperview];
  PlacePage(strip, active, container);
}
}  // namespace modal_browser

namespace {
void ReleaseString(char* json) { free(json); }
const MerlinEngineAPI kAPI = {1, sizeof(MerlinEngineAPI), Call, ReleaseString, Subscribe, Unsubscribe, AttachPage, DetachPage};
}  // namespace

extern "C" __attribute__((visibility("default"))) const MerlinEngineAPI* MerlinEngineGetAPI(uint32_t version) {
  return version == 1 ? &kAPI : nullptr;
}

namespace modal_browser {
bool ReactShellEnabled() { return Enabled(); }
bool IsShellStartUrl(const GURL& url) {
  if (url.is_empty() || url == GURL(url::kAboutBlankURL)) return true;
  if (!url.SchemeIs("chrome")) return false;
  const std::string_view host = url.host();
  return (url.path() == "/" || url.path().empty()) &&
         (host == "newtab" || host == "new-tab-page" || host == "merlin-start");
}
bool ShowsShellStartPage(BrowserWindowInterface* browser, content::WebContents* contents) {
  auto* state = Enabled() && browser ? FindWindow(WindowId(browser).c_str()) : nullptr;
  return state ? state->ShowsStartPage(contents) : IsShellStartUrl(contents->GetVisibleURL());
}
void NotifyShellWindow(BrowserWindowInterface* browser) {
  if (!Enabled() || !browser) return;
  if (auto* state = FindWindow(WindowId(browser).c_str())) state->Changed();
}
void SetShellFindState(BrowserWindowInterface* browser, Dict find) {
  if (!Enabled() || !browser) return;
  if (auto* state = FindWindow(WindowId(browser).c_str())) { state->find = std::move(find); state->Changed(); }
}
bool ShellFindHasFocus(BrowserWindowInterface* browser) {
  auto* state = FindWindow(WindowId(browser).c_str());
  auto* strip = browser->GetTabStripModel();
  return state && strip->active_index() >= 0 &&
      state->find_focused_tab == TabId(strip->GetTabAtIndex(strip->active_index()));
}
void SendShellEvent(BrowserWindowInterface* browser, const char* type) {
  if (!Enabled() || !browser) return;
  GetRegistry().Emit(Dict().Set("type", type).Set("windowId", WindowId(browser)));
}
bool OpenNewTabPopup(BrowserWindowInterface* browser) {
  if (!Enabled() || !browser || browser->GetType() != BrowserWindowInterface::TYPE_NORMAL ||
      browser->GetTabStripModel()->empty() || !FindWindow(WindowId(browser).c_str()))
    return false;
  // The shell keeps this setting in AppKit's defaults (packages/shell).
  NSString* value = [NSUserDefaults.standardUserDefaults stringForKey:@"MerlinShell.newTabPopup"];
  if (![value isEqualToString:@"on"]) return false;
  GetRegistry().Emit(Dict().Set("type", "panel.open").Set("windowId", WindowId(browser)).Set("panel", "newTab"));
  return true;
}
bool CycleShellTabs(BrowserWindowInterface* browser, bool forward) {
  auto* state = Enabled() && browser ? FindWindow(WindowId(browser).c_str()) : nullptr;
  if (!state || !state->switcher) return false;
  state->switcher->Cycle(forward);
  return true;
}
bool OpenShellPanel(BrowserWindowInterface* browser, const char* panel) {
  if (!Enabled() || !browser || !FindWindow(WindowId(browser).c_str())) return false;
  GetRegistry().Emit(Dict().Set("type", "panel.open").Set("windowId", WindowId(browser)).Set("panel", panel));
  return true;
}
std::string ShowShellPrompt(BrowserWindowInterface* browser, Dict prompt,
                            base::OnceCallback<void(ShellPromptReply)> reply) {
  auto* state = browser && Enabled() ? FindWindow(WindowId(browser).c_str()) : nullptr;
  if (!state) {
    if (reply) std::move(reply).Run(ShellPromptReply());
    return {};
  }
  const auto id = base::Uuid::GenerateRandomV4().AsLowercaseString();
  prompt.Set("id", id);
  // Where the shell shows it: beside the address ("site"), over the page
  // ("page") or centred in the window.
  if (const auto* anchor = prompt.FindString("anchor"); !anchor || (*anchor != "site" && *anchor != "page"))
    prompt.Set("anchor", "window");
  auto position = state->prompts.end();
  if (!prompt.FindBool("quiet").value_or(false)) {
    position = std::find_if(state->prompts.begin(), state->prompts.end(), [](const auto& pending) {
      return pending.description.FindBool("quiet").value_or(false);
    });
  }
  ShellPromptReply draft;
  if (const auto* input = prompt.FindDict("input"))
    if (const auto* value = input->FindString("defaultValue")) draft.text = *value;
  state->prompts.insert(position, ShellPrompt{std::move(prompt), std::move(reply), std::move(draft), base::TimeTicks::Now()});
  state->Changed();
  return id;
}
std::string ShellPromptInput(BrowserWindowInterface* browser, const std::string& id) {
  auto* state = browser && Enabled() ? FindWindow(WindowId(browser).c_str()) : nullptr;
  if (state) for (const auto& prompt : state->prompts)
    if (*prompt.description.FindString("id") == id) return prompt.draft.text;
  return {};
}
void CancelShellPrompt(BrowserWindowInterface* browser, const std::string& id) {
  auto* state = browser && Enabled() ? FindWindow(WindowId(browser).c_str()) : nullptr;
  if (!state) return;
  const auto it = std::find_if(state->prompts.begin(), state->prompts.end(), [&id](const auto& prompt) {
    return *prompt.description.FindString("id") == id;
  });
  if (it == state->prompts.end()) return;
  // Caller is tearing down the request; do not call its callback again.
  state->prompts.erase(it);
  if (!state->prompts.empty()) state->prompts.front().shown = base::TimeTicks::Now();
  state->Changed();
}
}  // namespace modal_browser
