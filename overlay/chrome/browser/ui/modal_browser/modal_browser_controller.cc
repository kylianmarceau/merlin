// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// Every Chromium API used here was checked against the 156.0.8078.48 sources;
// file:line references are in docs/ARCHITECTURE.md.

#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"

#include <algorithm>

#include <set>

#include "base/command_line.h"
#include "base/environment.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/rand_util.h"
#include "base/strings/escape.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "build/build_config.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/autocomplete/autocomplete_classifier_factory.h"
#include "chrome/browser/bookmarks/bookmark_model_factory.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/history/history_service_factory.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "chrome/browser/prefs/session_startup_pref.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_element_identifiers.h"
#include "chrome/browser/ui/browser_tabrestore.h"
#include "chrome/browser/ui/browser_tabstrip.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/create_browser_window.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/bubble_anchor_util.h"
#include "chrome/browser/ui/color/chrome_color_id.h"
#include "chrome/browser/ui/modal_browser/browserctl_server.h"
#include "chrome/browser/ui/modal_browser/external_editor.h"
#include "chrome/browser/ui/modal_browser/hint_overlay_view.h"
#include "chrome/browser/ui/modal_browser/merlin_address_editor.h"
#include "chrome/browser/ui/modal_browser/merlin_ctrl_tab.h"
#include "chrome/browser/ui/modal_browser/merlin_downloads.h"
#include "chrome/browser/ui/modal_browser/merlin_page_color.h"
#include "chrome/browser/ui/modal_browser/merlin_pages.h"
#include "chrome/browser/ui/modal_browser/merlin_restyle.h"
#include "chrome/browser/ui/modal_browser/merlin_downloads_button.h"
#include "chrome/browser/ui/modal_browser/merlin_safety_controls.h"
#include "chrome/browser/ui/modal_browser/merlin_start_page.h"
#include "chrome/browser/ui/modal_browser/merlin_tab_bar.h"
#include "chrome/browser/ui/modal_browser/merlin_theme.h"
#include "chrome/browser/ui/modal_browser/merlin_toolbar.h"
#include "chrome/browser/ui/modal_browser/merlin_urls.h"
#include "chrome/browser/ui/modal_browser/status_view.h"
#include "chrome/browser/ui/modal_browser/workspace_store.h"
#include "chrome/browser/ui/page_info/page_info_dialog.h"
#include "chrome/browser/ui/tabs/split_tab_metrics.h"
#include "chrome/browser/ui/tabs/tab_change_type.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_group_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model_delegate.h"
#include "chrome/browser/ui/tabs/vertical_tab_strip_state_controller.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/interaction/browser_elements_views.h"
#include "chrome/browser/ui/views/location_bar/location_bar_view.h"
#include "components/download/public/common/download_item.h"
// Part of //chrome/browser/ui/views/toolbar, which depends on this target.
#include "chrome/browser/ui/views/toolbar/toolbar_view.h"  // nogncheck
#include "chrome/common/chrome_isolated_world_ids.h"
#include "chrome/common/pref_names.h"
#include "components/bookmarks/browser/bookmark_model.h"
#include "components/bookmarks/browser/bookmark_node.h"
#include "components/favicon/content/content_favicon_driver.h"
#include "components/history/core/browser/history_service.h"
#include "components/history/core/browser/history_types.h"
#include "components/input/native_web_keyboard_event.h"
#include "components/keyed_service/core/service_access_type.h"
#include "components/omnibox/browser/autocomplete_classifier.h"
#include "components/omnibox/browser/autocomplete_match.h"
#include "components/omnibox/browser/omnibox_pref_names.h"
#include "components/performance_manager/public/user_tuning/prefs.h"
#include "components/prefs/pref_service.h"
#include "components/sessions/core/serialized_navigation_entry.h"
#include "components/sessions/core/serialized_user_agent_override.h"
#include "components/split_tabs/split_tab_id.h"
#include "components/split_tabs/split_tab_visual_data.h"
#include "components/tab_groups/tab_group_color.h"
#include "components/tab_groups/tab_group_id.h"
#include "components/tab_groups/tab_group_visual_data.h"
#include "components/tabs/public/tab_group.h"
#include "components/tabs/public/split_tab_data.h"
#include "components/tabs/public/tab_interface.h"
#include "components/url_formatter/url_fixer.h"
#include "components/url_formatter/url_formatter.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/download_manager.h"
#include "content/public/browser/focused_node_details.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/page.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/url_constants.h"
#include "third_party/blink/public/common/input/web_input_event.h"
#include "third_party/blink/public/common/input/web_mouse_event.h"
#include "third_party/metrics_proto/omnibox_event.pb.h"
#include "ui/base/accelerators/accelerator_manager.h"
#include "ui/base/base_window.h"
#include "ui/base/clipboard/clipboard.h"
#include "ui/base/clipboard/scoped_clipboard_writer.h"
#include "ui/base/models/tree_node_iterator.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"
#include "ui/compositor/layer.h"
#include "ui/display/display.h"
#include "ui/display/screen.h"
#include "ui/events/base_event_utils.h"
#include "ui/events/event_constants.h"
#include "ui/events/keycodes/dom/dom_key.h"
#include "ui/events/keycodes/dom/keycode_converter.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/views/background.h"
#include "ui/views/focus/focus_manager.h"
#include "ui/views/layout/box_layout_view.h"
#include "ui/views/layout/flex_layout_types.h"
#include "ui/views/view_class_properties.h"
#include "url/gurl.h"
#include "url/url_constants.h"

namespace modal_browser {

DEFINE_USER_DATA(ModalBrowserController);

// Keeps a view hidden that Chromium shows by itself. Hidden outright, not
// squeezed to no width: the toolbar would count a squeezed button as
// overflowed and show its » menu.
class KeepHidden : public views::ViewObserver {
 public:
  explicit KeepHidden(views::View* view) : view_(view) {
    observation_.Observe(view);
    view->SetVisible(false);
  }
  ~KeepHidden() override = default;

  const views::View* view() const { return view_; }

  // views::ViewObserver:
  void OnViewVisibilityChanged(views::View* observed,
                               views::View* starting_from,
                               bool visible) override {
    // SetVisible has updated the view before it notifies, so hiding it
    // again from here leaves it consistent.
    if (observed == starting_from && visible) {
      observed->SetVisible(false);
    }
  }
  void OnViewIsDeleting(views::View* observed) override {
    observation_.Reset();
    view_ = nullptr;
  }

 private:
  raw_ptr<views::View> view_;
  base::ScopedObservation<views::View, views::ViewObserver> observation_{this};
};

namespace {

// The view in `root`'s tree tagged with `id`. BrowserElementsViews only
// tracks some toolbar elements, so the toolbar's own buttons are found here.
views::View* FindByElementId(views::View* root, ui::ElementIdentifier id) {
  if (!root) {
    return nullptr;
  }
  if (root->GetProperty(views::kElementIdentifierKey) == id) {
    return root;
  }
  for (views::View* child : root->children()) {
    if (views::View* found = FindByElementId(child, id)) {
      return found;
    }
  }
  return nullptr;
}

// Chromium's back, forward, reload and home in the toolbar row: native
// buttons, or (with the WebUI toolbar buttons that Chromium's field-trial
// testing config turns on in non-official builds) one small web view that
// draws them.
// Keeps `view` in the toolbar row's layout but takes it off screen:
//  * kAnchor: 1 px wide, transparent and not clickable, so it stays drawn.
//    Bubbles anchor to the ⋮ and account buttons, and
//    AppMenuButton::GetAnchor() CHECKs when the button is not drawn and
//    the fallback anchor does not exist yet (the "Restore pages?" bubble
//    at startup after a crash). Those bubbles open at the row's right end.
//  * kNoWidth: no width, which FlexLayout shows by hiding the view while
//    keeping it in its proposed layout. For the WebUI back/forward view,
//    whose overflow check reads its bounds from that layout and crashes
//    when the view is hidden outright.
// Collapses again if the toolbar redoes its layout rules.
enum class Collapse { kAnchor, kNoWidth };

void CollapseInRow(views::View* view, Collapse how) {
  const int width = how == Collapse::kAnchor ? 1 : 0;
  if (view->width() == width &&
      view->GetFocusBehavior() == views::View::FocusBehavior::NEVER) {
    return;
  }
  view->SetProperty(views::kFlexBehaviorKey,
                    views::FlexSpecification(base::BindRepeating(
                        [](int w, const views::View*,
                           const views::SizeBounds&) {
                          return gfx::Size(w, w);
                        },
                        width)));
  view->SetProperty(views::kMarginsKey, gfx::Insets());
  view->SetFocusBehavior(views::View::FocusBehavior::NEVER);
  if (how == Collapse::kAnchor) {
    view->SetCanProcessEventsWithinSubtree(false);
    if (!view->layer()) {
      view->SetPaintToLayer();
    }
    view->layer()->SetOpacity(0.0f);
  }
  if (!view->GetVisible()) {
    view->SetVisible(true);
  }
  // A changed layout property does not re-lay the row by itself.
  if (view->parent()) {
    view->parent()->InvalidateLayout();
  }
}

bool IsWebUIToolbarView(const views::View* view) {
  return std::string_view(view->GetClassName()) == "WebUIToolbarWebView";
}

std::vector<views::View*> ChromiumNavViews(views::View* row) {
  std::vector<views::View*> views;
  for (views::View* child : row->children()) {
    if (IsWebUIToolbarView(child)) {
      views.push_back(child);
    }
  }
  for (ui::ElementIdentifier id :
       {kToolbarBackButtonElementId, kToolbarForwardButtonElementId,
        kReloadButtonElementId, kToolbarHomeButtonElementId}) {
    if (views::View* button = FindByElementId(row, id)) {
      views.push_back(button);
    }
  }
  return views;
}

// Bounds on what crosses into Rust from tabs and the clipboard.
constexpr size_t kMaxTabTextBytes = 2048;
constexpr size_t kMaxClipboardBytes = 8 * 1024;

WindowOpenDisposition ToWindowOpenDisposition(ffi::OpenDisposition d) {
  switch (d) {
    case ffi::OpenDisposition::CurrentTab:
      return WindowOpenDisposition::CURRENT_TAB;
    case ffi::OpenDisposition::NewForegroundTab:
      return WindowOpenDisposition::NEW_FOREGROUND_TAB;
    case ffi::OpenDisposition::NewBackgroundTab:
      return WindowOpenDisposition::NEW_BACKGROUND_TAB;
    case ffi::OpenDisposition::NewWindow:
      return WindowOpenDisposition::NEW_WINDOW;
  }
  return WindowOpenDisposition::CURRENT_TAB;
}

// Defence in depth: Rust already refuses these, but the browser side never
// navigates to script or embedded-content URLs from a command.
// Memory Saver unloads tabs left alone for a while and reloads them when
// shown. A default only: the Settings switch stores the user's choice,
// which wins.
void SetMemorySaverDefault(PrefService* local_state) {
  namespace tuning = performance_manager::user_tuning::prefs;
  if (local_state) {
    local_state->SetDefaultPrefValue(
        tuning::kMemorySaverModeState,
        base::Value(static_cast<int>(tuning::MemorySaverModeState::kEnabled)));
  }
}

bool IsAllowedCommandUrl(const GURL& url) {
  return url.is_valid() && !url.SchemeIs(url::kJavaScriptScheme) &&
         !url.SchemeIs(url::kDataScheme) && !url.SchemeIs(url::kBlobScheme) &&
         !url.SchemeIs(url::kFileSystemScheme);
}

// Links a page offers may only be opened in a new tab if a page could
// navigate to them itself: http(s), or file: from a file: page. Browser-
// initiated navigation would otherwise let a page smuggle chrome:// URLs.
bool IsAllowedLinkUrl(const GURL& link, const GURL& page) {
  if (!link.is_valid()) {
    return false;
  }
  if (link.SchemeIsHTTPOrHTTPS()) {
    return true;
  }
  return link.SchemeIsFile() && page.SchemeIsFile();
}

std::string Bounded(std::string s, size_t max) {
  if (s.size() > max) {
    // Cut on a character boundary so the result stays valid UTF-8.
    base::TruncateUTF8ToByteSize(s, max, &s);
  }
  return s;
}

std::u16string ToU16(std::string_view s) {
  return base::UTF8ToUTF16(s);
}

std::u16string Elide(const std::u16string& s, size_t max) {
  return s.size() <= max ? s : s.substr(0, max - 1) + u"\u2026";
}

// Markdown link text and destination, with the characters that would end
// them escaped.
std::u16string MarkdownLink(std::u16string title, const GURL& url) {
  std::u16string text;
  for (char16_t c : title) {
    if (c == u'[' || c == u']' || c == u'\\') {
      text += u'\\';
    }
    text += c;
  }
  std::string dest = url.spec();
  base::ReplaceSubstringsAfterOffset(&dest, 0, "(", "%28");
  base::ReplaceSubstringsAfterOffset(&dest, 0, ")", "%29");
  base::ReplaceSubstringsAfterOffset(&dest, 0, " ", "%20");
  return u"[" + text + u"](" + base::UTF8ToUTF16(dest) + u")";
}

// Bounds on lists handed to the palette.
constexpr int kMaxHistoryItems = 1000;
constexpr size_t kMaxBookmarkItems = 5000;
constexpr size_t kMaxExports = 4;
// Frames asked for hint targets at most (ads can nest many).
constexpr size_t kMaxHintFrames = 64;
// Saves after tab changes are batched over this long.
constexpr base::TimeDelta kAutosaveDelay = base::Seconds(3);

std::string ToStd(const ::rust::String& s) {
  return std::string(s.data(), s.size());
}

split_tabs::SplitTabLayout ToLayout(ffi::SplitLayout layout) {
  return layout == ffi::SplitLayout::Stacked
             ? split_tabs::SplitTabLayout::kStacked
             : split_tabs::SplitTabLayout::kSideBySide;
}

int64_t NowSeconds() {
  return base::Time::Now().ToTimeT();
}

// Chromium's tab group colors by the names workspace files use.
constexpr std::pair<std::string_view, tab_groups::TabGroupColorId>
    kGroupColors[] = {
        {"grey", tab_groups::TabGroupColorId::kGrey},
        {"blue", tab_groups::TabGroupColorId::kBlue},
        {"red", tab_groups::TabGroupColorId::kRed},
        {"yellow", tab_groups::TabGroupColorId::kYellow},
        {"green", tab_groups::TabGroupColorId::kGreen},
        {"pink", tab_groups::TabGroupColorId::kPink},
        {"purple", tab_groups::TabGroupColorId::kPurple},
        {"cyan", tab_groups::TabGroupColorId::kCyan},
        {"orange", tab_groups::TabGroupColorId::kOrange},
};

std::string_view GroupColorName(tab_groups::TabGroupColorId color) {
  for (const auto& [name, id] : kGroupColors) {
    if (id == color) {
      return name;
    }
  }
  return "grey";
}

tab_groups::TabGroupColorId GroupColorFromName(std::string_view name) {
  for (const auto& [n, id] : kGroupColors) {
    if (n == name) {
      return id;
    }
  }
  return tab_groups::TabGroupColorId::kGrey;
}

// Saved window bounds moved fully onto the display they mostly cover, or
// empty when no display shows enough of them (a monitor since removed).
gfx::Rect OnScreenBounds(const gfx::Rect& saved) {
  if (saved.IsEmpty()) {
    return gfx::Rect();
  }
  display::Screen* screen = display::Screen::Get();
  if (!screen) {
    return gfx::Rect();
  }
  const display::Display display = screen->GetDisplayMatching(saved);
  const gfx::Rect work = display.work_area();
  gfx::Rect visible = work;
  visible.Intersect(saved);
  if (visible.width() < 100 || visible.height() < 100) {
    return gfx::Rect();
  }
  gfx::Rect bounds = saved;
  bounds.AdjustToFit(work);
  return bounds;
}

// The set of windows that want browserctl, and the one server they share.
// It listens while at least one normal window with browserctl enabled is
// open.
class BrowserctlService {
 public:
  static BrowserctlService& Get() {
    static base::NoDestructor<BrowserctlService> service;
    return *service;
  }

