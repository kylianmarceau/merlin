// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_shell_api.h"

#import <AppKit/AppKit.h>
#include <algorithm>
#include <array>
#include <string_view>
#include <deque>
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "chrome/browser/ui/modal_browser/merlin_react_window.h"
#include "chrome/browser/ui/modal_browser/merlin_page_identity.h"
#include "base/time/time.h"
#include <cstdlib>
#include <cstring>
#include <map>
#include <utility>
#include <memory>
#include <string>
#include "base/command_line.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/logging.h"
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
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/sessions/exit_type_service.h"
#include "chrome/browser/sessions/session_restore.h"
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
#include "chrome/browser/ui/modal_browser/merlin_shell_vocabulary.h"
#include "chrome/browser/ui/modal_browser/merlin_react_extension_popup.h"
#include "chrome/browser/ui/modal_browser/merlin_auto_pip.h"
#include "chrome/browser/ui/modal_browser/merlin_peek.h"
#include "chrome/browser/ui/modal_browser/merlin_tab_groups.h"
#include "chrome/browser/ui/modal_browser/merlin_suggestions.h"
#include "chrome/browser/ui/modal_browser/merlin_tab_switcher.h"
#include "chrome/browser/ui/modal_browser/merlin_page_color.h"
#include "chrome/browser/bookmarks/bookmark_model_factory.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_muted_utils.h"
#include "components/bookmarks/browser/base_bookmark_model_observer.h"
#include "components/bookmarks/browser/bookmark_model.h"
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
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/render_widget_host_observer.h"
#include "content/public/browser/render_widget_host_view.h"
#include "third_party/blink/public/common/input/web_input_event.h"
#include "ui/native_theme/native_theme.h"
#include "ui/native_theme/native_theme_observer.h"
#include "base/timer/timer.h"
#include "content/public/browser/media_session.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "services/media_session/public/cpp/media_metadata.h"
#include "services/media_session/public/mojom/media_session.mojom.h"