  void Update(ModalBrowserController* controller, bool wants) {
    if (wants) {
      wanting_.insert(controller);
    } else {
      wanting_.erase(controller);
    }
    if (!wanting_.empty() && !server_) {
      server_ = std::make_unique<BrowserctlServer>(
          BrowserctlServer::DefaultSocketPath(),
          base::BindRepeating(&ModalBrowserController::HandleBrowserctlRequest),
          base::BindOnce([](std::string error) {
            if (!error.empty()) {
              LOG(WARNING) << "browserctl: " << error;
            }
          }));
    } else if (wanting_.empty()) {
      server_.reset();
    }
  }

  bool Wants(ModalBrowserController* controller) const {
    return wanting_.contains(controller);
  }

 private:
  std::set<raw_ptr<ModalBrowserController>> wanting_;
  std::unique_ptr<BrowserctlServer> server_;
};

}  // namespace

ModalBrowserController::ModalBrowserController(BrowserWindowInterface* browser,
                                               BrowserView* browser_view)
    : browser_(browser),
      browser_view_(browser_view),
      status_(std::make_unique<StatusHost>(browser_view)),
      palette_(std::make_unique<PaletteHost>(browser_view, this)),
      hints_(std::make_unique<HintHost>(browser_view)),
      scoped_unowned_user_data_(browser->GetUnownedUserDataHost(), *this) {
  browser_->GetTabStripModel()->AddObserver(this);
  ObserveActiveContents();
  router_.SetWindow(browser_->GetProfile()->IsOffTheRecord());
  {
    std::unique_ptr<base::Environment> env = base::Environment::Create();
    router_.SetEnvironment(env->GetVar("VISUAL").value_or(""),
                           env->GetVar("EDITOR").value_or(""));
  }
  if (base::CommandLine::ForCurrentProcess()->HasSwitch(
          kUpstreamDefaultsSwitch)) {
    return;
  }
  merlin_ui_ = true;
  ctrl_tab_ = std::make_unique<CtrlTabSwitcher>(browser_, browser_view_);
  InstallMerlinTheme();
  InstallMerlinStartPage();
  InstallMerlinPages();
  SetMerlinStartAsNewTabDefault(browser_->GetProfile());
  status_->SetCardMode(true);
  tab_bar_host_ = std::make_unique<MerlinTabBarHost>(browser_, browser_view_);
  page_color_ = std::make_unique<PageColorSampler>(base::BindRepeating(
      &ModalBrowserController::ApplyPageColor, base::Unretained(this)));
  page_color_->Watch(ActiveContents());
  {
    // Defaults only: a user's or a policy's choice still wins. The address
    // field's AI Mode entry point goes (it sends the query to Google), and
    // the download bubble no longer pops open: the status bar shows
    // progress and :palette downloads lists the files.
    PrefService* prefs = browser_->GetProfile()->GetPrefs();
    prefs->SetDefaultPrefValue(omnibox::kAIModeSettings, base::Value(1));
    prefs->SetDefaultPrefValue(prefs::kDownloadBubblePartialViewEnabled,
                               base::Value(false));
    // Merlin draws its own forward button; Chromium's stays unpinned.
    prefs->SetDefaultPrefValue(prefs::kShowForwardButton, base::Value(false));
    // Ctrl-Tab goes to the tab used last, as in Dia.
    CtrlTabSwitcher::SetDefaultOrder(prefs);
  }
  SetMemorySaverDefault(g_browser_process->local_state());
  // The download count needs the download manager; start it after the
  // window is up instead of during startup.
  content::GetUIThreadTaskRunner({base::TaskPriority::BEST_EFFORT})
      ->PostTask(FROM_HERE,
                 base::BindOnce(&ModalBrowserController::StartWatchingDownloads,
                                weak_factory_.GetWeakPtr()));
  {
    // The sidebar is a slim rail that opens to names on hover, unless the
    // user chose otherwise (these set defaults only).
    PrefService* prefs = browser_->GetProfile()->GetPrefs();
    prefs->SetDefaultPrefValue(prefs::kVerticalTabsCollapsedState,
                               base::Value(true));
    prefs->SetDefaultPrefValue(prefs::kVerticalTabsExpandOnHoverEnabled,
                               base::Value(true));
    // Chromium reads the collapsed state before this controller exists, so
    // a first run collapses explicitly; after that the user's last state is
    // stored and wins.
    auto* state = tabs::VerticalTabStripStateController::From(browser_.get());
    if (state && !prefs->HasPrefPath(prefs::kVerticalTabsCollapsedState) &&
        !state->IsCollapsed()) {
      state->RequestCollapse(true);
    }
  }
  if (auto* state =
          tabs::VerticalTabStripStateController::From(browser_.get())) {
    tab_layout_subscription_ = state->RegisterOnModeChanged(base::BindRepeating(
        [](ModalBrowserController* self,
           tabs::VerticalTabStripStateController*) {
          self->OnTabLayoutChanged();
        },
        base::Unretained(this)));
  }
  OnTabLayoutChanged();
  // Tabs in a sidebar unless the config or the user says otherwise; the
  // config file can change this default once it has been read.
  SetVerticalTabsDefault(router_.vertical_tabs_default());
  SetTabsHiddenDefault(router_.hide_tabs_default());
  ApplyConfigToBrowser();
  LoadConfig(/*announce=*/false);
}

ModalBrowserController::~ModalBrowserController() {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  BrowserctlService::Get().Update(this, false);
  if (accelerator_focus_manager_ &&
      accelerator_focus_manager_ == browser_view_->GetFocusManager()) {
    accelerator_focus_manager_->UnregisterAccelerators(this);
  }
  accelerator_focus_manager_ = nullptr;
  if (safety_controls_) {
    auto removed =
        safety_controls_->parent()->RemoveChildViewT(safety_controls_.get());
    safety_controls_ = nullptr;
  }
  if (downloads_button_) {
    auto removed =
        downloads_button_->parent()->RemoveChildViewT(downloads_button_.get());
    downloads_button_ = nullptr;
  }
  // Before the tab strip model and the window go.
  page_color_.reset();
  tab_bar_host_.reset();
  download_notifier_.reset();
  browser_->GetTabStripModel()->RemoveObserver(this);
  Observe(nullptr);
}

// static
ModalBrowserController* ModalBrowserController::From(
    BrowserWindowInterface* browser) {
  return browser ? Get(browser->GetUnownedUserDataHost()) : nullptr;
}

bool ModalBrowserController::PreHandleKeyDown(
    const input::NativeWebKeyboardEvent& event) {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  if (!ActiveContents()) {
    return false;
  }
  // Messages last until the next key, as in Vim. Actions from this key may
  // show a new one.
  status_->ClearMessage();
  const std::string dom_key =
      ui::KeycodeConverter::DomKeyToKeyString(ui::DomKey(event.dom_key));
  const int modifiers = event.GetModifiers();
  KeyDown key;
  key.dom_key = dom_key;
  key.shift = modifiers & blink::WebInputEvent::kShiftKey;
  key.ctrl = modifiers & blink::WebInputEvent::kControlKey;
  key.alt = modifiers & blink::WebInputEvent::kAltKey;
  key.meta = modifiers & blink::WebInputEvent::kMetaKey;
  // RenderWidgetHostImpl does not pre-handle IME events (skip_if_unhandled),
  // so this is normally false here; pass it on as a second safeguard.
  key.ime_composing = event.skip_if_unhandled;
#if BUILDFLAG(IS_MAC)
  const bool address_chord = key.meta && !key.ctrl;
#else
  const bool address_chord = key.ctrl && !key.meta;
#endif
  if (merlin_ui_ && address_chord && !key.alt && !key.shift &&
      (dom_key == "l" || dom_key == "L")) {
    EditAddress();
    return true;
  }
  return router_.OnKeyDown(key, CurrentFocus(), *this);
}

std::string ModalBrowserController::RunCommandLine(std::string_view line) {
  return router_.OnCommandLineSubmitted(line, *this);
}

bool ModalBrowserController::AcceleratorPressed(
    const ui::Accelerator& accelerator) {
  if (accelerator.key_code() == ui::VKEY_TAB) {
    if (!ctrl_tab_) {
      return false;
    }
    ctrl_tab_->Cycle(/*forward=*/!accelerator.IsShiftDown());
    return true;
  }
  if (accelerator.key_code() == ui::VKEY_K) {
    RunCommandLine("palette menu");
    return true;
  }
  SetTabsHidden(ffi::Switch::Toggle);
  return true;
}

bool ModalBrowserController::CanHandleAccelerators() const {
  return true;
}

void ModalBrowserController::RegisterAccelerators() {
  views::FocusManager* focus_manager = browser_view_->GetFocusManager();
  if (!focus_manager || focus_manager == accelerator_focus_manager_) {
    return;
  }
  accelerator_focus_manager_ = focus_manager;
  // Cmd-S (Ctrl-S elsewhere) hides the tabs, as in Dia. Only after the page
  // had the key: a site that saves with Cmd-S (Docs, Figma) still does.
  // Save Page As moves to Shift-Cmd-S (patches/0012).
  focus_manager->RegisterAccelerator(
      ui::Accelerator(ui::VKEY_S, ui::EF_PLATFORM_ACCELERATOR),
      ui::AcceleratorManager::kNormalPriority, this);
  // Cmd-K (Ctrl-K elsewhere) opens Merlin's menu, with modal browsing on or
  // off: every Merlin command is a search away without its keys. Also only
  // after the page: sites with their own Cmd-K palette keep it.
  focus_manager->RegisterAccelerator(
      ui::Accelerator(ui::VKEY_K, ui::EF_PLATFORM_ACCELERATOR),
      ui::AcceleratorManager::kNormalPriority, this);
  // Ctrl-Tab and Ctrl-Shift-Tab: high priority runs before Chromium's Tab >
  // Select Next Tab command and before the page, as Chromium's own did.
  if (ctrl_tab_) {
    for (int flags : {ui::EF_CONTROL_DOWN,
                      ui::EF_CONTROL_DOWN | ui::EF_SHIFT_DOWN}) {
      focus_manager->RegisterAccelerator(
          ui::Accelerator(ui::VKEY_TAB, flags),
          ui::AcceleratorManager::kHighPriority, this);
    }
  }
}

bool ModalBrowserController::TabsInSidebar() const {
  auto* state = tabs::VerticalTabStripStateController::From(browser_.get());
  return state && state->ShouldDisplayVerticalTabs();
}

// static
void ModalBrowserController::ReloadConfigInAllWindows(
    ModalBrowserController* announce) {
  GlobalBrowserCollection::GetInstance()->ForEach(
      [announce](BrowserWindowInterface* browser) {
        if (ModalBrowserController* c = From(browser)) {
          c->LoadConfig(/*announce=*/c == announce);
        }
        return true;
      });
}

std::vector<ModalInputRouter::Binding> ModalBrowserController::KeyBindings()
    const {
  return router_.key_bindings();
}

std::string ModalBrowserController::HintChars() const {
  return router_.hint_chars();
}

// -- BrowserOps: navigation and tabs -----------------------------------------

void ModalBrowserController::Navigate(const GURL& url,
                                      ffi::OpenDisposition disposition) {
  browser_->OpenGURL(url, ToWindowOpenDisposition(disposition));
}

void ModalBrowserController::OpenUrl(std::string_view url,
                                     ffi::OpenDisposition disposition) {
  const GURL gurl = url_formatter::FixupURL(std::string(url), std::string());
  if (!IsAllowedCommandUrl(gurl)) {
    ShowMessage(ffi::MessageLevel::Error, "Cannot open that URL");
    return;
  }
  Navigate(gurl, disposition);
}

void ModalBrowserController::OpenSearch(std::string_view terms,
                                        ffi::OpenDisposition disposition) {
  // Same classification the omnibox uses, so the user's default search
  // engine and keyword settings apply.
  AutocompleteMatch match;
  AutocompleteClassifierFactory::GetForProfile(browser_->GetProfile())
      ->Classify(base::UTF8ToUTF16(terms), /*in_keyword_mode=*/false,
                 /*allow_exact_keyword_match=*/false,
                 metrics::OmniboxEventProto::OTHER, &match,
                 /*alternate_nav_url=*/nullptr);
  if (!IsAllowedCommandUrl(match.destination_url)) {
    ShowMessage(ffi::MessageLevel::Error, "No search engine result");
    return;
  }
  Navigate(match.destination_url, disposition);
}

void ModalBrowserController::NewTab() {
  chrome::NewTab(browser_, NewTabTypes::kNewTabCommand);
}

void ModalBrowserController::CloseTab() {
  chrome::CloseTab(browser_);
}

void ModalBrowserController::RestoreTab() {
  chrome::RestoreTab(browser_);
}

void ModalBrowserController::SelectNextTab(int count) {
  const int tabs = browser_->GetTabStripModel()->count();
  for (int i = 0; i < count % std::max(tabs, 1); ++i) {
    chrome::SelectNextTab(browser_);
  }
}

void ModalBrowserController::SelectPreviousTab(int count) {
  const int tabs = browser_->GetTabStripModel()->count();
  for (int i = 0; i < count % std::max(tabs, 1); ++i) {
    chrome::SelectPreviousTab(browser_);
  }
}

void ModalBrowserController::SelectFirstTab() {
  chrome::SelectNumberedTab(browser_, 0);
}

void ModalBrowserController::SelectLastTab() {
  chrome::SelectLastTab(browser_);
}

void ModalBrowserController::ActivateTab(int32_t id) {
  tabs::TabInterface* tab = tabs::TabHandle(id).Get();
  TabStripModel* strip = browser_->GetTabStripModel();
  // The id came through Rust from this window's own snapshot, but the tab
  // may have closed or moved to another window since.
  if (!tab || strip->GetIndexOfTab(tab) == TabStripModel::kNoTab) {
    return;
  }
  strip->ActivateTab(tab, TabStripUserGestureDetails(
                              TabStripUserGestureDetails::GestureType::kOther));
}

std::vector<TabEntry> ModalBrowserController::GetTabs() {
  std::vector<TabEntry> out;
  TabStripModel* strip = browser_->GetTabStripModel();
  const int active = strip->active_index();
  for (int i = 0; i < strip->count(); ++i) {
    tabs::TabInterface* tab = strip->GetTabAtIndex(i);
    content::WebContents* contents = tab ? tab->GetContents() : nullptr;
    if (!contents) {
      continue;
    }
    out.push_back({tab->GetHandle().raw_value(),
                   Bounded(base::UTF16ToUTF8(contents->GetTitle()),
                           kMaxTabTextBytes),
                   Bounded(MerlinDisplayUrl(contents->GetVisibleURL()),
                           kMaxTabTextBytes),
                   i == active});
  }
  return out;
}

void ModalBrowserController::GoBack(int count) {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    return;
  }
  content::NavigationController& controller = contents->GetController();
  // Clamp to the available history instead of failing on large counts.
  const int offset = -std::min(count, controller.GetCurrentEntryIndex());
  if (offset != 0 && controller.CanGoToOffset(offset)) {
    controller.GoToOffset(offset);
  }
}

void ModalBrowserController::GoForward(int count) {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    return;
  }
  content::NavigationController& controller = contents->GetController();
  const int available =
      controller.GetEntryCount() - 1 - controller.GetCurrentEntryIndex();
  const int offset = std::min(count, available);
  if (offset > 0 && controller.CanGoToOffset(offset)) {
    controller.GoToOffset(offset);
  }
}

void ModalBrowserController::Reload(bool bypass_cache) {
  if (bypass_cache) {
    chrome::ReloadBypassingCache(browser_, WindowOpenDisposition::CURRENT_TAB);
  } else {
    chrome::Reload(browser_, WindowOpenDisposition::CURRENT_TAB);
  }
}

void ModalBrowserController::NavigateUp(int count) {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    return;
  }
  GURL url = contents->GetLastCommittedURL();
  if (!url.SchemeIsHTTPOrHTTPS() && !url.SchemeIsFile()) {
    ShowMessage(ffi::MessageLevel::Error, "This page has no parent");
    return;
  }
  GURL::Replacements clear;
  clear.ClearQuery();
  clear.ClearRef();
  GURL target = url.ReplaceComponents(clear);
  for (int i = 0; i < count && target.path() != "/"; ++i) {
    // "/a/b/c" -> "/a/b/", "/a/b/" -> "/a/".
    target = target.Resolve(target.path().ends_with('/') ? ".." : ".");
  }
  if (target == url) {
    ShowMessage(ffi::MessageLevel::Info, "Already at the top");
    return;
  }
  Navigate(target, ffi::OpenDisposition::CurrentTab);
}

void ModalBrowserController::NavigateRoot() {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    return;
  }
  const GURL url = contents->GetLastCommittedURL();
  if (!url.SchemeIsHTTPOrHTTPS()) {
    ShowMessage(ffi::MessageLevel::Error, "This page has no site root");
    return;
  }
  const GURL root = url.GetWithEmptyPath();
  if (root != url) {
    Navigate(root, ffi::OpenDisposition::CurrentTab);
  }
}

// -- BrowserOps: page ---------------------------------------------------------

void ModalBrowserController::Scroll(ffi::ScrollKind scroll,
                                    int count,
                                    int step_px,
                                    bool smooth) {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    return;
  }
  // Line steps stay instant so holding j feels direct; jumps glide.
  const bool line = scroll == ffi::ScrollKind::Down ||
                    scroll == ffi::ScrollKind::Up ||
                    scroll == ffi::ScrollKind::Left ||
                    scroll == ffi::ScrollKind::Right;
  const std::u16string script =
      page_scripts::ScrollScript(scroll, count, step_px, smooth && !line);
  if (script.empty()) {
    return;
  }
  // The focused frame, so scrolling works inside an iframe the user
  // clicked into.
  content::RenderFrameHost* frame = contents->GetFocusedFrame();
  if (!frame) {
    frame = contents->GetPrimaryMainFrame();
  }
  frame->ExecuteJavaScriptInIsolatedWorld(script, base::NullCallback(),
                                          ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

void ModalBrowserController::FocusAddressBar() {
  if (merlin_ui_) {
    EditAddress();
    return;
  }
  chrome::FocusLocationBar(browser_);
}

void ModalBrowserController::EditAddress() {
  content::WebContents* contents = ActiveContents();
  if (address_editor_ && address_field_ && address_field_->GetVisible()) {
    address_editor_->Begin();
    return;
  }
  if (address_editor_ && address_editor_->editing()) {
    address_editor_->Begin();  // Focuses it again.
    return;
  }
  const GURL url = contents ? contents->GetVisibleURL() : GURL();
  if (contents && url.SchemeIs(content::kChromeUIScheme) &&
      url.host() == kMerlinStartHost) {
    // The start page's field (merlin_start_page.cc), focused and selected.
    contents->Focus();
    contents->GetPrimaryMainFrame()->ExecuteJavaScript(
        u"window.merlinStart && merlinStart.focusField();",
        base::NullCallback());
    return;
  }
  EditAddressInPalette();
}

bool ModalBrowserController::EditingAddress() const {
  return address_editor_ && address_editor_->editing();
}

void ModalBrowserController::EditAddressInPalette() {
  std::string line = "cmdline open";
  if (content::WebContents* contents = ActiveContents()) {
    const GURL& url = contents->GetVisibleURL();
    if (url.SchemeIsHTTPOrHTTPS() || url.SchemeIsFile()) {
      line += " " + url.spec();
    } else if (url.SchemeIs(content::kChromeUIScheme)) {
      line += " " + MerlinDisplayUrl(url);
    }
  }
  RunCommandLine(line);
}

void ModalBrowserController::OnTabLayoutChanged() {
  UpdatePageContext();
  if (tab_bar_host_) {
    tab_bar_host_->Update();
  }
}

void ModalBrowserController::ApplyTabLayout() {
  // Merlin replaces Chromium's address field, back, forward and reload with
  // its own in both tab layouts (InstallMerlinToolbar). The rest of the
  // toolbar row stays: Chromium anchors bubbles to its buttons (downloads,
  // extensions), and hiding the row crashed in round 1. Normal windows
  // never show Chromium's field again on their own, and features that need
  // it check IsLocationBarVisible(). The toolbar builds the field after this
  // controller, so this runs again on every status update.
  toolbar_hidden_ = status_->card_mode();
  RegisterAccelerators();
  LocationBarView* location_bar = browser_view_->GetLocationBarView();
  if (!location_bar) {
    return;
  }
  // Merlin edits the address in its own card (merlin_address_editor.h).
  const bool show_chromium_field = !toolbar_hidden_;
  if (location_bar->GetVisible() != show_chromium_field) {
    location_bar->SetVisible(show_chromium_field);
  }
  if (toolbar_hidden_) {
    InstallMerlinToolbar(location_bar);
  }
  HideChromiumToolbarButtons();
  if (tab_bar_host_) {
    tab_bar_host_->Update();
  }
}

void ModalBrowserController::InstallMerlinToolbar(
    LocationBarView* location_bar) {
  views::View* row = location_bar->parent();
  if (address_field_ || !row) {
    return;
  }
  auto flexible = [] {
    auto spacer = std::make_unique<views::View>();
    spacer->SetProperty(
        views::kFlexBehaviorKey,
        views::FlexSpecification(views::MinimumFlexSizeRule::kScaleToZero,
                                 views::MaximumFlexSizeRule::kUnbounded));
    return spacer;
  };
  // Back, forward and reload go where Chromium's back button is.
  size_t nav_index = *row->GetIndexOf(location_bar);
  for (views::View* view : ChromiumNavViews(row)) {
    if (view->parent() == row) {
      nav_index = std::min(nav_index, *row->GetIndexOf(view));
    }
  }
  auto nav = std::make_unique<views::BoxLayoutView>();
  nav->SetOrientation(views::BoxLayout::Orientation::kHorizontal);
  nav->SetCrossAxisAlignment(views::BoxLayout::CrossAxisAlignment::kCenter);
  nav->SetBetweenChildSpacing(2);
  nav->SetProperty(views::kMarginsKey, gfx::Insets::VH(0, 6));
  back_button_ = nav->AddChildView(std::make_unique<MerlinNavButton>(
      browser_, MerlinNavButton::Kind::kBack));
  forward_button_ = nav->AddChildView(std::make_unique<MerlinNavButton>(
      browser_, MerlinNavButton::Kind::kForward));
  reload_button_ = nav->AddChildView(std::make_unique<MerlinNavButton>(
      browser_, MerlinNavButton::Kind::kReload));
  row->AddChildViewAt(std::move(nav), nav_index);

  // [spacer][field][spacer] after Chromium's (hidden) field: the field is
  // at most its preferred width and sits centered in the space left.
  size_t index = *row->GetIndexOf(location_bar) + 1;
  // Left-aligned after the buttons, as in Dia; the right spacer takes what
  // the field does not need.
  auto gap = std::make_unique<views::View>();
  gap->SetPreferredSize(gfx::Size(2, 1));
  toolbar_spacer_ = row->AddChildViewAt(std::move(gap), index++);
  auto field = std::make_unique<MerlinAddressField>(
      base::BindRepeating(&ModalBrowserController::EditAddress,
                          weak_factory_.GetWeakPtr()),
      base::BindRepeating(&ModalBrowserController::ShowSiteInfo,
                          weak_factory_.GetWeakPtr()));
  field->SetProperty(
      views::kFlexBehaviorKey,
      views::FlexSpecification(views::MinimumFlexSizeRule::kScaleToMinimum,
                               views::MaximumFlexSizeRule::kPreferred)
          .WithOrder(1));
  field->SetProperty(views::kMarginsKey, gfx::Insets::VH(0, 2));
  address_field_ = row->AddChildViewAt(std::move(field), index++);
  toolbar_spacer_right_ = row->AddChildViewAt(flexible(), index++);
  // Recording and private-window labels at the right end. Site
  // information and permission prompts open from the address field.
  safety_controls_ = row->AddChildViewAt(
      std::make_unique<MerlinSafetyControls>(browser_.get()), index++);
  auto downloads = std::make_unique<MerlinDownloadsButton>(
      browser_.get(), base::BindRepeating(
                          [](base::WeakPtr<ModalBrowserController> self) {
                            if (self) {
                              self->RunCommandLine("downloads");
                            }
                          },
                          weak_factory_.GetWeakPtr()));
  downloads->SetProperty(views::kMarginsKey, gfx::Insets::VH(0, 2));
  downloads_button_ = row->AddChildViewAt(std::move(downloads), index);
  address_editor_ = std::make_unique<MerlinAddressEditor>(
      browser_view_, browser_.get(), address_field_,
      // The start page hides Merlin's field again.
      base::BindRepeating(&ModalBrowserController::UpdatePageContext,
                          weak_factory_.GetWeakPtr()),
      base::BindRepeating(
          [](base::WeakPtr<ModalBrowserController> self) {
            if (self) {
              if (content::WebContents* contents = self->ActiveContents()) {
                contents->Focus();
              }
            }
          },
          weak_factory_.GetWeakPtr()));
  ApplyPageColor(page_color_value_);
}

void ModalBrowserController::UpdateMerlinToolbar(
    content::WebContents* contents,
    bool start_page) {
  if (!address_field_) {
    return;
  }
  // The start page has its own field, and Chromium's stands in for this one
  // while the address is edited.
  const bool show_field = contents && !start_page && !EditingAddress();
  if (show_field) {
    address_field_->Update(contents);
  }
  if (address_field_->GetVisible() != show_field) {
    address_field_->SetVisible(show_field);
  }
  // No tab while the window closes its last one.
  back_button_->SetEnabled(contents && chrome::CanGoBack(contents));
  forward_button_->SetEnabled(contents && chrome::CanGoForward(contents));
  reload_button_->SetLoading(contents && contents->IsLoading());
}

void ModalBrowserController::ShowSiteInfo() {
  if (content::WebContents* contents = ActiveContents()) {
    ShowPageInfoDialog(contents, base::DoNothing(),
                       bubble_anchor_util::Anchor::kLocationBar);
  }
}

void ModalBrowserController::HideChromiumToolbarButtons() {
  if (!merlin_ui_) {
    return;
  }
  // Chromium anchors bubbles ("Restore pages?", update, global errors,
  // profiles) to the ⋮ and account buttons, so they stay drawn, 1 px and
  // transparent (CollapseInRow), and those bubbles open at the row's end.
  BrowserElementsViews* elements = BrowserElementsViews::From(browser_.get());
  if (!elements) {
    return;
  }
  for (ui::ElementIdentifier id :
       {kToolbarAppMenuButtonElementId, kToolbarAvatarButtonElementId}) {
    if (views::View* button = elements->GetView(id)) {
      CollapseInRow(button, Collapse::kAnchor);
    }
  }
  // The tab search button (⌄): b and :tabs search tabs. Nothing anchors to
  // it, so it is simply hidden.
  if (views::View* button = elements->GetView(kTabSearchButtonElementId);
      button && button->GetVisible()) {
    button->SetVisible(false);
  }
  // Chromium's media button (♫), which its controller shows whenever a tab
  // plays sound. Media keys, the tab's speaker icon and macOS's Now Playing
  // still control playback.
  if (views::View* media = FindByElementId(browser_view_->toolbar(),
                                           kToolbarMediaButtonElementId);
      media && (!media_button_hidden_ ||
                media_button_hidden_->view() != media)) {
    media_button_hidden_ = std::make_unique<KeepHidden>(media);
  }
  // Back, forward, reload and home give way to Merlin's
  // (InstallMerlinToolbar). They sit in the row beside the address field.
  if (!address_field_) {
    return;
  }
  for (views::View* view : ChromiumNavViews(address_field_->parent())) {
    if (!IsWebUIToolbarView(view)) {
      if (view->GetVisible()) {
        view->SetVisible(false);
      }
      continue;
    }
    // The WebUI view must stay in the layout (see CollapseInRow). Forward
    // is not pinned by default in Merlin, so nothing in it counts as
    // overflowed.
    CollapseInRow(view, Collapse::kNoWidth);
  }
}

void ModalBrowserController::StartWatchingDownloads() {
  if (download_notifier_) {
    return;
  }
  if (content::DownloadManager* manager =
          browser_->GetProfile()->GetDownloadManager()) {
    download_notifier_ =
        std::make_unique<download::AllDownloadItemNotifier>(manager, this);
    UpdateDownloadStatus();
  }
}

void ModalBrowserController::OnDownloadCreated(content::DownloadManager*,
                                               download::DownloadItem*) {
  UpdateDownloadStatus();
}

void ModalBrowserController::OnDownloadUpdated(content::DownloadManager*,
                                               download::DownloadItem*) {
  // Progress arrives many times a second; the bar needs about one.
  if (!download_status_timer_.IsRunning()) {
    download_status_timer_.Start(
        FROM_HERE, base::Milliseconds(500),
        base::BindOnce(&ModalBrowserController::UpdateDownloadStatus,
                       base::Unretained(this)));
  }
}

void ModalBrowserController::OnDownloadRemoved(content::DownloadManager*,
                                               download::DownloadItem*) {
  UpdateDownloadStatus();
}

void ModalBrowserController::UpdateDownloadStatus() {
  status_->SetDownloads(
      base::UTF8ToUTF16(MerlinDownloadsStatus(browser_->GetProfile())));
}

void ModalBrowserController::FindInPage() {
  chrome::Find(browser_);
}

void ModalBrowserController::FindNext() {
  chrome::FindNext(browser_);
}

void ModalBrowserController::FindPrevious() {
  chrome::FindPrevious(browser_);
}

void ModalBrowserController::BlurFocusedElement() {
  if (content::WebContents* contents = ActiveContents()) {
    contents->ClearFocusedElement();
  }
}

void ModalBrowserController::WriteClipboard(const std::u16string& text,
                                            std::u16string_view what) {
  ui::ScopedClipboardWriter(ui::ClipboardBuffer::kCopyPaste).WriteText(text);
  status_->ShowMessage(u"Copied " + std::u16string(what) + u": " + Elide(text, 80),
                       /*is_error=*/false);
}

void ModalBrowserController::Yank(ffi::YankKind kind) {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    return;
  }
  const GURL url = contents->GetVisibleURL();
  switch (kind) {
    case ffi::YankKind::Title:
      WriteClipboard(contents->GetTitle(), u"title");
      return;
    case ffi::YankKind::Markdown:
      WriteClipboard(MarkdownLink(contents->GetTitle(), url), u"link");
      return;
    case ffi::YankKind::Selection:
      ReadSelection(base::BindOnce(
          [](base::WeakPtr<ModalBrowserController> self, std::string text) {
            if (!self) {
              return;
            }
            if (text.empty()) {
              self->ShowMessage(ffi::MessageLevel::Info, "Nothing is selected");
            } else {
              self->WriteClipboard(base::UTF8ToUTF16(text), u"selection");
            }
            self->PageWorkDone();
          },
          weak_factory_.GetWeakPtr()));
      return;
    case ffi::YankKind::Url:
    default:
      WriteClipboard(base::UTF8ToUTF16(url.spec()), u"URL");
      return;
  }
}