namespace {
using Dict = base::DictValue;
using List = base::ListValue;
namespace shell = modal_browser::shell;
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
// And this one the window's peek (merlin_peek.h).
constexpr std::string_view kPeekView = "peek";
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
// Listens to one tab's media session, so a track change, a pause or a play
// in a tab in the background refreshes the snapshot (its `media`). Sound
// starting and stopping reaches the window as a tab change already, but a
// paused session is silent and its metadata changes say nothing.
class MediaWatch : public media_session::mojom::MediaSessionObserver {
 public:
  MediaWatch(content::MediaSession* session, base::RepeatingClosure changed)
      : changed_(std::move(changed)) {
    session->AddObserver(receiver_.BindNewPipeAndPassRemote());
    receiver_.set_disconnect_handler(base::BindOnce(&MediaWatch::Gone, base::Unretained(this)));
  }
  // The session went with its page or its tab: a new one needs a new watch.
  bool connected() const { return receiver_.is_bound(); }
  void MediaSessionInfoChanged(media_session::mojom::MediaSessionInfoPtr) override { changed_.Run(); }
  void MediaSessionMetadataChanged(const std::optional<media_session::MediaMetadata>&) override { changed_.Run(); }
  void MediaSessionActionsChanged(const std::vector<media_session::mojom::MediaSessionAction>&) override { changed_.Run(); }
  void MediaSessionImagesChanged(
      const base::flat_map<media_session::mojom::MediaSessionImageType, std::vector<media_session::MediaImage>>&) override {}
  void MediaSessionPositionChanged(const std::optional<media_session::MediaPosition>&) override {}
 private:
  void Gone() { receiver_.reset(); }
  base::RepeatingClosure changed_;
  mojo::Receiver<media_session::mojom::MediaSessionObserver> receiver_{this};
};

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
                    public download::AllDownloadItemNotifier::Observer, public ui::NativeThemeObserver,
                    public bookmarks::BaseBookmarkModelObserver {
 public:
  explicit WindowState(BrowserWindowInterface* browser) : browser_(browser) {
    browser_->GetTabStripModel()->AddObserver(this);
    Observe(browser_->GetTabStripModel()->GetActiveWebContents());
    prefs_.Init(browser_->GetProfile()->GetPrefs());
    prefs_.Add("merlin.shell.appearance", base::BindRepeating([](WindowState* window) {
      window->Changed();
      window->SampleEdgeSoon();
    }, base::Unretained(this)));
    switcher = std::make_unique<modal_browser::TabSwitcher>(
        browser_, base::BindRepeating(&WindowState::Changed, base::Unretained(this)));
    content::GetUIThreadTaskRunner({})->PostTask(FROM_HERE, base::BindOnce(
        &WindowState::WatchDownloads, weak_factory_.GetWeakPtr()));
    // The page's edge colour is read when it may have changed, never on a
    // timer: a quiet page costs no wakeups (7.7). A sticky header that
    // changes colour as the page scrolls is read once the scroll ends.
    scrolls_.Watch(web_contents());
    theme_.Observe(ui::NativeTheme::GetInstanceForNativeUi());
    // Each tab says whether its page is bookmarked (the address field's star).
    if (auto* model = BookmarkModelFactory::GetForBrowserContext(browser_->GetProfile())) bookmarks_.Observe(model);
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
  // What this window's interface last said about itself (shell.report): how
  // many times a root has shown its first snapshot, how many times its error
  // boundary caught a failure, and the last one. For the log and the tests.
  int shell_ready = 0;
  int shell_failures = 0;
  std::string shell_last_error;
  // Ctrl-Tab's cards.
  std::unique_ptr<modal_browser::TabSwitcher> switcher;
  // Address-bar suggestions, created on first use.
  std::unique_ptr<modal_browser::MerlinSuggestions> suggestions;
  std::string suggest_query;
  void Suggest(const std::string& query, const std::string& text, bool prevent_inline);
  // Opens a suggestion; false when the results changed since `query`.
  // Opens result `index` of `query`, the latest query. With `url`, only if
  // that result is still `url`: Chromium's list updates as results arrive,
  // so an index alone could name another match than the row the shell showed.
  bool OpenSuggestion(const std::string& query, size_t index, const std::string* url, bool new_tab);
  Dict find = Dict().Set("visible", false).Set("text", "").Set("matches", 0).Set("ordinal", 0).Set("focus", 0);
  std::string find_focused_tab;
  void OnTabStripModelChanged(TabStripModel*, const TabStripModelChange&,
                              const TabStripSelectionChange&) override;
  void OnTabChangedAt(tabs::TabInterface*, TabChangeType) override { Changed(); }
  // Pinning a tab that keeps its place (the first, or the only one) moves
  // nothing, so OnTabStripModelChanged never hears of it.
  void OnTabPinnedStateChanged(tabs::TabInterface*, int) override { Changed(); }
  void OnTabGroupChanged(const TabGroupChange&) override { Changed(); }
  void TabGroupedStateChanged(TabStripModel*, std::optional<tab_groups::TabGroupId>,
                              std::optional<tab_groups::TabGroupId>, tabs::TabInterface*, int) override { Changed(); }
  void DidStartLoading() override { Changed(); }
  void DidStopLoading() override { Changed(); SampleEdgeSoon(); }
  void OnVisibilityChanged(content::Visibility visibility) override {
    if (visibility == content::Visibility::VISIBLE) SampleEdgeSoon();
  }
  void RenderFrameHostChanged(content::RenderFrameHost*, content::RenderFrameHost* now) override {
    if (now && now->IsInPrimaryMainFrame()) scrolls_.Watch(web_contents());
  }
  void RenderViewReady() override { scrolls_.Watch(web_contents()); }
  // Modal scrolling (j, k, gg, G) runs in the page; its scroll ends later.
  void PageScrolled() { edge_after_scroll_.Start(FROM_HERE, base::Milliseconds(600),
      base::BindOnce(&WindowState::SampleEdge, base::Unretained(this))); }
  // The system appearance changed: pages that follow it restyle.
  void OnNativeThemeUpdated(ui::NativeTheme*) override { SampleEdgeSoon(); }
  void DocumentOnLoadCompletedInPrimaryMainFrame() override { SampleEdgeSoon(); }
  void PrimaryPageChanged(content::Page&) override { Changed(); }
  void DidStartNavigation(content::NavigationHandle* navigation) override;
  void DidFinishNavigation(content::NavigationHandle* navigation) override;
  void DidFirstVisuallyNonEmptyPaint() override;
  bool ShowsStartPage(content::WebContents* contents) const;
  // The joined tab and toolbar take the site's colour.
  void DidChangeThemeColor() override { Changed(); SampleEdgeSoon(); }
  // Mixed content, a certificate warning proceeded past: the lock follows.
  void DidChangeVisibleSecurityState() override { Changed(); }
  // The shell shows a crashed page's own view (no sad tab: BrowserView draws it).
  void PrimaryMainFrameRenderProcessGone(base::TerminationStatus) override { Changed(); }
  // Bookmarks added, removed or moved anywhere (the Library, another window, sync).
  void BookmarkModelChanged() override { Changed(); }
  void BookmarkModelBeingDeleted() override { bookmarks_.Reset(); }
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
  base::OneShotTimer edge_soon_;
  base::OneShotTimer edge_after_scroll_;
  // The end of a wheel, trackpad or fling scroll on the active page.
  class ScrollWatcher : public content::RenderWidgetHost::InputEventObserver,
                        public content::RenderWidgetHostObserver {
   public:
    explicit ScrollWatcher(WindowState* window) : window_(window) {}
    ~ScrollWatcher() override { Watch(nullptr); }
    void Watch(content::WebContents* contents) {
      auto* view = contents ? contents->GetRenderWidgetHostView() : nullptr;
      content::RenderWidgetHost* host = view ? view->GetRenderWidgetHost() : nullptr;
      if (host == host_) return;
      if (host_) { host_->RemoveInputEventObserver(this); host_->RemoveObserver(this); }
      host_ = host;
      if (host_) { host_->AddInputEventObserver(this); host_->AddObserver(this); }
    }
    void OnInputEvent(const content::RenderWidgetHost&, const blink::WebInputEvent& event,
                      InputEventSource) override {
      if (event.GetType() == blink::WebInputEvent::Type::kGestureScrollEnd) window_->PageScrolled();
    }
    void RenderWidgetHostDestroyed(content::RenderWidgetHost* host) override {
      if (host == host_) Watch(nullptr);
    }
   private:
    raw_ptr<WindowState> window_;
    raw_ptr<content::RenderWidgetHost> host_ = nullptr;
  };
  ScrollWatcher scrolls_{this};
  base::ScopedObservation<ui::NativeTheme, ui::NativeThemeObserver> theme_{this};
  base::ScopedObservation<bookmarks::BookmarkModel, bookmarks::BookmarkModelObserver> bookmarks_{this};
  // A navigation that started on the start page, and then the page it
  // committed to, which is drawing its first content: the shell keeps the
  // start page up meanwhile instead of an empty page.
  int64_t navigation_from_start_ = 0;
  base::WeakPtr<content::WebContents> painting_;
  base::OneShotTimer paint_timeout_;
  // Icon colours by icon key (see SiteColor).
  std::map<std::string, std::string> icon_colors_;
  // The tab's media, for the sidebar's player and its icon's badge: absent
  // when it has none that can be played or paused.
  base::Value Media(content::WebContents* contents);
  // Keyed by the tab's contents only to find a watch again; never followed.
  std::map<const content::WebContents*, std::unique_ptr<MediaWatch>> media_;
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
    if (!reply_waiters.empty()) TakeReplyWaiter(event);
    const auto json = base::WriteJson(event);
    if (!json) return;
    // Callbacks can unsubscribe while delivering an event.
    const auto copy = listeners;
    for (const auto& [id, listener] : copy)
      if (listeners.contains(id)) listener.callback(json->c_str(), listener.context);
  }
  // browserctl shell-call (tests/e2e only): a request waiting for its
  // "reply" event, by window and request ID.
  using ReplyKey = std::pair<std::string, std::string>;
  std::map<ReplyKey, base::OnceCallback<void(const Dict&)>> reply_waiters;
  void TakeReplyWaiter(const Dict& event) {
    const auto* type = event.FindString("type");
    const auto* window = event.FindString("windowId");
    const auto* request = event.FindString("requestId");
    if (!type || *type != "reply" || !window || !request) return;
    FinishReplyWaiter({*window, *request}, event);
  }
  void FinishReplyWaiter(const ReplyKey& key, const Dict& reply) {
    const auto it = reply_waiters.find(key);
    if (it == reply_waiters.end()) return;
    auto waiter = std::move(it->second);
    reply_waiters.erase(it);
    std::move(waiter).Run(reply);
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
// Settings › Appearance › Tabs › New tabs open "At the top": a new blank tab
// (Command-T, the New Tab buttons) goes before the other open tabs, as in
// Arc and Dia, instead of after them. Tabs opened from links keep their place.
bool NewTabsAtTop() {
  // The shell keeps this setting in AppKit's defaults (packages/shell).
  NSString* value = [NSUserDefaults.standardUserDefaults stringForKey:@"MerlinShell.newTabPosition"];
  return [value isEqualToString:@"top"];
}
void WindowState::OnTabStripModelChanged(TabStripModel* model, const TabStripModelChange& change,
                                        const TabStripSelectionChange& selection) {
  // Restored tabs keep the order they were saved in.
  if (change.type() == TabStripModelChange::kInserted && NewTabsAtTop() &&
      !SessionRestore::IsRestoring(browser_->GetProfile())) {
    for (const auto& inserted : change.GetInsert()->contents) {
      auto* contents = inserted.contents.get();
      if (!contents || !modal_browser::IsShellStartUrl(contents->GetVisibleURL()) ||
          contents->GetController().GetEntryCount() > 1 || contents->GetController().NeedsReload()) continue;
      // Not while the strip is still notifying its observers.
      content::GetUIThreadTaskRunner({})->PostTask(FROM_HERE, base::BindOnce(
          [](base::WeakPtr<WindowState> state, base::WeakPtr<content::WebContents> moving) {
            if (!state || !moving) return;
            auto* strip = state->browser()->GetTabStripModel();
            const int at = strip->GetIndexOfWebContents(moving.get());
            const int first = strip->IndexOfFirstNonPinnedTab();
            if (at > first && !strip->IsTabPinned(at) && !strip->GetTabGroupForTab(at) && !strip->GetSplitForTab(at))
              strip->MoveWebContentsAt(at, first, /*select_after_move=*/false);
          }, weak_factory_.GetWeakPtr(), contents->GetWeakPtr()));
    }
  }
  Observe(browser_->GetTabStripModel()->GetActiveWebContents());
  scrolls_.Watch(web_contents());
  // The hold belongs to the tab it started in.
  if (painting_ && painting_.get() != web_contents()) StopHoldingStartPage();
  if (!web_contents()) navigation_from_start_ = 0;
  if (switcher) switcher->TabsChanged();
  // A collapsed group never hides the page on screen. Not while the strip is
  // still notifying its observers.
  if (selection.active_tab_changed()) modal_browser::MerlinAutoPipActiveTabChanged(selection.old_contents, selection.new_contents);
  if (selection.active_tab_changed())
    content::GetUIThreadTaskRunner({})->PostTask(FROM_HERE, base::BindOnce(
        [](base::WeakPtr<WindowState> state) {
          if (state) modal_browser::ExpandActiveGroup(state->browser()->GetTabStripModel());
        }, weak_factory_.GetWeakPtr()));
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
base::Value WindowState::Media(content::WebContents* contents) {
  using media_session::mojom::MediaPlaybackState;
  using media_session::mojom::MediaSessionAction;
  using media_session::mojom::MediaSessionInfo;
  auto* session = content::MediaSession::GetIfExists(contents);
  if (!session) return base::Value();
  auto& watch = media_[contents];
  if (!watch || !watch->connected())
    watch = std::make_unique<MediaWatch>(session, base::BindRepeating(&WindowState::Changed, weak_factory_.GetWeakPtr()));
  const auto info = session->GetMediaSessionInfoSync();
  // A session that has ended, or one only a page script can resume (a
  // transient sound, a muted autoplay), has nothing for the player.
  if (!info || info->state == MediaSessionInfo::SessionState::kInactive || !info->is_controllable) return base::Value();
  const auto& metadata = session->GetMediaSessionMetadata();
  const auto actions = session->GetMediaSessionActionsSync();
  return base::Value(Dict()
      .Set("playing", info->playback_state == MediaPlaybackState::kPlaying)
      .Set("title", base::UTF16ToUTF8(metadata.title))
      .Set("artist", base::UTF16ToUTF8(metadata.artist))
      .Set("canNext", std::ranges::contains(actions, MediaSessionAction::kNextTrack))
      .Set("canPrevious", std::ranges::contains(actions, MediaSessionAction::kPreviousTrack)));
}
Dict WindowState::Snapshot() {
  auto* strip = browser_->GetTabStripModel();
  List tabs;
  for (int i = 0; i < strip->count(); ++i) {
    auto* tab = strip->GetTabAtIndex(i);
    auto* contents = tab->GetContents();
    // The shell shows these, never its own reading of `url`: Chromium's
    // formatting hides user names and spoofed hosts, and its security state
    // knows about certificate errors the scheme can't show.
    const auto shown = modal_browser::FormatShellDisplayUrl(contents->GetVisibleURL());
    Dict entry = Dict().Set("id", TabId(tab))
      .Set("title", base::UTF16ToUTF8(contents->GetTitle()))
      .Set("url", contents->GetVisibleURL().spec()).Set("displayUrl", shown.url).Set("displayHost", shown.host)
      .Set("security", modal_browser::ShellSecurityState(contents))
      .Set("loading", contents->IsLoading()).Set("crashed", contents->IsCrashed())
      .Set("pinned", strip->IsTabPinned(i)).Set("audible", contents->IsCurrentlyAudible())
      .Set("muted", contents->IsAudioMuted()).Set("bookmarked", modal_browser::IsPageBookmarked(contents))
      .Set("discarded", contents->WasDiscarded())
      .Set("canGoBack", contents->GetController().CanGoBack())
      .Set("canGoForward", contents->GetController().CanGoForward())
      .Set("favicon", FaviconKey(contents)).Set("start", ShowsStartPage(contents));
    if (auto media = Media(contents); !media.is_none()) entry.Set("media", std::move(media));
    if (const auto group = strip->GetTabGroupForTab(i)) entry.Set("group", modal_browser::GroupKey(*group));
    // Every split, not only the one on screen, so the tabs can show each as one piece.
    if (const auto split = strip->GetSplitForTab(i)) entry.Set("split", split->ToString());
    if (auto color = SiteColor(contents, icon_colors_); !color.empty()) entry.Set("color", std::move(color));
    if (const auto edge = modal_browser::PageEdgeColor::Get(contents)) entry.Set("surface", HexColor(*edge));
    if (const auto* identity = modal_browser::PageIdentity::FromWebContents(contents); identity && identity->user_initiated())
      entry.Set("userInitiated", true);
    if (const auto restored = modal_browser::RestoredWebKitPage(contents))
      entry.Set("restoreInWebKit", Dict().Set("url", restored->url.spec()).Set("title", base::UTF16ToUTF8(restored->title)));
    tabs.Append(std::move(entry));
  }
  // Watches of tabs that have gone (closed, or moved to another window).
  std::erase_if(media_, [&](const auto& watch) {
    for (int i = 0; i < strip->count(); ++i)
      if (strip->GetWebContentsAt(i) == watch.first) return !watch.second->connected();
    return true;
  });
  // Running downloads and the most recent others; the Library asks for all
  // of them with downloads.list. The history can hold thousands.
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
    .Set("tabs", std::move(tabs)).Set("groups", modal_browser::GroupsSnapshot(strip))
    .Set("peek", modal_browser::MerlinPeekState(browser_))
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
bool WindowState::OpenSuggestion(const std::string& query, size_t index, const std::string* url, bool new_tab) {
  if (!suggestions || query != suggest_query || index >= suggestions->results().size()) return false;
  auto choice = suggestions->results()[index];
  if (url && choice.destination.spec() != *url) return false;
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
// Moves a split view's tabs together, so it stays a split, to just before
// the tab at `before` (-1: the end). A place inside another split becomes
// that split's start: Chromium never lets a move break a split apart. The
// split joins a group when it lands between two of the group's tabs, and
// stays in its own when it lands beside one of them.
void MoveSplit(TabStripModel* strip, split_tabs::SplitTabId split, int before) {
  std::vector<tabs::TabInterface*> others;
  int first = -1;
  for (int i = 0; i < strip->count(); ++i) {
    auto* tab = strip->GetTabAtIndex(i);
    if (tab->GetSplit() == split) {
      if (first < 0) first = i;
    } else {
      others.push_back(tab);
    }
  }
  if (first < 0) return;
  tabs::TabInterface* target = before >= 0 ? strip->GetTabAtIndex(before) : nullptr;
  if (target && target->GetSplit() == split) return;
  if (target) {
    if (const auto other = target->GetSplit()) {
      for (int i = 0; i < strip->count(); ++i) {
        if (strip->GetTabAtIndex(i)->GetSplit() == other) { target = strip->GetTabAtIndex(i); break; }
      }
    }
  }
  // The index among the tabs that stay put, which is what MoveSplitTo counts.
  int to = static_cast<int>(others.size());
  for (size_t i = 0; target && i < others.size(); ++i) {
    if (others[i] == target) { to = static_cast<int>(i); break; }
  }
  const auto group_of = [](tabs::TabInterface* tab) {
    return tab ? tab->GetGroup() : std::optional<tab_groups::TabGroupId>();
  };
  const auto left = group_of(to > 0 ? others[to - 1] : nullptr);
  const auto right = group_of(to < static_cast<int>(others.size()) ? others[to] : nullptr);
  const auto own = strip->GetTabAtIndex(first)->GetGroup();
  std::optional<tab_groups::TabGroupId> group;
  if (left && left == right) group = left;
  else if (own && (left == own || right == own)) group = own;
  strip->MoveSplitTo(split, to, strip->IsTabPinned(first), group);
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
  if (name == shell::method::kApplicationWindows) {
    List ids;
    for (const auto& [id, _] : GetRegistry().windows) ids.Append(id);
    return Ok(base::Value(std::move(ids)));
  }
  auto* state = FindWindow(window);
  if (!state) return Error("Browser window has closed");
  auto* browser = state->browser();
  auto* strip = browser->GetTabStripModel();
  if (name == shell::method::kWindowSnapshot) return Ok(base::Value(state->Snapshot()));
  if (name == shell::method::kShellReport) {
    // The interface showed its first snapshot, or its error boundary caught
    // a failure. Logged, so a report or a crash log has it.
    const auto* report = args->FindString("state");
    const auto* message = args->FindString("message");
    const auto* stack = args->FindString("stack");
    if (!report || (message && message->size() > 4096) || (stack && stack->size() > 32 * 1024))
      return Error("Invalid interface report");
    if (*report == shell::shell_report::kReady) {
      ++state->shell_ready;
    } else if (*report == shell::shell_report::kFailed) {
      ++state->shell_failures;
      state->shell_last_error = message ? *message : std::string();
      LOG(ERROR) << "Merlin's interface failed in window " << window << ": " << state->shell_last_error
                 << (stack && !stack->empty() ? "\n" + *stack : std::string());
    } else {
      return Error("Invalid interface report");
    }
    return Ok();
  }
  if (name == shell::method::kShellReloadWindow) {
    // "Reload Interface": a new React root for this window, after this call
    // has returned to the root it replaces. The tabs stay as they are.
    content::GetUIThreadTaskRunner({})->PostTask(FROM_HERE, base::BindOnce([](std::string id) {
      if (auto* state = FindWindow(id.c_str())) modal_browser::RemountReactShell(state->browser());
    }, std::string(window)));
    return Ok();
  }
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
  if (name == shell::method::kTabsThumbnail) {
    const int at = FindTab(strip, args->FindString("tabId"));
    if (at < 0) return Error("Tab has closed or belongs to another window");
    return Ok(modal_browser::TabSwitcher::Thumbnail(strip->GetTabAtIndex(at)));
  }
  if (name == shell::method::kSwitcherChoose) {
    const auto index = args->FindInt("index");
    if (!index) return Error("Invalid tab choice");
    state->switcher->CommitIndex(*index);
    return Ok();
  }
  if (name == shell::method::kSwitcherCancel) {
    state->switcher->Cancel();
    return Ok();
  }
  if (name == shell::method::kFaviconsGet) {
    const int at = FindTab(strip, args->FindString("tabId"));
    if (at < 0) return Error("Tab has closed or belongs to another window");
    return Ok(FaviconData(strip->GetWebContentsAt(at)));
  }
  if (name == shell::method::kOmniboxQuery) {
    const auto* query = args->FindString("queryId");
    const auto* text = args->FindString("text");
    const auto prevent = args->FindBool("preventInline");
    if (!ValidToken(query) || !text || text->size() > 4096 || !prevent) return Error("Invalid suggestion request");
    state->Suggest(*query, *text, *prevent);
    return Ok();
  }
  if (name == shell::method::kOmniboxStop) {
    if (state->suggestions) state->suggestions->Stop();
    return Ok();
  }
  if (name == shell::method::kOmniboxOpen) {
    const auto* query = args->FindString("queryId");
    const auto index = args->FindInt("index");
    const auto* url = args->FindString("url");
    const auto new_tab = args->FindBool("newTab");
    if (!ValidToken(query) || !index || *index < 0 || !url || url->size() > 8192 || !new_tab)
      return Error("Invalid suggestion");
    return state->OpenSuggestion(*query, static_cast<size_t>(*index), url, *new_tab) ? Ok()
        : Error("The suggestions changed; choose one again");
  }
  if (name == shell::method::kOmniboxEnter) {
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
          state->OpenSuggestion(*query, 0, /*url=*/nullptr, *new_tab))
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
  if (name == shell::method::kSiteInfo) {
    // The active page's security and blocking, as a popover by the address.
    modal_browser::ShowShellSiteInfo(browser);
    return Ok();
  }
  if (name == shell::method::kPeekClose || name == shell::method::kPeekPromote) {
    if (name == shell::method::kPeekClose) modal_browser::CloseMerlinPeek(browser);
    else modal_browser::PromoteMerlinPeek(browser);
    return Ok();
  }
  if (base::StartsWith(name, "groups.")) {
    const auto* key = args->FindString("groupId");
    const auto group = key ? modal_browser::FindGroup(strip, *key) : std::nullopt;
    if (!group) return Error("That group has closed");
    if (name == shell::method::kGroupsUngroup) modal_browser::UngroupAll(strip, *group);
    else if (name == shell::method::kGroupsClose) modal_browser::CloseGroup(strip, *group);
    else if (name == shell::method::kGroupsUpdate) {
      std::optional<std::string> title;
      if (const auto* value = args->FindString("title")) title = *value;
      std::optional<tab_groups::TabGroupColorId> color;
      if (const auto* value = args->FindString("color")) {
        color = modal_browser::ParseGroupColor(*value);
        if (!color) return Error("Unknown group colour");
      }
      const std::string error = modal_browser::UpdateGroup(strip, *group, title, color, args->FindBool("collapsed"));
      if (!error.empty()) return Error(error.c_str());
    } else return Error("Unsupported engine method");
    return Ok();
  }
  if (name == shell::method::kExtensionsClosePopup) {
    modal_browser::CloseShellExtensionPopup(browser);
    return Ok();
  }
  if (name == shell::method::kFindClose) {
    FindBarController::From(browser)->EndFindSession(find_in_page::SelectionAction::kKeep, find_in_page::ResultAction::kKeep);
    return Ok();
  }
  if (name == shell::method::kTabsCreate) {
    const auto* url = args->FindString("url");
    GURL destination("about:blank");
    if (url && !url->empty()) destination = ResolveAddress(browser->GetProfile(), *url);
    if (!destination.is_valid()) return Error("This address cannot be opened");
    chrome::AddTabAt(browser, destination, -1, true);
    return Ok();
  }
  if (name == shell::method::kPageFocus) {
    // Keys go back to the page after a panel, popover or the address field.
    if (auto* contents = strip->GetActiveWebContents(); contents && !contents->IsCrashed()) contents->Focus();
    return Ok();
  }
  if (name == shell::method::kModalCommand) {
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
    if (name == shell::method::kModalPaletteText) {
      const auto* text = args->FindString("text");
      if (!text) return Error("Missing command menu text");
      controller->OnPaletteTextChanged(base::UTF8ToUTF16(*text));
    } else if (name == shell::method::kModalPaletteSelect) {
      const auto index = args->FindInt("index");
      const auto revision = args->FindInt("revision");
      const auto* rows = palette->FindList("rows");
      if (!index || *index < 0 || !rows || static_cast<size_t>(*index) >= rows->size() ||
          !revision || state->Snapshot().FindInt("revision") != revision)
        return Error("The command results changed; choose the item again");
      controller->OnPaletteRowClicked(*index);
    } else if (name == shell::method::kModalPaletteKey) {
      const auto* key = args->FindString("key");
      if (!key) return Error("Missing command menu key");
      using Key = modal_browser::ffi::PaletteKey;
      if (*key == shell::palette_key::kAccept) controller->OnPaletteKey(Key::Accept);
      else if (*key == shell::palette_key::kCancel) controller->OnPaletteKey(Key::Cancel);
      else if (*key == shell::palette_key::kNext) controller->OnPaletteKey(Key::Next);
      else if (*key == shell::palette_key::kPrevious) controller->OnPaletteKey(Key::Previous);
      else return Error("Invalid command menu key");
    } else return Error("Unknown command menu action");
    return Ok();
  }
  if (name == shell::method::kDownloadsOpenFolder) {
    modal_browser::OpenMerlinDownloadsFolder(browser->GetProfile());
    return Ok();
  }
  if (name == shell::method::kDownloadsOpen || name == shell::method::kDownloadsCancel || name == shell::method::kDownloadsAct) {
    uint32_t id;
    const auto* value = args->FindString("downloadId");
    if (!value || !base::StringToUint(*value, &id)) return Error("Invalid download ID");
    std::string action = name == shell::method::kDownloadsOpen ? shell::download_action::kOpen
                                                                : shell::download_action::kCancel;
    if (name == shell::method::kDownloadsAct) {
      const auto* requested = args->FindString("action");
      const auto& actions = shell::download_action::kAll;
      if (!requested || std::find(actions.begin(), actions.end(), *requested) == actions.end())
        return Error("Invalid download action");
      action = *requested;
    }
    const auto error = modal_browser::RunMerlinDownloadAction(browser->GetProfile(), action, id);
    return error.empty() ? Ok() : Error(error);
  }
  if (name == shell::method::kAppearanceSet) {
    const auto* mode = args->FindString("mode");
    const auto* accent = args->FindString("accent");
    const auto reduced = args->FindBool("reduceMotion");
    const auto& modes = shell::appearance_mode::kAll;
    const auto& accents = shell::appearance_accent::kAll;
    if (!mode || std::find(modes.begin(), modes.end(), *mode) == modes.end() ||
        !accent || std::find(accents.begin(), accents.end(), *accent) == accents.end() || !reduced)
      return Error("Invalid appearance preference");
    browser->GetProfile()->GetPrefs()->SetDict("merlin.shell.appearance",
        Dict().Set("mode", *mode).Set("accent", *accent).Set("reduceMotion", *reduced));
    // Pages and native dialogs follow the same scheme as the shell.
    if (auto* theme = ThemeServiceFactory::GetForProfile(browser->GetProfile()))
      theme->SetBrowserColorScheme(*mode == shell::appearance_mode::kLight ? ThemeService::BrowserColorScheme::kLight
          : *mode == shell::appearance_mode::kDark ? ThemeService::BrowserColorScheme::kDark
          : ThemeService::BrowserColorScheme::kSystem);
    return Ok();
  }
  if (name == shell::method::kPermissionsAnswer || name == shell::method::kPromptsUpdate) {
    const auto* id = args->FindString("promptId");
    const auto* action = args->FindString("actionId");
    if (!id || (name == shell::method::kPermissionsAnswer && !action) || state->prompts.empty() ||
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
    if (name == shell::method::kPromptsUpdate) return Ok();
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
  if (name == shell::method::kFindFocus) {
    const auto focused = args->FindBool("focused");
    if (!focused) return Error("Missing find focus state");
    const auto id = *args->FindString("tabId");
    if (*focused && index == strip->active_index()) state->find_focused_tab = id;
    else if (state->find_focused_tab == id) state->find_focused_tab.clear();
  } else if (name == shell::method::kFindQuery) {
    const auto* text = args->FindString("text");
    const auto forward = args->FindBool("forward");
    if (!text || !forward || index != strip->active_index()) return Error("Find is only available in the current tab");
    auto* controller = FindBarController::From(browser);
    auto value = base::UTF8ToUTF16(*text);
    controller->find_bar()->SetFindTextAndSelectedRange(value, gfx::Range(value.size()));
    controller->OnUserChangedFindText(value);
    find_in_page::FindTabHelper::FromWebContents(contents)->StartFinding(value, *forward, false, true);
  } else if (name == shell::method::kTabsBookmark) {
    // The page the tab shows (WebKit's, not Chromium's hidden one) goes into
    // the Bookmarks Bar folder, which the bar and the sidebar show; without
    // `bookmarked` the star toggles.
    const auto bookmarked = args->FindBool("bookmarked");
    if (!modal_browser::SetPageBookmarked(contents, bookmarked.value_or(!modal_browser::IsPageBookmarked(contents))))
      return Error("This page cannot be bookmarked");
  } else if (name == shell::method::kTabsMute) {
    const auto muted = args->FindBool("muted");
    if (!muted) return Error("Missing muted state");
    SetTabAudioMuted(contents, *muted, TabMutedReason::kAudioIndicator, std::string());
    state->Changed();
  } else if (name == shell::method::kTabsMedia) {
    // The sidebar's player: the same as the page's own controls, or the
    // keyboard's media keys, would do.
    const auto* action = args->FindString("action");
    auto* session = content::MediaSession::GetIfExists(contents);
    if (!action) return Error("Missing media action");
    if (!session) return Error("This tab has no media");
    using Suspend = content::MediaSession::SuspendType;
    if (*action == shell::media_action::kPlay) session->Resume(Suspend::kUI);
    else if (*action == shell::media_action::kPause) session->Suspend(Suspend::kUI);
    else if (*action == shell::media_action::kNext) session->NextTrack();
    else if (*action == shell::media_action::kPrevious) session->PreviousTrack();
    else return Error("Unknown media action");
    state->Changed();
  } else if (name == shell::method::kNavigationHistory) {
    // The back and forward lists, for the menu a held or right-clicked
    // Back or Forward button shows. At most 50 entries each way.
    auto& controller = contents->GetController();
    const int current = controller.GetCurrentEntryIndex();
    const int first = std::max(0, current - 50);
    const int last = std::min(controller.GetEntryCount() - 1, current + 50);
    List entries;
    for (int i = first; i <= last; ++i) {
      auto* entry = controller.GetEntryAtIndex(i);
      entries.Append(Dict().Set("index", i).Set("title", base::UTF16ToUTF8(entry->GetTitleForDisplay()))
          .Set("url", entry->GetVirtualURL().spec()));
    }
    return Ok(base::Value(Dict().Set("current", current).Set("entries", std::move(entries))));
  } else if (name == shell::method::kNavigationGo) {
    const auto at = args->FindInt("index");
    auto& controller = contents->GetController();
    if (!at || *at < 0 || *at >= controller.GetEntryCount()) return Error("That page is no longer in this tab's history");
    if (*at != controller.GetCurrentEntryIndex()) controller.GoToIndex(*at);
  } else if (name == shell::method::kTabsSetEngineOverlay) {
    const auto* overlay = args->Find("overlay");
    if (!overlay || (!overlay->is_none() && !overlay->is_dict())) return Error("Invalid engine overlay");
    if (overlay->is_none()) {
      modal_browser::PageIdentity::Clear(contents);
    } else {
      const auto* engine = overlay->GetDict().FindString("engine");
      const auto* url = overlay->GetDict().FindString("url");
      const auto* title = overlay->GetDict().FindString("title");
      const GURL target(url ? *url : std::string());
      if (!engine || *engine != "webkit" || !title || !target.SchemeIsHTTPOrHTTPS() || title->size() > 64 * 1024)
        return Error("Invalid engine overlay");
      modal_browser::PageIdentity::Show(contents, target, base::UTF8ToUTF16(*title));
    }
    state->Changed();  // A restored WebKit page, now claimed, leaves the snapshot.
  } else if (name == shell::method::kTabsActivate) strip->ActivateTabAt(index);
  else if (name == shell::method::kTabsClose) strip->CloseWebContentsAt(index, TabCloseTypes::CLOSE_USER_GESTURE | TabCloseTypes::CLOSE_CREATE_HISTORICAL_TAB);
  else if (name == shell::method::kTabsPin) {
    auto pinned = args->FindBool("pinned");
    if (!pinned) return Error("Missing pinned state");
    strip->SetTabPinned(index, *pinned);
  } else if (name == shell::method::kTabsGroup) {
    // {groupId: string} joins that group; {groupId: null, title?} starts one.
    const auto* key = args->Find("groupId");
    if (!key || (!key->is_none() && !key->is_string())) return Error("Invalid group");
    std::optional<tab_groups::TabGroupId> group;
    if (key->is_string()) {
      group = modal_browser::FindGroup(strip, key->GetString());
      if (!group) return Error("That group has closed");
    }
    const auto* title = args->FindString("title");
    const std::string error = modal_browser::GroupTab(strip, index, group, title ? *title : std::string());
    if (!error.empty()) return Error(error.c_str());
  } else if (name == shell::method::kTabsUngroup) {
    const std::string error = modal_browser::UngroupTab(strip, index);
    if (!error.empty()) return Error(error.c_str());
  } else if (name == shell::method::kTabsMove) {
    const auto* before = args->Find("beforeId");
    if (!before || (!before->is_none() && !before->is_string())) return Error("Invalid tab destination");
    int target = before->is_none() ? strip->count() - 1 : FindTab(strip, &before->GetString());
    if (target < 0) return Error("Destination tab has closed");
    // A tab in a split view moves with the other side, as the tabs show them as one.
    if (const auto split = strip->GetSplitForTab(index)) {
      MoveSplit(strip, *split, before->is_none() ? -1 : target);
      return Ok();
    }
    if (!before->is_none() && target > index) --target;
    strip->MoveWebContentsAt(index, target, false);
  } else if (name == shell::method::kNavigationBack) {
    if (contents->GetController().CanGoBack()) contents->GetController().GoBack();
  } else if (name == shell::method::kNavigationForward) {
    if (contents->GetController().CanGoForward()) contents->GetController().GoForward();
  } else if (name == shell::method::kNavigationReload) contents->GetController().Reload(content::ReloadType::NORMAL, true);
  else if (name == shell::method::kNavigationStop) contents->Stop();
  else if (name == shell::method::kNavigationOpen) {
    auto* text = args->FindString("text");
    if (!text) return Error("Missing navigation text");
    GURL url = ResolveAddress(browser->GetProfile(), *text);
    if (!url.is_valid()) return Error("This address cannot be opened");
    contents->GetController().LoadURL(url, content::Referrer(), ui::PAGE_TRANSITION_TYPED, std::string());
  } else if (name == shell::method::kTabsSplit) {
    // A tab dropped on the page: it shows beside the tab it was dropped on
    // (`beside`, else the active tab), on the side it was dropped on, and
    // takes the focus. One command, so the page never shows the other tab
    // alone on the way.
    const auto* side = args->FindString("side");
    const auto& sides = shell::split_side::kAll;
    if (!side || std::find(sides.begin(), sides.end(), *side) == sides.end())
      return Error("Invalid split side");
    if (browser->GetType() != BrowserWindowInterface::TYPE_NORMAL) return Error("This window can't show a split view");
    if (const auto* beside = args->FindString("beside")) {
      const int at = FindTab(strip, beside);
      if (at < 0) return Error("That tab has closed");
      if (at == index) return Error("Choose another tab to show beside this one");
      if (at != strip->active_index()) strip->ActivateTabAt(at);
    }
    const int active = strip->active_index();
    if (active < 0 || index == active) return Error("Choose another tab to show beside this one");
    tabs::TabInterface* dropped = strip->GetTabAtIndex(index);
    // Splits hold two tabs: the dropped one replaces the other side.
    if (const auto current = strip->GetSplitForTab(active)) strip->RemoveSplit(*current);
    if (const auto other = strip->GetSplitForTab(strip->GetIndexOfTab(dropped))) strip->RemoveSplit(*other);
    const bool stacked = *side == shell::split_side::kTop || *side == shell::split_side::kBottom;
    const auto id = strip->AddToNewSplit({strip->GetIndexOfTab(dropped)},
        split_tabs::SplitTabVisualData(stacked ? split_tabs::SplitTabLayout::kStacked : split_tabs::SplitTabLayout::kSideBySide),
        split_tabs::SplitTabCreatedSource::kDragAndDropTab);
    const auto members = strip->GetSplitData(id)->ListTabs();
    const bool first = *side == shell::split_side::kLeft || *side == shell::split_side::kTop;
    if (!members.empty() && (members.front() == dropped) != first) strip->ReverseTabsInSplit(id);
    strip->ActivateTabAt(strip->GetIndexOfTab(dropped));
  } else if (name == shell::method::kTabsUnsplit) {
    // Both tabs stay open, side by side in the tabs, and the page shows this one alone.
    const auto split = strip->GetSplitForTab(index);
    if (!split) return Error("This tab isn't in a split view");
    strip->RemoveSplit(*split);
  } else if (name == shell::method::kTabsDetach) {
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
  if (tab == kPeekView) {
    auto* contents = modal_browser::MerlinPeekContents(state->browser());
    NSView* peek = contents ? contents->GetNativeView().GetNativeNSView() : nil;
    if (!peek || (peek.window && peek.window != container.window)) return nullptr;
    if (peek.superview != container) [container addSubview:peek];
    DisableImplicitAnimations(peek);
    peek.frame = container.bounds;
    peek.hidden = NO;  // As in PlacePage.
    // The shell insets the page inside its card (PeekOverlay.tsx): rounded to
    // the card's radius less the inset (radius.dialog - space.sm), so the
    // corners are concentric. PromoteMerlinPeek squares them again.
    peek.wantsLayer = YES;
    peek.layer.cornerRadius = 10;
    peek.layer.cornerCurve = kCACornerCurveContinuous;
    peek.layer.masksToBounds = YES;
    contents->WasShown();
    NSResponder* responder = container.window.firstResponder;
    if (![responder isKindOfClass:NSText.class] && ![responder isKindOfClass:NSTextField.class]) contents->Focus();
    return (__bridge void*)peek;
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
  if (tab == kPeekView) {
    auto* contents = modal_browser::MerlinPeekContents(state->browser());
    NSView* peek = contents ? contents->GetNativeView().GetNativeNSView() : nil;
    if (peek.superview == (__bridge NSView*)parent) [peek removeFromSuperview];
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

namespace {
// A bridge reply ({"ok", "value"} or {"ok": false, "error"}), as a shell call's answer.
void AnswerShellCall(modal_browser::ShellCallDone done, const Dict& reply) {
  if (reply.FindBool("ok").value_or(false)) {
    const base::Value* value = reply.Find("value");
    std::move(done).Run(true, value ? base::WriteJson(*value).value_or("null") : "null");
    return;
  }
  const auto* error = reply.FindString("error");
  std::move(done).Run(false, error && !error->empty() ? *error : "The engine call failed");
}
}  // namespace

namespace {
// test.shell, which only shell-call reaches (never React): a window's
// interface state, or a failure made on purpose to see it recover.
void RunShellTest(BrowserWindowInterface* browser, const Dict& args, modal_browser::ShellCallDone done) {
  auto* state = FindWindow(WindowId(browser).c_str());
  const auto* action = args.FindString("action");
  namespace test = shell::test_shell_action;
  if (!action) {
    std::move(done).Run(false, "test.shell needs an action");
  } else if (*action == test::kState) {
    // This window's, and every window's by ID.
    Dict windows;
    for (const auto& [id, window] : GetRegistry().windows)
      windows.Set(id, Dict().Set("ready", window->shell_ready).Set("failures", window->shell_failures));
    Dict value = Dict().Set("ready", state->shell_ready).Set("failures", state->shell_failures)
        .Set("lastError", state->shell_last_error).Set("windows", std::move(windows));
    std::move(done).Run(true, base::WriteJson(value).value_or("null"));
  } else if (*action == test::kThrowInRender || *action == test::kThrowInTimer) {
    // The interface throws while drawing (its error boundary catches it), or
    // from a timer, outside React (the host reloads the bridge).
    GetRegistry().Emit(Dict().Set("type", "test.throw").Set("windowId", WindowId(browser))
        .Set("where", *action == test::kThrowInRender ? "render" : "timer"));
    std::move(done).Run(true, "null");
  } else if (*action == test::kReloadBridge) {
    if (!modal_browser::ReloadReactShell("test.shell reloadBridge")) {
      std::move(done).Run(false, "This host can't reload its interface");
      return;
    }
    std::move(done).Run(true, "null");
  } else {
    std::move(done).Run(false, "Unknown test.shell action");
  }
}
}  // namespace

namespace modal_browser {
void RunShellCallForTesting(BrowserWindowInterface* browser, const std::string& method,
                            const std::string& args_json, ShellCallDone done) {
  if (!Enabled() || !browser || !FindWindow(WindowId(browser).c_str())) {
    std::move(done).Run(false, "This window has no React shell");
    return;
  }
  auto args = base::JSONReader::ReadDict(args_json, base::JSON_PARSE_RFC);
  if (!args) {
    std::move(done).Run(false, "Expected an argument object");
    return;
  }
  const std::string window = WindowId(browser);
  if (method == shell::method::kTestShell) {
    RunShellTest(browser, *args, std::move(done));
    return;
  }
  const auto& requests = shell::method::kRequests;
  const bool request = std::find(requests.begin(), requests.end(), method) != requests.end();
  auto& registry = GetRegistry();
  Registry::ReplyKey key;
  if (request) {
    // As EngineClient.request does: a fresh ID, answered by a "reply" event.
    if (args->Find("requestId")) {
      std::move(done).Run(false, "shell-call adds the request ID itself");
      return;
    }
    static uint64_t next_request = 0;
    key = {window, "browserctl-" + base::NumberToString(++next_request)};
    args->Set("requestId", key.second);
    registry.reply_waiters.emplace(key, base::BindOnce(&AnswerShellCall, std::move(done)));
    // A request that never answers (a folder picker nobody dismisses) fails.
    content::GetUIThreadTaskRunner({})->PostDelayedTask(FROM_HERE, base::BindOnce([](Registry::ReplyKey key) {
      GetRegistry().FinishReplyWaiter(key, Dict().Set("ok", false).Set("error", "The request did not answer within 30 seconds"));
    }, key), base::Seconds(30));
  }
  // The same entry point, argument checks and replies as React's calls.
  char* raw = Call(window.c_str(), method.c_str(), base::WriteJson(*args).value_or("{}").c_str());
  auto reply = base::JSONReader::ReadDict(raw ? raw : "", base::JSON_PARSE_RFC);
  ReleaseString(raw);
  if (!reply) reply = Dict().Set("ok", false).Set("error", "The engine's reply was not JSON");
  if (!request) {
    AnswerShellCall(std::move(done), *reply);
  } else if (!reply->FindBool("ok").value_or(false)) {
    // Refused before it started: no reply event will follow.
    registry.FinishReplyWaiter(key, *reply);
  }
}
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
void ShellPageScrolled(BrowserWindowInterface* browser) {
  if (!Enabled() || !browser) return;
  if (auto* state = FindWindow(WindowId(browser).c_str())) state->PageScrolled();
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
void ShowShellSessionCrashedPrompt(BrowserWindowInterface* browser) {
  if (!browser || browser->GetProfile()->IsOffTheRecord()) return;
  // As Chromium's bubble does: until this is answered, the last session stays
  // marked as crashed, so it can still be restored.
  std::unique_ptr<ExitTypeService::CrashedLock> lock;
  if (auto* exit_type = ExitTypeService::GetInstanceForProfile(browser->GetProfile()))
    lock = exit_type->CreateCrashedLock();
  ShowShellPrompt(browser, Dict().Set("kind", "confirm").Set("origin", "Merlin")
      .Set("title", "Restore your tabs?")
      .Set("message", "Merlin quit unexpectedly. The windows and tabs you had open can open again.")
      .Set("actions", List()
          .Append(Dict().Set("id", "dismiss").Set("label", "Not now").Set("emphasis", "normal"))
          .Append(Dict().Set("id", "restore").Set("label", "Restore tabs").Set("emphasis", "primary"))),
      // A window that closes first answers with no action, before it goes.
      base::BindOnce([](BrowserWindowInterface* browser, std::unique_ptr<ExitTypeService::CrashedLock>,
                        ShellPromptReply reply) {
        if (reply.action != "restore" || browser_shutdown::HasShutdownStarted() || browser->IsDeleteScheduled())
          return;
        SessionRestore::RestoreSessionAfterCrash(browser);
      }, browser, std::move(lock)));
}
}  // namespace modal_browser