void ModalBrowserController::ReadClipboard(ffi::OpenDisposition disposition) {
  ui::Clipboard::GetForCurrentThread()->ReadText(
      ui::ClipboardBuffer::kCopyPaste, /*data_dst=*/std::nullopt,
      base::BindOnce(
          [](base::WeakPtr<ModalBrowserController> self,
             ffi::OpenDisposition disposition, std::u16string text) {
            if (!self) {
              return;
            }
            std::string utf8 = Bounded(
                base::UTF16ToUTF8(base::TrimWhitespace(text, base::TRIM_ALL)),
                kMaxClipboardBytes);
            self->router_.OnClipboardText(utf8, disposition, *self);
          },
          weak_factory_.GetWeakPtr(), disposition));
}

// -- BrowserOps: hints --------------------------------------------------------

namespace {

// The frame's local root (the main frame, or the out-of-process iframe it
// renders with) and how many frames up that is.
content::RenderFrameHost* LocalRoot(content::RenderFrameHost* frame,
                                    int* levels) {
  *levels = 0;
  while (frame->GetParent() && !frame->IsCrossProcessSubframe()) {
    frame = frame->GetParent();
    ++*levels;
  }
  return frame;
}

}  // namespace

void ModalBrowserController::CollectHints(uint32_t generation,
                                          ffi::HintTargets targets) {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    router_.OnHintsCollected(generation, {}, *this);
    return;
  }
  // Every live frame of the page, main frame first, then iframes in tree
  // order; each reports its targets in its own coordinates.
  HintCollection collection;
  collection.generation = generation;
  contents->GetPrimaryMainFrame()->ForEachRenderFrameHost(
      [&collection](content::RenderFrameHost* frame) {
        if (frame->IsActive() && frame->IsRenderFrameLive() &&
            collection.frames.size() < kMaxHintFrames) {
          collection.frames.push_back(frame->GetGlobalId());
        }
      });
  collection.results.resize(collection.frames.size());
  collection.pending = static_cast<int>(collection.frames.size());
  hint_collection_ = std::move(collection);
  const std::vector<content::GlobalRenderFrameHostId> frames =
      hint_collection_->frames;
  for (size_t i = 0; i < frames.size(); ++i) {
    content::RenderFrameHost::FromID(frames[i])->ExecuteJavaScriptInIsolatedWorld(
        page_scripts::CollectHintsScript(targets),
        base::BindOnce(&ModalBrowserController::OnFrameHintTargets,
                       weak_factory_.GetWeakPtr(), generation, i),
        ISOLATED_WORLD_ID_CHROME_INTERNAL);
  }
  if (frames.empty()) {
    hint_collection_.reset();
    router_.OnHintsCollected(generation, {}, *this);
  }
}

void ModalBrowserController::OnFrameHintTargets(uint32_t generation,
                                                size_t index,
                                                base::Value result) {
  if (!hint_collection_ || hint_collection_->generation != generation ||
      index >= hint_collection_->results.size()) {
    return;  // a newer request replaced this one
  }
  hint_collection_->results[index] = page_scripts::ParseHintTargets(result);
  if (--hint_collection_->pending > 0) {
    return;
  }
  HintCollection collection = std::move(*hint_collection_);
  hint_collection_.reset();

  content::WebContents* contents = ActiveContents();
  placed_hints_.clear();
  std::vector<ffi::HintKind> kinds;
  if (contents) {
    const float scale = DeviceScaleFactor();
    const gfx::Size viewport = contents->GetContainerBounds().size();
    for (size_t i = 0; i < collection.frames.size(); ++i) {
      content::RenderFrameHost* frame =
          content::RenderFrameHost::FromID(collection.frames[i]);
      const std::optional<page_scripts::HintTargets>& r = collection.results[i];
      if (!frame || !r) {
        continue;
      }
      int levels = 0;
      content::RenderFrameHost* local_root = LocalRoot(frame, &levels);
      // The script must have seen all the way up to the local root, or its
      // positions cannot be placed (a cross-origin frame in the same
      // process); those frames are left out.
      if (r->offset.levels < levels) {
        continue;
      }
      const double k = r->transform.scale / std::max(scale, 0.1f);
      for (uint32_t t = 0; t < r->targets.size(); ++t) {
        if (placed_hints_.size() >= page_scripts::kMaxHintTargets) {
          break;
        }
        const gfx::RectF& css = r->targets[t].css_rect;
        gfx::PointF local = r->transform.ToDip(css.x(), css.y(), scale);
        local.Offset(r->offset.x * k, r->offset.y * k);
        gfx::PointF root = local;
        if (local_root != contents->GetPrimaryMainFrame()) {
          content::RenderWidgetHostView* view = local_root->GetView();
          if (!view) {
            continue;
          }
          root = view->TransformPointToRootCoordSpaceF(local);
        }
        // Inside an iframe that is scrolled out of view.
        if (root.x() < 0 || root.y() < 0 || root.x() >= viewport.width() ||
            root.y() >= viewport.height()) {
          continue;
        }
        placed_hints_.push_back(
            {collection.frames[i], t, r->targets[t].kind, root});
        kinds.push_back(r->targets[t].kind);
      }
    }
  }
  router_.OnHintsCollected(generation, kinds, *this);
  PageWorkDone();
}

void ModalBrowserController::ShowHints(const std::vector<HintLabelView>& hints,
                                       ffi::HintAction action) {
  std::vector<HintPlacement> placements;
  placements.reserve(hints.size());
  for (const HintLabelView& h : hints) {
    if (h.target >= placed_hints_.size()) {
      continue;
    }
    const gfx::PointF& dip = placed_hints_[h.target].root_dip;
    placements.push_back({base::UTF8ToUTF16(h.label),
                          gfx::Point(static_cast<int>(dip.x()),
                                     static_cast<int>(dip.y()))});
  }
  hints_->Show(std::move(placements));
}

void ModalBrowserController::FilterHints(std::string_view typed) {
  hints_->Filter(base::UTF8ToUTF16(typed));
}

void ModalBrowserController::HideHints() {
  hints_->Hide();
}

void ModalBrowserController::ActivateHint(uint32_t target,
                                          ffi::HintAction action) {
  content::WebContents* contents = ActiveContents();
  content::RenderFrameHost* frame =
      target < placed_hints_.size()
          ? content::RenderFrameHost::FromID(placed_hints_[target].frame)
          : nullptr;
  if (!frame || !contents ||
      content::WebContents::FromRenderFrameHost(frame) != contents) {
    ShowMessage(ffi::MessageLevel::Error, "The page changed; try again");
    return;
  }
  // Re-read the element: it may have moved since the labels were drawn.
  page_scripts::ElementOp op = page_scripts::ElementOp::kNone;
  if (action == ffi::HintAction::FocusInput ||
      action == ffi::HintAction::EditInput) {
    op = page_scripts::ElementOp::kFocus;
  } else if (action == ffi::HintAction::Select) {
    op = page_scripts::ElementOp::kSelect;
  } else if (action == ffi::HintAction::YankCode) {
    op = page_scripts::ElementOp::kReadText;
  }
  frame->ExecuteJavaScriptInIsolatedWorld(
      page_scripts::ActivationInfoScript(placed_hints_[target].index, op),
      base::BindOnce(&ModalBrowserController::OnActivationInfo,
                     weak_factory_.GetWeakPtr(), action, frame->GetGlobalId()),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

void ModalBrowserController::OnActivationInfo(
    ffi::HintAction action,
    content::GlobalRenderFrameHostId frame_id,
    base::Value result) {
  std::optional<page_scripts::ActivationInfo> info =
      page_scripts::ParseActivationInfo(result);
  content::WebContents* contents = ActiveContents();
  content::RenderFrameHost* frame = content::RenderFrameHost::FromID(frame_id);
  if (!info || !contents || !frame) {
    ShowMessage(ffi::MessageLevel::Error, "That element is gone");
    PageWorkDone();
    return;
  }
  const GURL link(info->href);
  switch (action) {
    case ffi::HintAction::FocusInput:
    case ffi::HintAction::EditInput:
      // The script focused it; the focus notification enters Insert, and
      // for EditInput the core's InspectField follows.
      break;
    case ffi::HintAction::Select:
      // The script selected it; the core is in Visual mode.
      break;
    case ffi::HintAction::YankCode:
      if (info->text.empty()) {
        ShowMessage(ffi::MessageLevel::Info, "That code block is empty");
      } else {
        WriteClipboard(base::UTF8ToUTF16(info->text), u"code");
      }
      break;
    case ffi::HintAction::OpenInNewTab:
      // A link in an iframe may only open what that frame could open.
      if (IsAllowedLinkUrl(link, frame->GetLastCommittedURL())) {
        Navigate(link, ffi::OpenDisposition::NewBackgroundTab);
      } else {
        ShowMessage(ffi::MessageLevel::Error,
                    "Only web links open in a new tab");
      }
      break;
    case ffi::HintAction::YankLink:
      if (link.is_valid() && !link.SchemeIs(url::kJavaScriptScheme)) {
        WriteClipboard(base::UTF8ToUTF16(link.spec()), u"link");
      } else {
        ShowMessage(ffi::MessageLevel::Error, "Not a link");
      }
      break;
    case ffi::HintAction::Follow:
    default: {
      int levels = 0;
      content::RenderFrameHost* local_root = LocalRoot(frame, &levels);
      const float scale = DeviceScaleFactor();
      const double k = info->transform.scale / std::max(scale, 0.1f);
      gfx::PointF point = info->transform.ToDip(info->css_center.x(),
                                                info->css_center.y(), scale);
      point.Offset(info->offset.x * k, info->offset.y * k);
      ClickAt(local_root, point);
      break;
    }
  }
  PageWorkDone();
}

// A real click, as if the user clicked the label's target: it goes through
// the normal input pipeline (hit testing, user activation for popups,
// focus), unlike element.click() from a script. `point` is in the local
// root's widget, which for an out-of-process iframe is its own widget.
void ModalBrowserController::ClickAt(content::RenderFrameHost* local_root,
                                     const gfx::PointF& point) {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    return;
  }
  content::RenderWidgetHost* widget = local_root->GetRenderWidgetHost();
  gfx::PointF root = point;
  if (local_root != contents->GetPrimaryMainFrame()) {
    content::RenderWidgetHostView* view = local_root->GetView();
    if (!view) {
      return;
    }
    root = view->TransformPointToRootCoordSpaceF(point);
  }
  const gfx::Rect container = contents->GetContainerBounds();
  const gfx::PointF screen(root.x() + container.x(), root.y() + container.y());
  for (auto type : {blink::WebInputEvent::Type::kMouseMove,
                    blink::WebInputEvent::Type::kMouseDown,
                    blink::WebInputEvent::Type::kMouseUp}) {
    const bool move = type == blink::WebInputEvent::Type::kMouseMove;
    blink::WebMouseEvent event(
        type, point, screen,
        move ? blink::WebPointerProperties::Button::kNoButton
             : blink::WebPointerProperties::Button::kLeft,
        /*click_count=*/move ? 0 : 1,
        type == blink::WebInputEvent::Type::kMouseDown
            ? blink::WebInputEvent::kLeftButtonDown
            : blink::WebInputEvent::kNoModifiers,
        ui::EventTimeForNow());
    widget->ForwardMouseEvent(event);
  }
}

// -- BrowserOps: palette, config, status --------------------------------------

void ModalBrowserController::ShowPalette(const ffi::PaletteState& state) {
  palette_->Show(state);
  status_->SetSuppressed(state.visible);
}

void ModalBrowserController::HidePalette() {
  palette_->Hide();
  status_->SetSuppressed(false);
  // Give keyboard focus back to the page.
  if (content::WebContents* contents = ActiveContents()) {
    contents->Focus();
  }
}

void ModalBrowserController::ReadConfig() {
  LoadConfig(/*announce=*/true);
}

void ModalBrowserController::LoadConfig(bool announce) {
  config_file::Read(base::BindOnce(&ModalBrowserController::OnConfigRead,
                                   weak_factory_.GetWeakPtr(), announce));
}

void ModalBrowserController::OnConfigRead(bool announce,
                                          config_file::ReadResult result) {
  const std::string path = config_file::ConfigPath().value();
  if (!result.error.empty()) {
    ShowMessage(ffi::MessageLevel::Error,
                "Config " + path + ": " + result.error);
    PageWorkDone();
    return;
  }
  router_.OnConfigRead(result.found, result.text, path, announce, *this);
  ApplyConfigToBrowser();
  PageWorkDone();
}

void ModalBrowserController::ApplyConfigToBrowser() {
  // Reopen the last session at launch. Chromium decides what to open at
  // startup before any window (and so this code) exists, so a default set
  // here would come too late; instead, a profile that has never chosen is
  // given "continue where you left off" once, as an ordinary setting it can
  // change in Settings > On startup. A choice already made is never touched.
  PrefService* prefs = browser_->GetProfile()->GetPrefs();
  if (router_.restore_session_default() &&
      !browser_->GetProfile()->IsOffTheRecord() &&
      !prefs->HasPrefPath(prefs::kRestoreOnStartup) &&
      !prefs->IsManagedPreference(prefs::kRestoreOnStartup)) {
    prefs->SetInteger(prefs::kRestoreOnStartup,
                      SessionStartupPref::kPrefValueLast);
  }
  // browserctl never serves private windows.
  BrowserctlService::Get().Update(
      this, router_.browserctl_enabled() &&
                !browser_->GetProfile()->IsOffTheRecord());
}

// -- BrowserOps: browser shell -------------------------------------------------

void ModalBrowserController::SetVerticalTabsDefault(bool vertical) {
  // Only the default changes, and only for this run: a layout the user
  // picked (in Chromium's tab strip menu or with :vertical-tabs) is a user
  // value and wins. Chromium's vertical tab controller observes the pref
  // and switches live.
  PrefService* prefs = browser_->GetProfile()->GetPrefs();
  // Changing the default notifies even when a user value hides it, and
  // Chromium then rebuilds a tab strip that never switched (a crash in
  // TabStrip::Reset at startup), so leave it alone in that case.
  const PrefService::Preference* pref =
      prefs->FindPreference(prefs::kVerticalTabsEnabled);
  const base::Value* current =
      prefs->GetDefaultPrefValue(prefs::kVerticalTabsEnabled);
  if (!pref || pref->HasUserSetting() ||
      (current && *current == base::Value(vertical))) {
    return;
  }
  prefs->SetDefaultPrefValue(prefs::kVerticalTabsEnabled,
                             base::Value(vertical));
}

void ModalBrowserController::SetVerticalTabs(ffi::Switch value) {
  auto* state = tabs::VerticalTabStripStateController::From(browser_.get());
  if (!state) {
    ShowMessage(ffi::MessageLevel::Error, "Vertical tabs are not available");
    return;
  }
  const bool vertical = value == ffi::Switch::Toggle
                            ? !state->ShouldDisplayVerticalTabs()
                            : value == ffi::Switch::On;
  state->SetVerticalTabsEnabled(vertical);
}

void ModalBrowserController::SetTabsHiddenDefault(bool hidden) {
  if (tabs_hidden_default_ == hidden) {
    return;
  }
  tabs_hidden_default_ = hidden;
  if (tabs_hidden_ != hidden) {
    tabs_hidden_ = hidden;
    ApplyTabsHidden();
  }
}

void ModalBrowserController::SetTabsHidden(ffi::Switch value) {
  const bool hidden = value == ffi::Switch::Toggle ? !tabs_hidden_
                                                   : value == ffi::Switch::On;
  if (tabs_hidden_ == hidden) {
    return;
  }
  tabs_hidden_ = hidden;
  ApplyTabsHidden();
}

void ModalBrowserController::ApplyTabsHidden() {
  // Normal windows only; popups and apps have no tabs to hide.
  if (browser_->GetType() != BrowserWindowInterface::Type::TYPE_NORMAL) {
    return;
  }
  browser_view_->SetTabStripHiddenByEmbedder(tabs_hidden_);
  if (status_) {
    status_->SetFullBleed(tabs_hidden_);
  }
  if (ToolbarView* toolbar = browser_view_->toolbar()) {
    MerlinToolbarBackdrop::InstallIn(toolbar)->SetFullBleed(tabs_hidden_);
  }
  if (tab_bar_host_) {
    tab_bar_host_->SetTabsHidden(tabs_hidden_);
  }
}

void ModalBrowserController::SetTabSidebar(ffi::Switch value) {
  auto* state = tabs::VerticalTabStripStateController::From(browser_.get());
  if (!state || !state->ShouldDisplayVerticalTabs()) {
    ShowMessage(ffi::MessageLevel::Error,
                "Tabs are on top; :vertical-tabs on shows the sidebar");
    return;
  }
  // On means expanded.
  const bool collapse = value == ffi::Switch::Toggle ? !state->IsCollapsed()
                                                     : value == ffi::Switch::Off;
  state->RequestCollapse(collapse);
}

void ModalBrowserController::ShowMessage(ffi::MessageLevel level,
                                         std::string_view text) {
  status_->ShowMessage(ToU16(text), level == ffi::MessageLevel::Error);
}

void ModalBrowserController::UpdateStatus(
    ffi::Mode mode,
    std::string_view indicator,
    std::string_view pending,
    const std::vector<KeyHintView>& which_key) {
  std::vector<std::pair<std::u16string, std::u16string>> entries;
  entries.reserve(which_key.size());
  for (const KeyHintView& h : which_key) {
    entries.emplace_back(ToU16(h.keys), ToU16(h.desc));
  }
  status_->UpdateStatus(mode, ToU16(indicator), ToU16(pending),
                        std::move(entries));
  // Commands may have switched workspace or tab layout.
  UpdatePageContext();
}

void ModalBrowserController::StartSequenceTimer(uint32_t delay_ms) {
  // The timer is owned by this object, so Unretained is safe.
  sequence_timer_.Start(
      FROM_HERE, base::Milliseconds(delay_ms),
      base::BindOnce(
          [](ModalBrowserController* self) {
            self->router_.OnSequenceTimeout(*self);
          },
          base::Unretained(this)));
}

void ModalBrowserController::StopSequenceTimer() {
  sequence_timer_.Stop();
}


// -- BrowserOps: splits, windows, workspaces ----------------------------------

std::optional<GURL> ModalBrowserController::ResolveTarget(
    const OpenRequest& target) {
  GURL url;
  if (target.kind == ffi::TargetKind::Url) {
    url = url_formatter::FixupURL(target.text, std::string());
  } else if (target.kind == ffi::TargetKind::Search) {
    AutocompleteMatch match;
    AutocompleteClassifierFactory::GetForProfile(browser_->GetProfile())
        ->Classify(base::UTF8ToUTF16(target.text), false, false,
                   metrics::OmniboxEventProto::OTHER, &match, nullptr);
    url = match.destination_url;
  } else {
    return GURL();
  }
  if (!IsAllowedCommandUrl(url)) {
    ShowMessage(ffi::MessageLevel::Error, "Cannot open that URL");
    return std::nullopt;
  }
  return url;
}

void ModalBrowserController::Split(ffi::SplitLayout layout,
                                   const OpenRequest& target) {
  TabStripModel* strip = browser_->GetTabStripModel();
  const int active = strip->active_index();
  if (active == TabStripModel::kNoTab) {
    return;
  }
  if (strip->GetSplitForTab(active)) {
    ShowMessage(ffi::MessageLevel::Error,
                "This tab is already split (:only ends the split)");
    return;
  }
  std::optional<GURL> url = ResolveTarget(target);
  if (!url) {
    return;
  }
  if (url->is_empty()) {
    // Chromium's own command: the new side shows its split-view tab picker.
    chrome::NewSplitTab(browser_, ToLayout(layout),
                        split_tabs::SplitTabCreatedSource::kKeyboardShortcut);
    return;
  }
  // As chrome::NewSplitTab does, with our page in the new side.
  strip->delegate()->AddTabAt(*url, active + 1, /*foreground=*/true,
                              strip->GetTabGroupForTab(active),
                              strip->IsTabPinned(active));
  strip->AddToNewSplit({active}, split_tabs::SplitTabVisualData(ToLayout(layout)),
                       split_tabs::SplitTabCreatedSource::kKeyboardShortcut);
  strip->ActivateTabAt(active + 1);
}

void ModalBrowserController::FocusOtherSplit() {
  TabStripModel* strip = browser_->GetTabStripModel();
  const int active = strip->active_index();
  std::optional<split_tabs::SplitTabId> split = strip->GetSplitForTab(active);
  if (!split) {
    ShowMessage(ffi::MessageLevel::Error, "This tab is not split");
    return;
  }
  tabs::TabInterface* current = strip->GetActiveTab();
  for (tabs::TabInterface* tab : strip->GetSplitData(*split)->ListTabs()) {
    if (tab != current) {
      strip->ActivateTab(tab, TabStripUserGestureDetails(
                                  TabStripUserGestureDetails::GestureType::kOther));
      return;
    }
  }
}

void ModalBrowserController::SwapSplit() {
  TabStripModel* strip = browser_->GetTabStripModel();
  if (std::optional<split_tabs::SplitTabId> split =
          strip->GetSplitForTab(strip->active_index())) {
    strip->ReverseTabsInSplit(*split);
  } else {
    ShowMessage(ffi::MessageLevel::Error, "This tab is not split");
  }
}

void ModalBrowserController::Unsplit() {
  TabStripModel* strip = browser_->GetTabStripModel();
  if (std::optional<split_tabs::SplitTabId> split =
          strip->GetSplitForTab(strip->active_index())) {
    strip->RemoveSplit(*split);
  } else {
    ShowMessage(ffi::MessageLevel::Error, "This tab is not split");
  }
}

void ModalBrowserController::PinTab(ffi::Switch value) {
  TabStripModel* strip = browser_->GetTabStripModel();
  const int active = strip->active_index();
  if (active == TabStripModel::kNoTab) {
    return;
  }
  const bool pinned = strip->IsTabPinned(active);
  const bool pin = value == ffi::Switch::Toggle ? !pinned : value == ffi::Switch::On;
  if (pin == pinned) {
    return;
  }
  // The tab menu's command, not SetTabPinned: it pins both halves of a
  // split together, where SetTabPinned would pull one tab out of it.
  strip->ExecuteContextMenuCommand(active, TabStripModel::CommandTogglePinned);
}

void ModalBrowserController::NewWindow(bool private_window) {
  chrome::ExecuteCommand(browser_, private_window ? IDC_NEW_INCOGNITO_WINDOW
                                                  : IDC_NEW_WINDOW);
}

void ModalBrowserController::SnapshotWorkspace(std::string_view name,
                                               bool quiet) {
  TabStripModel* strip = browser_->GetTabStripModel();
  ::rust::Vec<ffi::WindowTab> tabs;
  std::map<split_tabs::SplitTabId, int32_t> split_numbers;
  std::map<tab_groups::TabGroupId, int32_t> group_numbers;
  for (int i = 0; i < strip->count(); ++i) {
    tabs::TabInterface* tab = strip->GetTabAtIndex(i);
    content::WebContents* contents = tab ? tab->GetContents() : nullptr;
    if (!contents) {
      continue;
    }
    int32_t split = -1;
    ffi::SplitLayout layout = ffi::SplitLayout::SideBySide;
    double split_ratio = 0;
    if (std::optional<split_tabs::SplitTabId> id = strip->GetSplitForTab(i)) {
      auto [it, inserted] = split_numbers.try_emplace(
          *id, static_cast<int32_t>(split_numbers.size()));
      split = it->second;
      const split_tabs::SplitTabVisualData* visual =
          strip->GetSplitData(*id)->visual_data();
      if (visual->split_layout() == split_tabs::SplitTabLayout::kStacked) {
        layout = ffi::SplitLayout::Stacked;
      }
      split_ratio = visual->split_ratio();
    }
    int32_t group = -1;
    std::string group_title;
    std::string_view group_color;
    bool group_collapsed = false;
    if (std::optional<tab_groups::TabGroupId> id = strip->GetTabGroupForTab(i);
        id && strip->SupportsTabGroups()) {
      auto [it, inserted] = group_numbers.try_emplace(
          *id, static_cast<int32_t>(group_numbers.size()));
      group = it->second;
      if (const TabGroup* tab_group = strip->group_model()->GetTabGroup(*id)) {
        const tab_groups::TabGroupVisualData* visual =
            tab_group->visual_data();
        group_title = Bounded(base::UTF16ToUTF8(visual->title()), 256);
        group_color = GroupColorName(visual->color());
        group_collapsed = visual->is_collapsed();
      }
    }
    tabs.push_back(ffi::WindowTab{
        ::rust::String::lossy(
            Bounded(contents->GetVisibleURL().spec(), 8 * 1024)),
        ::rust::String::lossy(
            Bounded(base::UTF16ToUTF8(contents->GetTitle()), kMaxTabTextBytes)),
        strip->IsTabPinned(i), i == strip->active_index(), split, layout,
        split_ratio, group, ::rust::String::lossy(group_title),
        ::rust::String(group_color.data(), group_color.size()),
        group_collapsed});
  }
  // The window's normal bounds, so a zoomed window comes back zoomed over
  // the same place it would return to.
  ffi::WindowState window{0, 0, 0, 0, false};
  if (browser_view_ && !browser_view_->IsFullscreen()) {
    const gfx::Rect bounds = browser_view_->GetRestoredBounds();
    window = ffi::WindowState{bounds.x(), bounds.y(), bounds.width(),
                              bounds.height(), browser_view_->IsMaximized()};
  }
  router_.OnWorkspaceSnapshot(name, quiet, std::move(tabs), window,
                              NowSeconds(), *this);
}

void ModalBrowserController::WriteWorkspace(std::string_view name,
                                            std::string_view contents,
                                            std::string_view message) {
  workspace_store::Write(
      std::string(name), std::string(contents),
      base::BindOnce(
          [](base::WeakPtr<ModalBrowserController> self, std::string message,
             std::string error) {
            if (!self) {
              return;
            }
            if (!error.empty()) {
              self->ShowMessage(ffi::MessageLevel::Error,
                                "Workspace: " + error);
            } else {
              // One window per workspace: another window still kept under
              // this name would write over it with its own tabs.
              self->ReleaseWorkspaceInOtherWindows();
              if (!message.empty()) {
                self->ShowMessage(ffi::MessageLevel::Info, message);
              }
            }
            self->PageWorkDone();
          },
          weak_factory_.GetWeakPtr(), std::string(message)));
}

ModalBrowserController* ModalBrowserController::WindowWithWorkspace(
    std::string_view name) {
  ModalBrowserController* found = nullptr;
  GlobalBrowserCollection::GetInstance()->ForEach(
      [&](BrowserWindowInterface* browser) {
        ModalBrowserController* c = From(browser);
        if (c && c != this && !browser->GetProfile()->IsOffTheRecord() &&
            c->router_.workspace() == name) {
          found = c;
          return false;
        }
        return true;
      },
      BrowserCollection::Order::kActivation);
  return found;
}

void ModalBrowserController::ReleaseWorkspaceInOtherWindows() {
  const std::string name = router_.workspace();
  if (name.empty()) {
    return;
  }
  while (ModalBrowserController* other = WindowWithWorkspace(name)) {
    other->autosave_timer_.Stop();
    other->router_.SetWorkspace("", "");
  }
}

void ModalBrowserController::ReadWorkspace(std::string_view name) {
  // Already open: show that window rather than a second copy, which would
  // save over the first.
  if (router_.workspace() == name) {
    ShowMessage(ffi::MessageLevel::Info,
                "Workspace " + std::string(name) + " is this window");
    PageWorkDone();
    return;
  }
  if (ModalBrowserController* other = WindowWithWorkspace(name)) {
    other->browser_->GetWindow()->Activate();
    other->ShowMessage(ffi::MessageLevel::Info,
                       "Workspace " + std::string(name) + " is already open");
    PageWorkDone();
    return;
  }
  workspace_store::Read(
      std::string(name),
      base::BindOnce(
          [](base::WeakPtr<ModalBrowserController> self, std::string name,
             workspace_store::ReadResult result) {
            if (!self) {
              return;
            }
            if (!result.error.empty()) {
              self->ShowMessage(ffi::MessageLevel::Error,
                                "Workspace " + name + ": " + result.error);
            } else {
              self->router_.OnWorkspaceRead(name, result.found, result.text,
                                            *self);
            }
            self->PageWorkDone();
          },
          weak_factory_.GetWeakPtr(), std::string(name)));
}

void ModalBrowserController::DeleteWorkspace(std::string_view name) {
  workspace_store::Delete(
      std::string(name),
      base::BindOnce(
          [](base::WeakPtr<ModalBrowserController> self, std::string name,
             bool deleted) {
            if (!self) {
              return;
            }
            self->ShowMessage(
                deleted ? ffi::MessageLevel::Info : ffi::MessageLevel::Error,
                deleted ? "Deleted workspace " + name
                        : "No workspace named " + name);
            self->PageWorkDone();
          },
          weak_factory_.GetWeakPtr(), std::string(name)));
}

void ModalBrowserController::RestoreWorkspace(
    const WorkspaceRestore& workspace) {
  // Reuse this window only if it still holds a single tab, as the core saw
  // when it chose; otherwise its tabs would be closed below.
  const bool new_window =
      workspace.new_window || browser_->GetTabStripModel()->count() != 1;
  BrowserWindowInterface* target = browser_;
  if (new_window && !workspace.new_window) {
    // The core gave this window the workspace's name; the new window takes
    // it instead.
    router_.SetWorkspace("", "");
  }
  if (new_window) {
    Profile* profile = browser_->GetProfile();
    if (GetBrowserWindowCreationStatusForProfile(*profile) !=
            BrowserWindowInterface::CreationStatus::kOk ||
        profile->ShutdownStarted()) {
      ShowMessage(ffi::MessageLevel::Error, "Could not open a window");
      return;
    }
    BrowserWindowCreateParams params(BrowserWindowInterface::TYPE_NORMAL,
                                     profile, /*from_user_gesture=*/true);
    // Where the window was when saved, if a display still shows it.
    params.initial_bounds = OnScreenBounds(gfx::Rect(
        workspace.x, workspace.y, workspace.width, workspace.height));
    if (workspace.maximized) {
      params.initial_show_state = ui::mojom::WindowShowState::kMaximized;
    } else if (params.initial_bounds.IsEmpty() && browser_view_) {
      // No saved place: beside this window rather than exactly over it, so
      // it is plain that a window opened.
      gfx::Rect bounds = browser_view_->GetRestoredBounds();
      bounds.Offset(28, 28);
      params.initial_bounds = OnScreenBounds(bounds);
    }
    target = CreateBrowserWindow(std::move(params));
    if (!target) {
      ShowMessage(ffi::MessageLevel::Error, "Could not open a window");
      return;
    }
  }
  TabStripModel* strip = target->GetTabStripModel();
  // The tabs there now (a new-tab page) give way to the workspace.
  std::vector<tabs::TabHandle> placeholders;
  for (int i = 0; i < strip->count(); ++i) {
    placeholders.push_back(strip->GetTabAtIndex(i)->GetHandle());
  }
  std::vector<tabs::TabHandle> added;
  for (size_t i = 0; i < workspace.tabs.size(); ++i) {
    const WorkspaceRestore::Tab& tab = workspace.tabs[i];
    const GURL url(tab.url);
    content::WebContents* contents = nullptr;
    // The active tab and its split partner are on screen: load them now.
    const bool visible =
        i == workspace.active ||
        (workspace.active < workspace.tabs.size() &&
         workspace.tabs[workspace.active].split_with == static_cast<int>(i));
    if (visible) {
      contents = chrome::AddAndReturnTabAt(target, url, -1,
                                           /*foreground=*/false, std::nullopt,
                                           tab.pinned);
    } else {
      // The others load when first shown, as with session restore, so a
      // large workspace opens at once.
      sessions::SerializedNavigationEntry entry;
      entry.set_index(0);
      entry.set_virtual_url(url);
      entry.set_original_request_url(url);
      entry.set_title(base::UTF8ToUTF16(tab.title));
      entry.set_transition_type(ui::PAGE_TRANSITION_AUTO_BOOKMARK);
      entry.set_timestamp(base::Time::Now());
      contents = chrome::AddRestoredTab(
          target, base::span_from_ref(entry), strip->count(),
          /*selected_navigation=*/0, /*extension_app_id=*/std::string(),
          /*group=*/std::nullopt, /*select=*/false, tab.pinned,
          base::TimeTicks::Now(), base::Time::Now(),
          /*storage_namespace=*/nullptr, sessions::SerializedUserAgentOverride(),
          /*extra_data=*/{}, /*from_session_restore=*/false,
          /*is_active_browser=*/std::nullopt);
      // Its icon from the favicon database, so an unloaded tab does not
      // show the blank globe.
      if (contents) {
        if (auto* driver =
                favicon::ContentFaviconDriver::FromWebContents(contents)) {
          driver->FetchFavicon(url, /*is_same_document=*/false);
        }
      }
    }
    tabs::TabInterface* added_tab =
        contents ? tabs::TabInterface::MaybeGetFromContents(contents) : nullptr;
    added.push_back(added_tab ? added_tab->GetHandle() : tabs::TabHandle());
  }
  auto index_of = [&](size_t i) {
    tabs::TabInterface* tab = i < added.size() ? added[i].Get() : nullptr;
    return tab ? strip->GetIndexOfTab(tab) : TabStripModel::kNoTab;
  };
  // Groups, before splits: a split lives inside its group. Collapsing
  // waits until the active tab is chosen.
  std::vector<tab_groups::TabGroupId> collapse;
  if (strip->SupportsTabGroups()) {
    std::map<int, std::vector<size_t>> members;
    for (size_t i = 0; i < workspace.tabs.size(); ++i) {
      if (workspace.tabs[i].group >= 0 && !workspace.tabs[i].pinned) {
        members[workspace.tabs[i].group].push_back(i);
      }
    }
    for (const auto& [group, tabs_in_group] : members) {
      std::vector<int> indices;
      for (size_t i : tabs_in_group) {
        const int index = index_of(i);
        if (index != TabStripModel::kNoTab && !strip->IsTabPinned(index) &&
            !strip->GetTabGroupForTab(index)) {
          indices.push_back(index);
        }
      }
      if (indices.empty()) {
        continue;
      }
      std::ranges::sort(indices);
      const WorkspaceRestore::Tab& first = workspace.tabs[tabs_in_group[0]];
      const tab_groups::TabGroupId id = strip->AddToNewGroup(indices);
      strip->ChangeTabGroupVisuals(
          id, tab_groups::TabGroupVisualData(
                  base::UTF8ToUTF16(first.group_title),
                  GroupColorFromName(first.group_color),
                  /*is_collapsed=*/false));
      if (first.group_collapsed) {
        collapse.push_back(id);
      }
    }
  }
  // Splits: pair each tab with the later tab it was split with.
  for (size_t i = 0; i < workspace.tabs.size(); ++i) {
    const int j = workspace.tabs[i].split_with;
    if (j <= static_cast<int>(i)) {
      continue;
    }
    const int a = index_of(i);
    const int b = index_of(j);
    if (a == TabStripModel::kNoTab || b == TabStripModel::kNoTab ||
        strip->GetSplitForTab(a) || strip->GetSplitForTab(b) ||
        strip->IsTabPinned(a) != strip->IsTabPinned(b) ||
        strip->GetTabGroupForTab(a) != strip->GetTabGroupForTab(b)) {
      continue;
    }
    split_tabs::SplitTabVisualData visual(ToLayout(workspace.tabs[i].layout));
    if (workspace.tabs[i].split_ratio > 0) {
      visual.set_split_ratio(workspace.tabs[i].split_ratio);
    }
    strip->AddToNewSplit({a, b}, visual,
                         split_tabs::SplitTabCreatedSource::kKeyboardShortcut);
  }
  if (workspace.active < added.size() && added[workspace.active].Get()) {
    strip->ActivateTab(added[workspace.active].Get(),
                       TabStripUserGestureDetails(
                           TabStripUserGestureDetails::GestureType::kOther));
  }
  for (const tab_groups::TabGroupId& id : collapse) {
    TabGroup* group = strip->group_model()->GetTabGroup(id);
    tabs::TabInterface* active = strip->GetActiveTab();
    // The group holding the active tab stays open.
    if (group && !(active && active->GetGroup() == id)) {
      tab_groups::TabGroupVisualData visual = *group->visual_data();
      strip->ChangeTabGroupVisuals(
          id, tab_groups::TabGroupVisualData(visual.title(), visual.color(),
                                             /*is_collapsed=*/true));
    }
  }
  for (tabs::TabHandle handle : placeholders) {
    if (tabs::TabInterface* tab = handle.Get()) {
      const int index = strip->GetIndexOfTab(tab);
      if (index != TabStripModel::kNoTab && strip->count() > 1) {
        strip->CloseWebContentsAt(index, TabCloseTypes::CLOSE_NONE);
      }
    }
  }
  if (new_window) {
    if (ModalBrowserController* other = From(target)) {
      other->router_.SetWorkspace(workspace.name, workspace.project);
    }
    target->GetWindow()->Show();
  }
}

void ModalBrowserController::RequestItems(ffi::ItemSource source) {
  Profile* profile = browser_->GetProfile();
  auto deliver = [](base::WeakPtr<ModalBrowserController> self,
                    ffi::ItemSource source,
                    ::rust::Vec<ffi::ListItem> items) {
    if (self) {
      self->router_.OnItems(source, std::move(items), NowSeconds(), *self);
      self->PageWorkDone();
    }
  };
  switch (source) {
    case ffi::ItemSource::History: {
      history::HistoryService* history = HistoryServiceFactory::GetForProfile(
          profile, ServiceAccessType::EXPLICIT_ACCESS);
      if (!history) {
        deliver(weak_factory_.GetWeakPtr(), source, {});
        return;
      }
      history::QueryOptions options;
      options.max_count = kMaxHistoryItems;
      options.duplicate_policy = history::QueryOptions::REMOVE_ALL_DUPLICATES;
      history->QueryHistory(
          std::u16string(), options,
          base::BindOnce(
              [](decltype(deliver) deliver,
                 base::WeakPtr<ModalBrowserController> self,
                 history::QueryResults results) {
                ::rust::Vec<ffi::ListItem> items;
                for (const history::URLResult& r : results) {
                  const std::string url =
                      Bounded(r.url().spec(), 8 * 1024);
                  const std::string shown =
                      Bounded(MerlinDisplayUrl(r.url()), 8 * 1024);
                  items.push_back(ffi::ListItem{
                      ::rust::String::lossy(Bounded(
                          base::UTF16ToUTF8(r.title()), kMaxTabTextBytes)),
                      ::rust::String::lossy(shown), ::rust::String::lossy(url),
                      r.visit_time().ToTimeT(), false});
                }
                deliver(self, ffi::ItemSource::History, std::move(items));
              },
              deliver, weak_factory_.GetWeakPtr()),
          &history_tracker_);
      return;
    }
    case ffi::ItemSource::Bookmarks: {
      ::rust::Vec<ffi::ListItem> items;
      bookmarks::BookmarkModel* model =
          BookmarkModelFactory::GetForBrowserContext(profile);
      if (model && model->loaded()) {
        ui::TreeNodeIterator<const bookmarks::BookmarkNode> it(
            model->root_node());
        size_t n = 0;
        while (it.has_next() && n < kMaxBookmarkItems) {
          const bookmarks::BookmarkNode* node = it.Next();
          if (!node->is_url()) {
            continue;
          }
          const std::string url = Bounded(node->url().spec(), 8 * 1024);
          const std::string shown =
              Bounded(MerlinDisplayUrl(node->url()), 8 * 1024);
          const std::string folder =
              node->parent() ? base::UTF16ToUTF8(node->parent()->GetTitle())
                             : std::string();
          items.push_back(ffi::ListItem{
              ::rust::String::lossy(Bounded(
                  base::UTF16ToUTF8(node->GetTitle()), kMaxTabTextBytes)),
              ::rust::String::lossy(folder.empty() ? shown
                                                   : folder + " · " + shown),
              ::rust::String::lossy(url), 0, false});
          ++n;
        }
      }
      deliver(weak_factory_.GetWeakPtr(), source, std::move(items));
      return;
    }
    case ffi::ItemSource::Workspaces:
      workspace_store::List(base::BindOnce(
          [](decltype(deliver) deliver,
             base::WeakPtr<ModalBrowserController> self,
             std::vector<workspace_store::Entry> entries) {
            ::rust::Vec<ffi::ListItem> items;
            for (const workspace_store::Entry& e : entries) {
              items.push_back(ffi::ListItem{::rust::String(e.name),
                                            ::rust::String(), ::rust::String(e.name),
                                            e.modified, false});
            }
            deliver(self, ffi::ItemSource::Workspaces, std::move(items));
          },
          deliver, weak_factory_.GetWeakPtr()));
      return;
    case ffi::ItemSource::Downloads: {
      ::rust::Vec<ffi::ListItem> items;
      size_t n = 0;
      for (download::DownloadItem* item : MerlinDownloads(profile)) {
        if (n++ == 200) {
          break;
        }
        const std::string state = MerlinDownloadState(item);
        items.push_back(ffi::ListItem{
            ::rust::String::lossy(
                item->GetFileNameToReportUser().AsUTF8Unsafe()),
            ::rust::String::lossy(MerlinDownloadDetail(item)),
            ::rust::String(base::NumberToString(item->GetId())),
            item->GetStartTime().ToTimeT(),
            state == "progress" || state == "paused" ||
                state == "dangerous"});
      }
      deliver(weak_factory_.GetWeakPtr(), source, std::move(items));
      return;
    }
  }
}

void ModalBrowserController::ShowBrowserPage(ffi::BrowserPage page) {
  int command = IDC_OPTIONS;
  switch (page) {
    case ffi::BrowserPage::History:
      command = IDC_SHOW_HISTORY;
      break;
    case ffi::BrowserPage::Bookmarks:
      command = IDC_SHOW_BOOKMARK_MANAGER;
      break;
    case ffi::BrowserPage::Downloads:
      command = IDC_SHOW_DOWNLOADS;
      break;
    case ffi::BrowserPage::Extensions:
      command = IDC_MANAGE_EXTENSIONS;
      break;
    case ffi::BrowserPage::ReadingMode:
      command = IDC_SHOW_READING_MODE;
      break;
    case ffi::BrowserPage::SiteInfo:
      ShowSiteInfo();
      return;
    case ffi::BrowserPage::Settings:
    default:
      command = IDC_OPTIONS;
      break;
  }
  if (!chrome::ExecuteCommand(browser_, command)) {
    ShowMessage(ffi::MessageLevel::Error, "Not available in this window");
  }
}

void ModalBrowserController::RunBrowserCommand(std::string_view name,
                                               std::string_view arg) {
  if (name == "adblock") {
    auto* service = merlin_adblock::Service::Get(browser_->GetProfile());
    if (arg == "on" || arg == "off") {
      service->SetEnabled(arg == "on");
      ShowMessage(
          ffi::MessageLevel::Info,
          service->Status() + ". Reload the page to apply scriptlet changes.");
    } else if (arg == "site toggle") {
      auto* contents = ActiveContents();
      if (!contents || !contents->GetLastCommittedURL().SchemeIsHTTPOrHTTPS()) {
        ShowMessage(ffi::MessageLevel::Error,
                    "Site protection is available on web pages");
      } else {
        const bool enabled =
            service->ToggleSite(contents->GetLastCommittedURL());
        ShowMessage(ffi::MessageLevel::Info,
                    std::string(enabled ? "Protection enabled"
                                        : "Protection disabled") +
                        " for this site. Reload to apply page changes.");
      }
    } else if (arg == "update") {
      service->Refresh();
      ShowMessage(ffi::MessageLevel::Info, service->UpdateStatus());
    } else {
      auto* contents = ActiveContents();
      ShowMessage(
          ffi::MessageLevel::Info,
          service->Status() + "; " +
              base::NumberToString(service->Blocked(
                  contents ? contents->GetPrimaryMainFrame() : nullptr)) +
              " blocked on this page. " + service->UpdateStatus());
    }
    return;
  }
  if (base::StartsWith(name, "download-")) {
    uint32_t id = 0;
    if (!base::StringToUint(arg, &id)) {
      ShowMessage(ffi::MessageLevel::Error, "Expected a download id");
      return;
    }
    const std::string error =
        RunMerlinDownloadAction(browser_->GetProfile(), name, id);
    if (!error.empty()) {
      ShowMessage(ffi::MessageLevel::Error, error);
    }
    return;
  }
  static constexpr std::pair<std::string_view, int> kCommands[] = {
      {"print", IDC_PRINT},
      {"save-page", IDC_SAVE_PAGE},
      {"zoom-in", IDC_ZOOM_PLUS},
      {"zoom-out", IDC_ZOOM_MINUS},
      {"zoom-reset", IDC_ZOOM_NORMAL},
      {"fullscreen", IDC_FULLSCREEN},
      {"task-manager", IDC_TASK_MANAGER_MAIN_MENU},
      {"clear-data", IDC_CLEAR_BROWSING_DATA},
      {"passwords", IDC_SHOW_PASSWORD_MANAGER},
      {"cast", IDC_ROUTE_MEDIA},
      {"view-source", IDC_VIEW_SOURCE},
      {"quit", IDC_EXIT},
  };
  for (const auto& [command, id] : kCommands) {
    if (command == name) {
      if (!chrome::ExecuteCommand(browser_, id)) {
        ShowMessage(ffi::MessageLevel::Error, "Not available here");
      }
      return;
    }
  }
  ShowMessage(ffi::MessageLevel::Error,
              "Unknown action " + std::string(name));
}

void ModalBrowserController::ToggleDevTools() {
  chrome::ExecuteCommand(browser_, IDC_DEV_TOOLS_TOGGLE);
}

void ModalBrowserController::AddBookmark() {
  if (!chrome::ExecuteCommand(browser_, IDC_BOOKMARK_THIS_TAB)) {
    ShowMessage(ffi::MessageLevel::Error, "This page cannot be bookmarked");
  }
}

// -- BrowserOps: page structure and selection -----------------------------------

void ModalBrowserController::CollectDocument(uint32_t generation) {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    return;
  }
  content::RenderFrameHost* frame = contents->GetPrimaryMainFrame();
  document_frame_ = frame->GetGlobalId();
  frame->ExecuteJavaScriptInIsolatedWorld(
      page_scripts::DocumentScript(),
      base::BindOnce(&ModalBrowserController::OnDocument,
                     weak_factory_.GetWeakPtr(), generation),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

void ModalBrowserController::OnDocument(uint32_t generation,
                                        base::Value result) {
  std::optional<page_scripts::PageDocument> doc =
      page_scripts::ParseDocument(result);
  ::rust::Vec<ffi::PageBlock> blocks;
  std::string title, url;
  if (doc) {
    title = doc->title;
    url = doc->url;
    for (page_scripts::PageBlock& b : doc->blocks) {
      ::rust::Vec<ffi::PageSpan> spans;
      for (const page_scripts::PageSpan& sp : b.spans) {
        spans.push_back(ffi::PageSpan{sp.start, sp.end, sp.kind,
                                      ::rust::String::lossy(sp.href)});
      }
      blocks.push_back(ffi::PageBlock{
          b.kind, b.level, b.ordered, b.header, ::rust::String::lossy(b.lang),
          ::rust::String::lossy(b.text), b.element, std::move(spans)});
    }
  }
  router_.OnDocumentCollected(generation, base::IsStringUTF8(title) ? title : "",
                              base::IsStringUTF8(url) ? url : "",
                              std::move(blocks), *this);
  PageWorkDone();
}

void ModalBrowserController::RevealElement(uint32_t element) {
  content::WebContents* contents = ActiveContents();
  content::RenderFrameHost* frame =
      content::RenderFrameHost::FromID(document_frame_);
  if (!contents || !frame || frame != contents->GetPrimaryMainFrame()) {
    ShowMessage(ffi::MessageLevel::Error, "The page changed; open the outline again");
    return;
  }
  frame->ExecuteJavaScriptInIsolatedWorld(
      page_scripts::RevealScript(element),
      base::BindOnce(
          [](base::WeakPtr<ModalBrowserController> self, base::Value ok) {
            if (self && !(ok.is_bool() && ok.GetBool())) {
              self->ShowMessage(ffi::MessageLevel::Error,
                                "That part of the page is gone");
            }
            if (self) {
              self->PageWorkDone();
            }
          },
          weak_factory_.GetWeakPtr()),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

void ModalBrowserController::JumpToBlock(ffi::BlockJump kind,
                                         bool forward,
                                         int count) {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    return;
  }
  contents->GetPrimaryMainFrame()->ExecuteJavaScriptInIsolatedWorld(
      page_scripts::JumpScript(kind, forward, count),
      base::BindOnce(
          [](base::WeakPtr<ModalBrowserController> self, bool forward,
             base::Value moved) {
            if (!self) {
              return;
            }
            if (!(moved.is_bool() && moved.GetBool())) {
              self->ShowMessage(ffi::MessageLevel::Info,
                                forward ? "Nothing further down"
                                        : "Nothing further up");
            }
            self->PageWorkDone();
          },
          weak_factory_.GetWeakPtr(), forward),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

void ModalBrowserController::CopyText(std::string_view text,
                                      std::string_view what) {
  const std::u16string text16 = base::UTF8ToUTF16(text);
  ui::ScopedClipboardWriter(ui::ClipboardBuffer::kCopyPaste).WriteText(text16);
  const size_t lines = std::count(text.begin(), text.end(), '\n');
  status_->ShowMessage(u"Copied " + base::UTF8ToUTF16(what) + u" (" +
                           base::NumberToString16(std::max<size_t>(lines, 1)) +
                           (lines > 1 ? u" lines)" : u" line)"),
                       /*is_error=*/false);
}

void ModalBrowserController::OpenInEditor(std::string_view text,
                                          std::string_view extension,
                                          const std::vector<std::string>& argv) {
  if (browser_->GetProfile()->IsOffTheRecord()) {
    ShowMessage(ffi::MessageLevel::Error,
                "Editor exports are disabled in private windows");
    return;
  }
  if (exports_.size() >= kMaxExports) {
    exports_.erase(exports_.begin());  // stops watching the oldest
  }
  ExternalEditor::Options options;
  options.argv = argv;
  options.text = std::string(text);
  options.extension = std::string(extension);
  options.read_only = true;
  const int id = next_export_++;
  exports_[id] = std::make_unique<ExternalEditor>(
      std::move(options), base::DoNothing(),
      base::BindOnce(
          [](base::WeakPtr<ModalBrowserController> self, int id,
             std::string error) {
            if (!self) {
              return;
            }
            if (!error.empty()) {
              self->ShowMessage(ffi::MessageLevel::Error, error);
            }
            self->exports_.erase(id);
          },
          weak_factory_.GetWeakPtr(), id));
  ShowMessage(ffi::MessageLevel::Info, "Opened in your editor (read-only copy)");
}

content::RenderFrameHost* ModalBrowserController::FocusedFrame() {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    return nullptr;
  }
  content::RenderFrameHost* frame = contents->GetFocusedFrame();
  return frame ? frame : contents->GetPrimaryMainFrame();
}

void ModalBrowserController::CancelFieldEdit() {
  ++edit_generation_;
  edit_writes_pending_ = 0;
  edit_done_ = false;
  edit_document_ = content::WeakDocumentPtr();
  if (field_editor_) {
    if (!field_editor_->path().empty()) {
      field_editor_->KeepFile();
      ShowMessage(ffi::MessageLevel::Info,
                  "Stopped external editing; your file is kept at " +
                      field_editor_->path().value());
    }
    field_editor_.reset();
  }
}

void ModalBrowserController::InspectField(bool force) {
  CancelFieldEdit();
  if (browser_->GetProfile()->IsOffTheRecord()) {
    ShowMessage(ffi::MessageLevel::Error,
                "External editing is disabled in private windows");
    PageWorkDone();
    return;
  }
  content::RenderFrameHost* frame = FocusedFrame();
  if (!frame) {
    return;
  }
  // A fresh random token per request: a page cannot guess which element
  // the browser will write to, or replay an old request.
  edit_target_ = EditTarget{browser_->GetActiveTabInterface()->GetHandle().raw_value(),
                            frame->GetGlobalId(),
                            frame->GetLastCommittedOrigin(),
                            base::RandUint64()};
  edit_document_ = frame->GetWeakDocumentPtr();
  frame->ExecuteJavaScriptInIsolatedWorld(
      page_scripts::FieldInfoScript(edit_target_.token),
      base::BindOnce(&ModalBrowserController::OnFieldInfo,
                     weak_factory_.GetWeakPtr(), edit_generation_, force),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

void ModalBrowserController::OnFieldInfo(uint64_t generation,
                                          bool force,
                                          base::Value result) {
  if (generation != edit_generation_) {
    return;
  }
  std::optional<page_scripts::FieldDescription> info =
      page_scripts::ParseFieldInfo(result);
  if (!info) {
    ShowMessage(ffi::MessageLevel::Error, "Could not read the field");
    PageWorkDone();
    return;
  }
  router_.OnFieldInfo(
      ffi::FieldInfo{info->kind, ::rust::String::lossy(info->input_type),
                     ::rust::String::lossy(info->autocomplete),
                     ::rust::String::lossy(info->label), info->length,
                     info->read_only},
      force, *this);
  PageWorkDone();
}

void ModalBrowserController::EditField(const std::vector<std::string>& argv) {
  content::RenderFrameHost* frame =
      edit_document_.AsRenderFrameHostIfValid();
  if (!frame) {
    ShowMessage(ffi::MessageLevel::Error, "The page changed; try again");
    return;
  }
  frame->ExecuteJavaScriptInIsolatedWorld(
      page_scripts::FieldValueScript(edit_target_.token),
      base::BindOnce(&ModalBrowserController::OnFieldValue,
                     weak_factory_.GetWeakPtr(), edit_generation_, argv),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

void ModalBrowserController::OnFieldValue(uint64_t generation,
                                           std::vector<std::string> argv,
                                          base::Value result) {
  if (generation != edit_generation_) {
    return;
  }
  if (!result.is_string() ||
      result.GetString().size() > page_scripts::kMaxTextBytes) {
    ShowMessage(ffi::MessageLevel::Error, "The field is gone");
    PageWorkDone();
    return;
  }
  if (!edit_document_.AsRenderFrameHostIfValid()) {
    PageWorkDone();
    return;
  }
  ExternalEditor::Options options;
  options.argv = std::move(argv);
  options.text = result.GetString();
  options.extension = "md";  // comment boxes are usually Markdown
  // Callbacks are scoped to this edit generation, including queued saves.
  field_editor_ = std::make_unique<ExternalEditor>(
      std::move(options),
      base::BindRepeating(&ModalBrowserController::WriteBackField,
                          weak_factory_.GetWeakPtr(), generation),
      base::BindOnce(&ModalBrowserController::OnFieldEditDone,
                     weak_factory_.GetWeakPtr(), generation));
  ShowMessage(ffi::MessageLevel::Info,
              "Editing in your editor; each save updates the field");
  PageWorkDone();
}

void ModalBrowserController::WriteBackField(uint64_t generation,
                                            std::string text) {
  if (generation != edit_generation_) {
    return;
  }
  content::RenderFrameHost* frame =
      edit_document_.AsRenderFrameHostIfValid();
  tabs::TabInterface* tab = tabs::TabHandle(edit_target_.tab).Get();
  // Only into the same field, on the same page, from the same origin.
  if (!frame || !tab ||
      frame->GetLastCommittedOrigin() != edit_target_.origin) {
    OnFieldWritten(generation, base::Value(false));
    return;
  }
  ++edit_writes_pending_;
  frame->ExecuteJavaScriptInIsolatedWorld(
      page_scripts::FieldWriteScript(edit_target_.token, text),
      base::BindOnce(&ModalBrowserController::OnFieldWritten,
                     weak_factory_.GetWeakPtr(), generation),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

void ModalBrowserController::OnFieldWritten(uint64_t generation,
                                            base::Value result) {
  if (generation != edit_generation_) {
    return;
  }
  if (edit_writes_pending_ > 0) {
    --edit_writes_pending_;
  }
  if (result.is_bool() && result.GetBool()) {
    ShowMessage(ffi::MessageLevel::Info, "Updated the field from your editor");
    if (edit_done_ && edit_writes_pending_ == 0) {
      field_editor_.reset();
    }
  } else if (field_editor_) {
    // Never lose what the user wrote: keep the file and say where it is.
    field_editor_->KeepFile();
    ShowMessage(ffi::MessageLevel::Error,
                "The field is gone; your text is in " +
                    field_editor_->path().value());
    field_editor_.reset();
  }
  PageWorkDone();
}

void ModalBrowserController::OnFieldEditDone(uint64_t generation,
                                             std::string error) {
  if (generation != edit_generation_) {
    return;
  }
  edit_done_ = true;
  if (!error.empty() && field_editor_) {
    field_editor_->KeepFile();
    error += "; your file is kept at " + field_editor_->path().value();
  }
  if (!error.empty()) {
    ShowMessage(ffi::MessageLevel::Error, error);
  }
  if (edit_writes_pending_ == 0) {
    field_editor_.reset();
  }
  PageWorkDone();
}

void ModalBrowserController::ExtendSelection(bool forward,
                                             ffi::SelectUnit unit,
                                             int count) {
  if (content::RenderFrameHost* frame = FocusedFrame()) {
    frame->ExecuteJavaScriptInIsolatedWorld(
        page_scripts::ExtendSelectionScript(forward, unit, count),
        base::BindOnce(
            [](base::WeakPtr<ModalBrowserController> self, base::Value) {
              if (self) {
                self->PageWorkDone();
              }
            },
            weak_factory_.GetWeakPtr()),
        ISOLATED_WORLD_ID_CHROME_INTERNAL);
  }
}

void ModalBrowserController::ClearSelection() {
  if (content::RenderFrameHost* frame = FocusedFrame()) {
    frame->ExecuteJavaScriptInIsolatedWorld(page_scripts::ClearSelectionScript(),
                                            base::NullCallback(),
                                            ISOLATED_WORLD_ID_CHROME_INTERNAL);
  }
}

void ModalBrowserController::RecordMark(std::string_view letter) {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    return;
  }
  contents->GetPrimaryMainFrame()->ExecuteJavaScriptInIsolatedWorld(
      page_scripts::MarkPositionScript(),
      base::BindOnce(&ModalBrowserController::OnMarkPosition,
                     weak_factory_.GetWeakPtr(), std::string(letter)),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

void ModalBrowserController::OnMarkPosition(std::string letter,
                                            base::Value result) {
  std::optional<page_scripts::MarkPosition> pos =
      page_scripts::ParseMarkPosition(result);
  // Remember the browser's view of the URL, not the page's claim.
  content::WebContents* contents = ActiveContents();
  if (!pos || !contents) {
    ShowMessage(ffi::MessageLevel::Error, "Could not read the page position");
  } else {
    router_.OnMarkRecorded(letter, contents->GetLastCommittedURL().spec(),
                           pos->x, pos->y, *this);
  }
  PageWorkDone();
}

void ModalBrowserController::GoToMark(std::string_view letter,
                                      std::string_view url,
                                      int64_t x,
                                      int64_t y,
                                      bool navigate) {
  content::WebContents* contents = ActiveContents();
  if (!contents) {
    return;
  }
  GURL::Replacements no_ref;
  no_ref.ClearRef();
  const GURL target(url);
  const bool same_page =
      target.ReplaceComponents(no_ref) ==
      contents->GetLastCommittedURL().ReplaceComponents(no_ref);
  if (same_page) {
    contents->GetPrimaryMainFrame()->ExecuteJavaScriptInIsolatedWorld(
        page_scripts::ScrollToScript(x, y), base::NullCallback(),
        ISOLATED_WORLD_ID_CHROME_INTERNAL);
  } else if (navigate && IsAllowedCommandUrl(target)) {
    Navigate(target, ffi::OpenDisposition::CurrentTab);
  } else {
    ShowMessage(ffi::MessageLevel::Error,
                "Mark " + std::string(letter) + " is on another page (" +
                    std::string(url) + ")");
  }
}

void ModalBrowserController::ReadSelection(
    base::OnceCallback<void(std::string)> reply) {
  content::RenderFrameHost* frame = FocusedFrame();
  if (!frame) {
    std::move(reply).Run(std::string());
    return;
  }
  frame->ExecuteJavaScriptInIsolatedWorld(
      page_scripts::SelectionTextScript(),
      base::BindOnce(
          [](base::OnceCallback<void(std::string)> reply, base::Value v) {
            std::string text;
            if (v.is_string() && v.GetString().size() <= page_scripts::kMaxTextBytes &&
                base::IsStringUTF8(v.GetString())) {
              text = v.GetString();
            }
            std::move(reply).Run(std::move(text));
          },
          std::move(reply)),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

// -- browserctl ---------------------------------------------------------------

void ModalBrowserController::FocusTabNumber(uint32_t number,
                                            std::string* error) {
  TabStripModel* strip = browser_->GetTabStripModel();
  if (number < 1 || static_cast<int>(number) > strip->count()) {
    *error = "there are " + base::NumberToString(strip->count()) + " tabs";
    return;
  }
  strip->ActivateTabAt(static_cast<int>(number) - 1);
  browser_->GetWindow()->Activate();
}

namespace {

ffi::IpcTab TabSummary(BrowserWindowInterface* browser,
                       int index,
                       uint32_t window) {
  TabStripModel* strip = browser->GetTabStripModel();
  tabs::TabInterface* tab = strip->GetTabAtIndex(index);
  content::WebContents* contents = tab->GetContents();
  return ffi::IpcTab{
      window,
      static_cast<uint32_t>(index + 1),
      tab->GetHandle().raw_value(),
      ::rust::String::lossy(
          Bounded(base::UTF16ToUTF8(contents->GetTitle()), kMaxTabTextBytes)),
      ::rust::String::lossy(Bounded(contents->GetVisibleURL().spec(), 8 * 1024)),
      index == strip->active_index(),
      strip->IsTabPinned(index)};
}

}  // namespace

// static
void ModalBrowserController::HandleBrowserctlRequest(
    std::string line,
    base::OnceCallback<void(std::string)> reply) {
  ffi::IpcRequest request = ffi::ipc_parse(line);
  const int64_t id = request.id;
  auto ok = [id](std::string_view message) {
    return ToStd(ffi::ipc_reply_ok(id, ::rust::Str(message.data(), message.size())));
  };
  auto fail = [id](std::string_view message) {
    return ToStd(ffi::ipc_reply_error(id, ::rust::Str(message.data(), message.size())));
  };
  if (request.kind == ffi::IpcKind::Invalid) {
    std::move(reply).Run(fail(ToStd(request.error)));
    return;
  }
  // Normal windows that accept browserctl, front first. Private windows
  // are never listed, read or driven.
  std::vector<BrowserWindowInterface*> windows;
  GlobalBrowserCollection::GetInstance()->ForEach(
      [&windows](BrowserWindowInterface* browser) {
        ModalBrowserController* c = From(browser);
        if (c && !browser->GetProfile()->IsOffTheRecord() &&
            BrowserctlService::Get().Wants(c)) {
          windows.push_back(browser);
        }
        return true;
      },
      BrowserCollection::Order::kActivation);
  ModalBrowserController* front = windows.empty() ? nullptr : From(windows[0]);

  switch (request.kind) {
    case ffi::IpcKind::Ping:
      std::move(reply).Run(ToStd(ffi::ipc_reply_pong(id)));
      return;
    case ffi::IpcKind::Tabs: {
      ::rust::Vec<ffi::IpcTab> tabs;
      for (size_t w = 0; w < windows.size(); ++w) {
        for (int i = 0; i < windows[w]->GetTabStripModel()->count(); ++i) {
          tabs.push_back(TabSummary(windows[w], i, static_cast<uint32_t>(w + 1)));
        }
      }
      std::move(reply).Run(ToStd(ffi::ipc_reply_tabs(id, std::move(tabs))));
      return;
    }
    case ffi::IpcKind::WorkspaceHere:
      workspace_store::ReadAll(base::BindOnce(
          [](int64_t id, std::string dir,
             base::OnceCallback<void(std::string)> reply,
             std::vector<std::pair<std::string, std::string>> files) {
            ::rust::Vec<::rust::String> names;
            ::rust::Vec<::rust::String> texts;
            for (const auto& [name, text] : files) {
              names.push_back(::rust::String::lossy(name));
              texts.push_back(::rust::String::lossy(text));
            }
            const std::string name = ToStd(ffi::workspace_for_dir(
                ::rust::Slice<const ::rust::String>(names.data(), names.size()),
                ::rust::Slice<const ::rust::String>(texts.data(), texts.size()),
                ::rust::Str(dir.data(), dir.size())));
            if (name.empty()) {
              std::move(reply).Run(ToStd(ffi::ipc_reply_error(
                  id, "no workspace has a project folder containing " + dir)));
              return;
            }
            // Run in the front window when the reply comes back.
            std::vector<BrowserWindowInterface*> front;
            GlobalBrowserCollection::GetInstance()->ForEach(
                [&front](BrowserWindowInterface* b) {
                  ModalBrowserController* controller = From(b);
                  if (controller && !b->GetProfile()->IsOffTheRecord() &&
                      BrowserctlService::Get().Wants(controller)) {
                    front.push_back(b);
                    return false;
                  }
                  return true;
                },
                BrowserCollection::Order::kActivation);
            if (front.empty()) {
              std::move(reply).Run(ToStd(ffi::ipc_reply_error(
                  id, "no browser window accepts browserctl")));
              return;
            }
            const std::string error =
                From(front[0])->RunCommandLine("workspace open " + name);
            std::move(reply).Run(
                error.empty() ? ToStd(ffi::ipc_reply_ok(id, name))
                              : ToStd(ffi::ipc_reply_error(id, error)));
          },
          id, ToStd(request.text), std::move(reply)));
      return;
    case ffi::IpcKind::WorkspaceList:
      workspace_store::List(base::BindOnce(
          [](int64_t id, base::OnceCallback<void(std::string)> reply,
             std::vector<workspace_store::Entry> entries) {
            ::rust::Vec<::rust::String> names;
            for (const workspace_store::Entry& e : entries) {
              names.push_back(::rust::String(e.name));
            }
            std::move(reply).Run(ToStd(ffi::ipc_reply_names(id, std::move(names))));
          },
          id, std::move(reply)));
      return;
    default:
      break;
  }
  if (!front) {
    std::move(reply).Run(fail("no browser window accepts browserctl"));
    return;
  }
  const std::string text = ToStd(request.text);
  switch (request.kind) {
    case ffi::IpcKind::Open: {
      const std::string error = front->router_.OnOpenText(
          text, request.disposition, "browserctl", *front);
      std::move(reply).Run(error.empty() ? ok("") : fail(error));
      return;
    }
    case ffi::IpcKind::Focus: {
      std::string error;
      front->FocusTabNumber(request.number, &error);
      std::move(reply).Run(error.empty() ? ok("") : fail(error));
      return;
    }
    case ffi::IpcKind::Current: {
      TabStripModel* strip = front->browser_->GetTabStripModel();
      if (strip->active_index() == TabStripModel::kNoTab) {
        std::move(reply).Run(fail("no active tab"));
        return;
      }
      std::move(reply).Run(ToStd(ffi::ipc_reply_tab(
          id, TabSummary(front->browser_, strip->active_index(), 1))));
      return;
    }
    case ffi::IpcKind::Selection:
      front->ReadSelection(base::BindOnce(
          [](int64_t id, base::OnceCallback<void(std::string)> reply,
             std::string text) {
            std::move(reply).Run(ToStd(ffi::ipc_reply_ok(id, text)));
          },
          id, std::move(reply)));
      return;
    case ffi::IpcKind::WorkspaceSave:
    case ffi::IpcKind::WorkspaceOpen:
    case ffi::IpcKind::WorkspaceDelete: {
      // Names were validated in Rust (letters, digits, - _ .), so they need
      // no quoting on the command line.
      const char* verb = request.kind == ffi::IpcKind::WorkspaceSave ? "save"
                         : request.kind == ffi::IpcKind::WorkspaceOpen ? "open"
                                                                       : "delete";
      const std::string error =
          front->RunCommandLine(std::string("workspace ") + verb + " " + text);
      std::move(reply).Run(error.empty() ? ok("") : fail(error));
      return;
    }
    case ffi::IpcKind::Command: {
      const std::string error = front->RunCommandLine(text);
      std::move(reply).Run(error.empty() ? ok("") : fail(error));
      return;
    }
    default:
      std::move(reply).Run(fail("unsupported request"));
      return;
  }
}

// -- PaletteDelegate ----------------------------------------------------------

void ModalBrowserController::OnPaletteTextChanged(std::u16string_view text) {
  router_.OnPaletteTextChanged(base::UTF16ToUTF8(text), *this);
}

void ModalBrowserController::OnPaletteKey(ffi::PaletteKey key) {
  router_.OnPaletteKey(key, *this);
}

void ModalBrowserController::OnPaletteRowClicked(int index) {
  router_.OnPaletteRowClicked(index, *this);
}

gfx::ImageSkia ModalBrowserController::GetTabIcon(int32_t tab_id) {
  tabs::TabInterface* tab = tabs::TabHandle(tab_id).Get();
  content::WebContents* contents = tab ? tab->GetContents() : nullptr;
  if (!contents) {
    return gfx::ImageSkia();
  }
  favicon::ContentFaviconDriver* driver =
      favicon::ContentFaviconDriver::FromWebContents(contents);
  if (!driver || !driver->FaviconIsValid()) {
    return gfx::ImageSkia();
  }
  return driver->GetFavicon().AsImageSkia();
}

// -- Observers ----------------------------------------------------------------

void ModalBrowserController::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  if (selection.active_tab_changed()) {
    OnActiveTabChanged();
  }
  router_.RefreshTabs(*this);
  if (change.type() != TabStripModelChange::kSelectionOnly) {
    ScheduleAutosave();
  }
}

void ModalBrowserController::OnTabChangedAt(tabs::TabInterface* tab,
                                            TabChangeType change_type) {
  if (tab == browser_->GetActiveTabInterface()) {
    UpdatePageContext();
  }
  if (change_type != TabChangeType::kLoadingOnly) {
    router_.RefreshTabs(*this);  // titles and icons in an open switcher
    ScheduleAutosave();          // a page's URL or title changed
  }
}

void ModalBrowserController::ScheduleAutosave() {
  if (router_.autosave_workspace().empty()) {
    return;
  }
  // A closing window closes its tabs one by one: those are not changes to
  // keep. Save what the window held before.
  if (WindowClosing()) {
    autosave_timer_.Stop();
    return;
  }
  // Restarting the timer batches a burst of changes into one write.
  autosave_timer_.Start(
      FROM_HERE, kAutosaveDelay,
      base::BindOnce(
          [](ModalBrowserController* self) {
            const std::string name = self->router_.autosave_workspace();
            if (!name.empty() && !self->WindowClosing()) {
              self->SnapshotWorkspace(name, /*quiet=*/true);
            }
          },
          base::Unretained(this)));
}

void ModalBrowserController::OnActiveTabChanged() {
  ObserveActiveContents();
  if (tabs::TabInterface* tab = browser_->GetActiveTabInterface()) {
    router_.OnTabActivated(tab->GetHandle().raw_value());
  }
  content::WebContents* contents = ActiveContents();
  router_.OnPageChanged(contents ? contents->GetLastCommittedURL().host() : "",
                        *this);
  router_.OnFocusChanged(CurrentFocus(), *this);
  UpdatePageContext();
  if (merlin_ui_) {
    RestyleMerlinPage(contents);
  }
}

void ModalBrowserController::DidChangeVisibleSecurityState() {
  UpdatePageContext();
}

void ModalBrowserController::DocumentOnLoadCompletedInPrimaryMainFrame() {
  if (merlin_ui_) {
    RestyleMerlinPage(web_contents());
  }
}

void ModalBrowserController::UpdatePageContext() {
  if (!status_->card_mode()) {
    return;
  }
  ApplyTabLayout();
  content::WebContents* contents = ActiveContents();
  if (contents) {
    const GURL& page = contents->GetVisibleURL();
    const bool start_page = page.SchemeIs(content::kChromeUIScheme) &&
                            (page.host() == kMerlinStartHost ||
                             page.host() == "newtab");
    UpdateMerlinToolbar(contents, start_page);
  } else {
    UpdateMerlinToolbar(nullptr, /*start_page=*/false);
  }
}

void ModalBrowserController::OnFocusChangedInPage(
    const content::FocusedNodeDetails& details) {
  last_editable_level_ = details.editable_level;
  router_.OnFocusChanged(CurrentFocus(), *this);
}

void ModalBrowserController::PrimaryPageChanged(content::Page& page) {
  CancelFieldEdit();
  router_.OnPageChanged(page.GetMainDocument().GetLastCommittedURL().host(),
                        *this);
  UpdatePageContext();
}

void ModalBrowserController::DidGetUserInteraction(
    const blink::WebInputEvent& event) {
  // A click or scroll moves the page under the hint labels.
  if (event.GetType() == blink::WebInputEvent::Type::kMouseDown ||
      event.GetType() == blink::WebInputEvent::Type::kGestureScrollBegin) {
    router_.OnPointerActivity(*this);
  }
}

content::WebContents* ModalBrowserController::ActiveContents() {
  tabs::TabInterface* tab = browser_->GetActiveTabInterface();
  return tab ? tab->GetContents() : nullptr;
}

float ModalBrowserController::DeviceScaleFactor() {
  content::WebContents* contents = ActiveContents();
  content::RenderWidgetHostView* view =
      contents ? contents->GetRenderWidgetHostView() : nullptr;
  return view ? view->GetDeviceScaleFactor() : 1.f;
}

PageFocus ModalBrowserController::CurrentFocus() {
  content::WebContents* contents = ActiveContents();
  // Read focus synchronously on every key instead of trusting the last
  // notification: FocusChangedInPage is asynchronous and can trail a click.
  if (!contents || !contents->IsFocusedElementEditable()) {
    return PageFocus::kPage;
  }
  return last_editable_level_ == content::EditableLevel::kRichlyEditable
             ? PageFocus::kRichTextField
             : PageFocus::kPlainTextField;
}

void ModalBrowserController::ObserveActiveContents() {
  last_editable_level_ = content::EditableLevel::kNotEditable;
  Observe(ActiveContents());
  if (page_color_) {
    page_color_->Watch(ActiveContents());
  }
}

void ModalBrowserController::ApplyPageColor(std::optional<SkColor> color) {
  page_color_value_ = color;
  if (tab_bar_host_) {
    tab_bar_host_->SetPageColor(color);
  }
  if (ToolbarView* toolbar = browser_view_->toolbar()) {
    MerlinToolbarBackdrop::InstallIn(toolbar)->SetColor(color);
  }
  for (MerlinNavButton* button : {back_button_.get(), forward_button_.get(),
                                  reload_button_.get()}) {
    if (button) {
      button->SetSurface(color);
    }
  }
  if (address_field_) {
    address_field_->SetSurface(color);
  }
  if (safety_controls_) {
    safety_controls_->SetSurface(color);
  }
  if (downloads_button_) {
    downloads_button_->SetSurface(color);
  }
}

bool ModalBrowserController::WindowClosing() const {
  TabStripModel* strip = browser_->GetTabStripModel();
  return !strip || strip->closing_all() || strip->empty() ||
         (browser_view_ && browser_view_->GetWidget() &&
          browser_view_->GetWidget()->IsClosed());
}

void ModalBrowserController::PageWorkDone() {
  if (page_work_done_for_testing_) {
    page_work_done_for_testing_.Run();
  }
}

}  // namespace modal_browser
