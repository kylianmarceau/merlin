// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
// Window lifecycle follows Chromium's BrowserWindow/Widget contracts. React
// Native owns the visible chrome; no BrowserView or WebUI renderer is created.
#include "chrome/browser/ui/modal_browser/merlin_react_window.h"
#include "chrome/browser/ui/modal_browser/merlin_react_find_bar.h"
#include "chrome/browser/ui/modal_browser/merlin_react_autofill.h"
#include "chrome/browser/ui/autofill/autofill_bubble_handler.h"
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <dlfcn.h>
#include <cstddef>
#include <algorithm>
#include <vector>
#include <map>
#include "base/check.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/observer_list.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/lifetime/application_lifetime.h"
#include "chrome/browser/lifetime/application_lifetime_desktop.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/translate/chrome_translate_client.h"
#include "chrome/browser/ui/browser_tabstrip.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/translate/core/browser/translate_manager.h"
#include "components/translate/core/browser/translate_prefs.h"
#include "ui/base/l10n/l10n_util.h"
#include "chrome/browser/bookmarks/bookmark_model_factory.h"
#include "components/bookmarks/browser/bookmark_model.h"
#include "components/bookmarks/browser/bookmark_utils.h"
#include "chrome/browser/themes/theme_service.h"
#include "chrome/browser/ui/browser_command_controller.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_window.h"
#include "chrome/browser/ui/browser_window/public/browser_window_features.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window_state.h"
#include "chrome/browser/ui/browser_active_state_manager/browser_active_state_manager.h"
#import "chrome/browser/ui/cocoa/browser_window_command_handler.h"
#import "chrome/browser/ui/cocoa/chrome_command_dispatcher_delegate.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_context.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_manager.h"
#include "chrome/browser/ui/exclusive_access/fullscreen_controller.h"
#include "chrome/browser/ui/find_bar/find_bar.h"
#include "chrome/browser/ui/fullscreen/browser_window_fullscreen_controller.h"
#include "chrome/browser/ui/location_bar/location_bar.h"
#include "chrome/browser/ui/views/bubble_anchor_util_views.h"
#include "chrome/browser/ui/views/eye_dropper/eye_dropper.h"
#include "components/omnibox/browser/location_bar_model.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_host_api.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/split_tabs/split_tab_id.h"
#include "components/tabs/public/split_tab_data.h"
#include "components/tabs/public/tab_interface.h"
#include "chrome/browser/ui/unload_controller.h"
#include "chrome/browser/ui/views/exclusive_access/exclusive_access_bubble_views.h"
#include "chrome/browser/ui/views/exclusive_access/exclusive_access_bubble_views_context.h"
#include "components/input/native_web_keyboard_event.h"
#import "components/remote_cocoa/app_shim/native_widget_ns_window_bridge.h"
#include "components/web_modal/web_contents_modal_dialog_host.h"
#include "content/public/browser/eye_dropper.h"
#include "content/public/browser/keyboard_event_processing_result.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/accelerators/accelerator.h"
#include "ui/base/mojom/window_show_state.mojom.h"
#include "ui/gfx/native_ui_util.h"
#include "ui/views/cocoa/native_widget_mac_ns_window_host.h"
#include "ui/views/controls/native/native_view_host.h"
#include "ui/views/widget/native_widget_mac.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_delegate.h"
#include "ui/views/widget/widget_observer.h"
#include "url/gurl.h"
#include "url/url_constants.h"

namespace modal_browser {
namespace {
using Dict = base::DictValue;
using List = base::ListValue;
const MerlinShellAPI* ShellAPI() {
  auto get = reinterpret_cast<MerlinShellGetAPIFn>(dlsym(RTLD_DEFAULT, "MerlinShellGetAPI"));
  const auto* api = get ? get(1) : nullptr;
  CHECK(api && api->abi_version == 1 && api->struct_size >= offsetof(MerlinShellAPI, prewarm) &&
        api->create_root && api->release_root) << "Launch with Merlin's React Native host executable";
  return api;
}

class ReactBrowserWindow;
// The React windows by their browser, for RemountReactShell.
std::map<BrowserWindowInterface*, ReactBrowserWindow*>& ReactWindows() {
  static base::NoDestructor<std::map<BrowserWindowInterface*, ReactBrowserWindow*>> windows;
  return *windows;
}

Dict Action(const char* id, const char* label, const char* emphasis = "normal") {
  return Dict().Set("id", id).Set("label", label).Set("emphasis", emphasis);
}

// Keeps Chromium's menu command validation and macOS event redispatch without
// bringing BrowserView's toolbar/tab-strip hierarchy into the window.
class ReactNativeWidget : public views::NativeWidgetMac {
 public:
  ReactNativeWidget(BrowserWindowInterface* browser, views::Widget* widget)
      : NativeWidgetMac(widget), browser_(browser) {}
 private:
  void OnWidgetDestroyed(views::Widget* widget) override {
    browser_ = nullptr;
    NativeWidgetMac::OnWidgetDestroyed(widget);
  }
  void OnWindowInitialized() override {
    if (auto* bridge = GetInProcessNSWindowBridge()) {
      bridge->SetCommandDispatcher([[ChromeCommandDispatcherDelegate alloc] init],
                                    [[BrowserWindowCommandHandler alloc] init]);
      // React draws the window, not the Views layer under it, so the window
      // is shown when React has drawn (ReactBrowserWindow::HoldUntilDrawn)
      // rather than when that empty layer first composites (patches/0075).
      bridge->ShowWithoutWaitingForFirstFrame();
    }
  }
  // As BrowserNativeWidgetMac: once macOS has finished going into or out of
  // fullscreen, Chromium's fullscreen state follows the window. Leaving it
  // with the green button or Mission Control also ends a page's fullscreen,
  // and the shell brings its tabs and toolbar back.
  void OnWindowFullscreenTransitionComplete() override {
    NativeWidgetMac::OnWindowFullscreenTransitionComplete();
    if (!browser_) return;
    ExclusiveAccessManager::From(browser_)->fullscreen_controller()->WindowFullscreenStateChanged();
    NotifyShellWindow(browser_);
  }
  void ValidateUserInterfaceItem(int32_t command,
      remote_cocoa::mojom::ValidateUserInterfaceItemResult* result) override {
    result->enable = browser_ && chrome::IsCommandEnabled(browser_, command);
  }
  bool ExecuteCommand(int32_t command, WindowOpenDisposition disposition,
                       bool before_responder) override {
    if (!browser_ || before_responder || !chrome::IsCommandEnabled(browser_, command)) return false;
    // Settings, history, downloads and bookmarks reach the shell through
    // chrome::Show* (patches/0073) from every caller; extensions open the
    // shell's popover here.
    if (command == IDC_MANAGE_EXTENSIONS && OpenShellPanel(browser_, "extensions")) return true;
    // Command-T and File > New Tab: the shell's pop-up when new tabs are
    // pop-ups, so no blank tab opens and closes again behind it.
    if (command == IDC_NEW_TAB && OpenNewTabPopup(browser_)) return true;
    // Command-W and File > Close Tab preserve a pin and close its page.
    if (command == IDC_CLOSE_TAB && ClosePinnedShellTab(browser_, browser_->GetTabStripModel()->active_index()))
      return true;
    // Command-D and Bookmarks > Bookmark This Tab: into the Bookmarks Bar
    // folder, as the shell's star does, with no Chromium bubble.
    if (command == IDC_BOOKMARK_THIS_TAB) {
      if (auto* controller = modal_browser::ModalBrowserController::From(browser_)) {
        controller->AddBookmark();
        return true;
      }
    }
    // Ctrl-Tab: Merlin's switcher, which walks through every recent tab
    // while Control is held (Chromium's only toggles between two).
    if ((command == IDC_CYCLE_TO_NEXT_TAB || command == IDC_CYCLE_TO_PREV_TAB) &&
        CycleShellTabs(browser_, command == IDC_CYCLE_TO_NEXT_TAB))
      return true;
    chrome::ExecuteCommandWithDisposition(browser_, command, disposition);
    return true;
  }
  void PopulateCreateWindowParams(const views::Widget::InitParams&,
      remote_cocoa::mojom::CreateWindowParams* params) override {
    params->style_mask = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
        NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView;
    params->window_class = remote_cocoa::mojom::WindowClass::kBrowser;
    params->titlebar_appears_transparent = true;
    params->window_title_hidden = true;
    params->animation_enabled = true;
  }
  raw_ptr<BrowserWindowInterface> browser_;
};

class ReactWindowDelegate : public views::WidgetDelegate {
 public:
  explicit ReactWindowDelegate(BrowserWindowInterface* browser) : browser_(browser) {
    SetCanResize(true); SetCanMaximize(true); SetCanMinimize(true); SetCanFullscreen(true);
  }
  std::u16string GetWindowTitle() const override { return u"Merlin"; }
  bool ShouldSaveWindowPlacement() const override { return chrome::ShouldSaveWindowPlacement(browser_); }
  void SaveWindowPlacement(const gfx::Rect& bounds, ui::mojom::WindowShowState state) override {
    if (state != ui::mojom::WindowShowState::kFullscreen) chrome::SaveWindowPlacement(browser_, bounds, state);
  }
 private:
  raw_ptr<BrowserWindowInterface> browser_;
};

// Compatibility adapter for Chromium commands. Text editing and suggestions
// belong to React; the browser's URL/security model stays in Chromium.
class ReactLocationBar final : public LocationBar {
 public:
  explicit ReactLocationBar(BrowserWindowInterface* browser)
      : LocationBar(chrome::BrowserCommandController::From(browser)), browser_(browser) {}
  ~ReactLocationBar() override = default;
  void FocusLocation(bool, bool) override { SendShellEvent(browser_, "address.focus"); }
  void FocusSearch() override { FocusLocation(true, true); }
  void Revert() override { SendShellEvent(browser_, "address.revert"); }
  void UpdateFocusBehavior(bool) override {}
  void UpdateContentSettingsIcons() override { NotifyShellWindow(browser_); }
  void SaveStateToContents(content::WebContents*) override {}
  OmniboxView* GetOmniboxView() override { return nullptr; }
  OmniboxPopupView* GetOmniboxPopupView() override { return nullptr; }
  OmniboxController* GetOmniboxController() override { return nullptr; }
  bool ShouldCloseOmniboxPopup(ui::MouseEvent*) override { return true; }
  ChipController* GetChipController() override { return nullptr; }
  content::WebContents* GetWebContents() override { return browser_->GetTabStripModel()->GetActiveWebContents(); }
  LocationBarModel* GetLocationBarModel() override { return LocationBarModel::From(browser_.get()); }
  std::optional<bubble_anchor_util::AnchorConfiguration> GetChipAnchor() override { return std::nullopt; }
  ui::TrackedElement* GetAnchorOrNull() override { return nullptr; }
  BrowserWindowInterface* GetBrowser() override { return browser_; }
  Profile* GetProfile() override { return browser_->GetProfile(); }
  void OnChanged() override { NotifyShellWindow(browser_); }
  void UpdateWithoutTabRestore() override { OnChanged(); }
  bool IsInitialized() const override { return true; }
  bool IsVisible() const override { return true; }
  bool IsDrawn() const override { return browser_->GetWindow() && browser_->GetWindow()->IsVisible(); }
  bool IsFullscreen() const override { return browser_->GetWindow() && browser_->GetWindow()->IsFullscreen(); }
  bool IsEditingOrEmpty() const override { return false; }
  bool IsMouseHovered() const override { return false; }
  bool IsFocusWithin() const override { return false; }
  void InvalidateLayout() override {}
  gfx::Rect Bounds() const override { return {}; }
  gfx::Rect BoundsInScreen() const override { return {}; }
  gfx::Size MinimumSize() const override { return {}; }
  gfx::Size PreferredSize() const override { return {}; }
  void Update(content::WebContents*) override { OnChanged(); }
  void ResetTabState(content::WebContents*) override { OnChanged(); }
  bool HasSecurityStateChanged() override { return true; }
  LocationBarTesting* GetLocationBarForTesting() override { return nullptr; }
  void AnnounceAlert(const std::u16string&) override { NotifyShellWindow(browser_); }
 private:
  raw_ptr<BrowserWindowInterface> browser_;
};

class ReactBrowserWindow final : public BrowserWindow,
                                public views::WidgetObserver,
                                public ExclusiveAccessContext,
                                public ExclusiveAccessBubbleViewsContext,
                                public ui::AcceleratorProvider,
                                public web_modal::WebContentsModalDialogHost {
 public:
  explicit ReactBrowserWindow(BrowserWindowInterface* browser)
      : browser_(browser), delegate_(browser), location_bar_(browser), api_(ShellAPI()),
        autofill_(CreateReactAutofillBubbleHandler(browser)) {
    widget_ = std::make_unique<views::Widget>();
    views::Widget::InitParams params(views::Widget::InitParams::CLIENT_OWNS_WIDGET);
    params.name = "MerlinReactWindow";
    params.delegate = &delegate_;
    params.native_widget = new ReactNativeWidget(browser_, widget_.get());
    chrome::GetSavedWindowBoundsAndShowState(browser_, &params.bounds, &params.show_state);
    if (params.bounds.IsEmpty()) params.bounds = gfx::Rect(80, 80, 1200, 800);
    widget_->Init(std::move(params));
    // Pop-ups keep the size the page asked for; browser windows keep room
    // for the sidebar and toolbar.
    widget_->GetNativeWindow().GetNativeNSWindow().contentMinSize =
        browser_->GetType() == BrowserWindowInterface::TYPE_POPUP ? NSMakeSize(240, 160) : NSMakeSize(720, 480);
    widget_->AddObserver(this);
    page_host_ = widget_->SetClientContentsView(std::make_unique<views::NativeViewHost>());
    ArmClose();
    ReactWindows()[browser_.get()] = this;
  }
  ~ReactBrowserWindow() override {
    ReactWindows().erase(browser_.get());
    weak_factory_.InvalidateWeakPtrs();
    if (content_observer_) [NSNotificationCenter.defaultCenter removeObserver:content_observer_];
    modal_observers_.Notify(&web_modal::ModalDialogHostObserver::OnHostDestroying);
    browser_->GetFeatures().TearDownPreBrowserWindowDestruction();
    bubble_.reset();
    if (root_) {
      page_host_->Detach();
      api_->release_root(root_);
      root_ = nullptr;
    }
    page_host_ = nullptr;
    widget_->RemoveObserver(this);
    widget_.reset();
  }
  void Mount() {
    if (root_) return;
    const std::string id = base::NumberToString(browser_->GetSessionID().id());
    root_ = api_->create_root(id.c_str());
    CHECK(root_);
    page_host_->Attach(gfx::NativeView((__bridge NSView*)root_.get()));
  }
  // A new React root in place of this one: the interface starts again from
  // the browser's state, while the tabs and their pages carry on.
  void Remount() {
    if (!root_) return;
    page_host_->Detach();
    api_->release_root(root_);
    root_ = nullptr;
    Mount();
  }
  void Show() override { Mount(); HoldUntilDrawn(); BrowserActiveStateManager::From(browser_)->DidBecomeActive(); widget_->Show(); }
  void ShowInactive() override { Mount(); HoldUntilDrawn(); widget_->ShowInactive(); }
  void Hide() override { widget_->Hide(); }
  void Close() override { widget_->Close(); }
  void Activate() override { widget_->Activate(); }
  void Deactivate() override { widget_->Deactivate(); }
  bool IsActive() const override { return widget_->IsActive(); }
  bool IsVisible() const override { return widget_->IsVisible(); }
  bool IsVisibleOnScreen() const override { return IsVisible() && !IsMinimized(); }
  bool IsOnCurrentWorkspace() const override { return GetNativeWindow().GetNativeNSWindow().onActiveSpace; }
  bool IsMaximized() const override { return widget_->IsMaximized(); }
  bool IsMinimized() const override { return widget_->IsMinimized(); }
  bool IsFullscreen() const override { return widget_->IsFullscreen(); }
  gfx::NativeWindow GetNativeWindow() const override { return widget_->GetNativeWindow(); }
  gfx::Rect GetBounds() const override { return widget_->GetWindowBoundsInScreen(); }
  gfx::Rect GetRestoredBounds() const override { return widget_->GetRestoredBounds(); }
  ui::mojom::WindowShowState GetRestoredState() const override { return IsMaximized() ? ui::mojom::WindowShowState::kMaximized : ui::mojom::WindowShowState::kNormal; }
  ui::mojom::WindowShowState GetWindowShowState() const override {
    if (IsFullscreen()) return ui::mojom::WindowShowState::kFullscreen;
    if (IsMinimized()) return ui::mojom::WindowShowState::kMinimized;
    if (IsMaximized()) return ui::mojom::WindowShowState::kMaximized;
    return ui::mojom::WindowShowState::kNormal;
  }
  void SetBounds(const gfx::Rect& bounds) override { widget_->SetBounds(bounds); }
  void Maximize() override { widget_->Maximize(); }
  void Minimize() override { widget_->Minimize(); }
  void Restore() override { widget_->Restore(); }
  void FlashFrame(bool flash) override { widget_->FlashFrame(flash); }
  ui::ZOrderLevel GetZOrderLevel() const override { return widget_->GetZOrderLevel(); }
  void SetZOrderLevel(ui::ZOrderLevel level) override { widget_->SetZOrderLevel(level); }
  ui::NativeTheme* GetNativeTheme() override { return widget_->GetNativeTheme(); }
  const ui::ThemeProvider* GetThemeProvider() const override { return &ThemeService::GetThemeProviderForProfile(browser_->GetProfile()); }
  const ui::ColorProvider* GetColorProvider() const override { return widget_->GetColorProvider(); }
  Profile* GetProfile() override { return browser_->GetProfile(); }
  gfx::Size GetContentsSize() const override {
    auto* contents = browser_->GetTabStripModel()->GetActiveWebContents();
    return contents ? contents->GetContainerBounds().size() : page_host_->size();
  }
  void SetContentsSize(const gfx::Size& size) override {
    const auto old = GetContentsSize(); auto bounds = GetBounds();
    bounds.set_size(gfx::Size(bounds.width() + size.width() - old.width(), bounds.height() + size.height() - old.height()));
    SetBounds(bounds);
  }
  void OnActiveTabChanged(content::WebContents* old_contents, content::WebContents* new_contents, int index, int) override {
    // One Core Animation transaction for the whole switch. Hiding a page
    // commits a transaction of its own, which would otherwise make AppKit lay
    // out and draw the whole window before the new page is in place; this way
    // the old page goes and the new one appears in the same frame.
    [CATransaction begin];
    SwitchPages(old_contents, new_contents, index);
    [CATransaction commit];
    NotifyShellWindow(browser_);
  }
  void SwitchPages(content::WebContents* old_contents, content::WebContents* new_contents, int index) {
    // Both halves of a split stay visible; everything else the old tab showed
    // is hidden.
    auto* strip = browser_->GetTabStripModel();
    auto shown = [strip](int at) {
      std::vector<content::WebContents*> pages;
      if (at == TabStripModel::kNoTab) return pages;
      if (const auto split = strip->GetSplitForTab(at)) {
        for (auto* tab : strip->GetSplitData(*split)->ListTabs()) pages.push_back(tab->GetContents());
      } else {
        pages.push_back(strip->GetWebContentsAt(at));
      }
      return pages;
    };
    const auto now = shown(index);
    std::vector<content::WebContents*> before;
    if (old_contents) {
      before = shown(strip->GetIndexOfWebContents(old_contents));
      if (before.empty()) before.push_back(old_contents);  // Detached or closing.
    }
    NSWindow* window = GetNativeWindow().GetNativeNSWindow();
    for (auto* page : before) {
      if (std::find(now.begin(), now.end(), page) != now.end()) continue;
      // A page losing its focus as it hides makes AppKit search the whole
      // window's key-view loop for a replacement; the new page takes the
      // focus straight after (PlacePage), so give it up first.
      NSView* view = page->GetNativeView().GetNativeNSView();
      NSResponder* focus = window.firstResponder;
      if (view && [focus isKindOfClass:NSView.class] && [(NSView*)focus isDescendantOf:view])
        [window makeFirstResponder:nil];
      page->WasHidden();
    }
    for (auto* page : now) page->WasShown();
    if (new_contents && std::find(now.begin(), now.end(), new_contents) == now.end()) new_contents->WasShown();
    // Show the new page now; React re-renders the rest of the window after.
    // A start page or a crashed page is React's own view, not the page's.
    RevealActivePage(browser_, new_contents && (ShowsShellStartPage(browser_, new_contents) || new_contents->IsCrashed()));
  }
  void OnTabDetached(content::WebContents* contents, bool) override {
    [contents->GetNativeView().GetNativeNSView() removeFromSuperview];
    contents->WasHidden();
    NotifyShellWindow(browser_);
  }
  void UpdateTitleBar() override { widget_->UpdateWindowTitle(); NotifyShellWindow(browser_); }
  void UpdateLoadingAnimations(bool) override { NotifyShellWindow(browser_); }
  void UpdateReloadStopState(bool, bool) override { NotifyShellWindow(browser_); }
  void UpdateToolbar(content::WebContents*) override { NotifyShellWindow(browser_); }
  bool UpdateToolbarSecurityState() override { NotifyShellWindow(browser_); return true; }
  void ResetToolbarTabState(content::WebContents*) override { NotifyShellWindow(browser_); }
  void SetFocusToLocationBar(bool) override { SendShellEvent(browser_, "address.focus"); }
  void FocusToolbar() override { SetFocusToLocationBar(true); }
  void FocusAppMenu() override { ShowAppMenu(); }
  void ShowAppMenu() override { SendShellEvent(browser_, "command.open"); }
  void CreateTabSearchBubble() override { SendShellEvent(browser_, "command.open"); }
  void CloseTabSearchBubble() override {}
  bool IsTabStripEditable() const override { return editable_; }
  void DisableTabStripEditingForTesting() override { editable_ = false; }
  bool IsToolbarVisible() const override { return true; }
  bool IsToolbarShowing() const override { return IsVisible(); }
  bool IsLocationBarVisible() const override { return true; }
  bool IsUnframedModeEnabled() const override { return false; }
  bool GetCanResize() override { return true; }
  BrowserView* AsBrowserView() override { return nullptr; }
  LocationBar* GetLocationBar() const override { return const_cast<ReactLocationBar*>(&location_bar_); }
  autofill::AutofillBubbleHandler* GetAutofillBubbleHandler() override { return autofill_.get(); }
  PinnedToolbarActions* GetPinnedToolbarActions() override { return nullptr; }
  DownloadBubbleUIController* GetDownloadBubbleUIController() override { return nullptr; }
  std::vector<StatusBubble*> GetStatusBubbles() override { return {}; }
  void SetTopControlsShownRatio(content::WebContents*, float) override {}
  bool DoBrowserControlsShrinkRendererSize(const content::WebContents*) const override { return false; }
  int GetTopControlsHeight() const override { return 0; }
  void SetTopControlsGestureScrollInProgress(bool) override {}
  void UpdateCustomTabBarVisibility(bool, bool) override {}
  void ToolbarSizeChanged(bool) override {}
  void TabDraggingStatusChanged(bool) override {}
  void LinkOpeningFromGesture(WindowOpenDisposition) override {}
  void PreHandleDragUpdate(const content::DropData&, const gfx::PointF&) override {}
  void PreHandleDragExit() override {}
  void HandleDragEnded() override {}
  content::KeyboardEventProcessingResult PreHandleKeyboardEvent(const input::NativeWebKeyboardEvent& event) override {
    if (event.GetType() == blink::WebInputEvent::Type::kRawKeyDown) {
      // Ctrl-Tab and Ctrl-Shift-Tab belong to the browser, as in Chrome,
      // before the page or modal keys see them.
      constexpr int kModifiers = blink::WebInputEvent::kControlKey | blink::WebInputEvent::kShiftKey |
          blink::WebInputEvent::kAltKey | blink::WebInputEvent::kMetaKey;
      const int modifiers = event.GetModifiers() & kModifiers;
      if (event.windows_key_code == ui::VKEY_W && modifiers == blink::WebInputEvent::kMetaKey &&
          ClosePinnedShellTab(browser_, browser_->GetTabStripModel()->active_index()))
        return content::KeyboardEventProcessingResult::HANDLED;
      if (event.windows_key_code == ui::VKEY_TAB && (modifiers & ~blink::WebInputEvent::kShiftKey) == blink::WebInputEvent::kControlKey &&
          CycleShellTabs(browser_, !(modifiers & blink::WebInputEvent::kShiftKey)))
        return content::KeyboardEventProcessingResult::HANDLED;
      if (auto* controller = ModalBrowserController::From(browser_); controller && controller->PreHandleKeyDown(event))
        return content::KeyboardEventProcessingResult::HANDLED;
    }
    return content::KeyboardEventProcessingResult::NOT_HANDLED;
  }
  bool HandleKeyboardEvent(const input::NativeWebKeyboardEvent& event) override {
    if (event.skip_if_unhandled || !event.os_event || event.os_event.Get().type != NSEventTypeKeyDown) return false;
    // Merlin's shortcuts the page did not take (Cmd-S, Cmd-K).
    if (auto* controller = ModalBrowserController::From(browser_); controller && controller->HandleUnhandledShortcut(event))
      return true;
    return views::NativeWidgetMacNSWindowHost::GetFromNativeWindow(GetNativeWindow())->RedispatchKeyEvent(event.os_event.Get());
  }
  ui::AcceleratorProvider* GetAcceleratorProvider() override { return this; }
  bool GetAcceleratorForCommandId(int command, ui::Accelerator* accelerator) const override {
    if (command != IDC_FULLSCREEN) return false;
    *accelerator = ui::Accelerator(ui::VKEY_F, ui::EF_CONTROL_DOWN | ui::EF_COMMAND_DOWN);
    return true;
  }
  std::unique_ptr<FindBar> CreateFindBar() override { return CreateReactFindBar(browser_, widget_.get()); }
  std::string GetWorkspace() const override { return {}; }
  bool IsVisibleOnAllWorkspaces() const override { return false; }
  void ShowEmojiPanel() override { [NSApp orderFrontCharacterPalette:nil]; }
  // The system color sampler; it needs no Views anchor.
  std::unique_ptr<content::EyeDropper> OpenEyeDropper(content::RenderFrameHost* frame, content::EyeDropperListener* listener) override {
    return ShowEyeDropper(frame, listener);
  }

  // Dialog producers all pass through the same native request queue. Native code
  // retains the callback and validates the response before performing an action.
  void ConfirmBrowserCloseWithPendingDownloads(int count, DownloadCloseType,
      base::OnceCallback<void(bool)> callback) override {
    ShowShellPrompt(browser_, Dict().Set("kind", "confirm").Set("origin", "Merlin")
        .Set("title", "Close this window?").Set("message", base::NumberToString(count) + " downloads are still running.")
        .Set("actions", List().Append(Action("cancel", "Keep browsing")).Append(Action("close", "Close window", "danger"))),
        base::BindOnce([](base::OnceCallback<void(bool)> reply, ShellPromptReply answer) {
          std::move(reply).Run(answer.action == "close");
        }, std::move(callback)));
  }
  void ShowIntentPickerBubble(std::vector<apps::IntentPickerAppInfo> apps, bool, bool,
      apps::IntentPickerBubbleType, const std::optional<url::Origin>&, IntentPickerResponse callback) override {
    if (apps.empty()) {
      std::move(callback).Run({}, apps::PickerEntryType::kUnknown, apps::IntentPickerCloseReason::ERROR_BEFORE_PICKER, false);
      return;
    }
    List actions;
    actions.Append(Action("stay", "Stay in Merlin"));
    for (size_t i = 0; i < apps.size() && i < 4; ++i)
      actions.Append(Action(("app-" + base::NumberToString(i)).c_str(), ("Open in " + apps[i].display_name).c_str(),
                            i == 0 ? "primary" : "normal"));
    ShowShellPrompt(browser_, Dict().Set("kind", "confirm").Set("anchor", "site").Set("origin", "Merlin").Set("quiet", true)
        .Set("title", "Open this link in an app?").Set("message", "An installed app can open this page.")
        .Set("actions", std::move(actions)),
        base::BindOnce([](std::vector<apps::IntentPickerAppInfo> apps, IntentPickerResponse callback, ShellPromptReply reply) {
          size_t index = 0;
          if (reply.action.starts_with("app-") && base::StringToSizeT(reply.action.substr(4), &index) && index < apps.size()) {
            std::move(callback).Run(apps[index].launch_name, apps[index].type, apps::IntentPickerCloseReason::OPEN_APP, false);
          } else {
            std::move(callback).Run({}, apps::PickerEntryType::kUnknown, reply.action == "stay"
                ? apps::IntentPickerCloseReason::STAY_IN_CHROME : apps::IntentPickerCloseReason::DIALOG_DEACTIVATED, false);
          }
        }, std::move(apps), std::move(callback)));
  }
  void ShowBookmarkBubble(const GURL& url, bool already_bookmarked) override {
    auto* model = BookmarkModelFactory::GetForBrowserContext(browser_->GetProfile());
    const auto* node = model ? model->GetMostRecentlyAddedUserNodeForURL(url) : nullptr;
    if (!node) return;
    // Capture identity, not a node pointer: sync or another window can remove
    // this bookmark while its editor is open.
    const int64_t id = node->id();
    ShowShellPrompt(browser_, Dict().Set("kind", "confirm").Set("anchor", "site").Set("origin", "Merlin")
        .Set("title", already_bookmarked ? "Edit bookmark" : "Bookmark added")
        .Set("message", url.spec())
        .Set("input", Dict().Set("label", "Name").Set("defaultValue", base::UTF16ToUTF8(node->GetTitle())))
        .Set("actions", List().Append(Action("remove", "Remove", "danger"))
            .Append(Action("cancel", "Cancel")).Append(Action("save", "Save", "primary"))),
        base::BindOnce([](base::WeakPtr<ReactBrowserWindow> self, int64_t id, ShellPromptReply reply) {
          if (!self || (reply.action != "save" && reply.action != "remove")) return;
          auto* model = BookmarkModelFactory::GetForBrowserContext(self->browser_->GetProfile());
          const auto* node = model ? bookmarks::GetBookmarkNodeByID(model, id) : nullptr;
          if (!node) return;
          if (reply.action == "remove") model->Remove(node, bookmarks::metrics::BookmarkEditSource::kUser, FROM_HERE);
          else model->SetTitle(node, base::UTF8ToUTF16(reply.text), bookmarks::metrics::BookmarkEditSource::kUser);
        }, weak_factory_.GetWeakPtr(), id));
  }
  void ShowUpdateChromeDialog() override {
    ShowShellPrompt(browser_, Dict().Set("kind", "confirm").Set("origin", "Merlin")
        .Set("title", "Merlin is ready to update").Set("message", "Restart to finish updating. Your tabs reopen afterwards.")
        .Set("actions", List().Append(Action("later", "Later")).Append(Action("restart", "Restart", "primary"))),
        base::BindOnce([](ShellPromptReply reply) { if (reply.action == "restart") chrome::AttemptRestart(); }));
  }
  ShowTranslateBubbleResult ShowTranslateBubble(content::WebContents* contents, translate::TranslateStep step,
      const std::string& source, const std::string& target, translate::TranslateErrors error, bool is_user_gesture) override {
    if (!contents || browser_->GetTabStripModel()->GetActiveWebContents() != contents)
      return ShowTranslateBubbleResult::kWebContentsNotActive;
    if (!translate_prompt_.empty()) CancelShellPrompt(browser_, translate_prompt_);
    translate_prompt_.clear();
    auto* controller = ModalBrowserController::From(browser_);
    const std::string locale = g_browser_process->GetApplicationLocale();
    const std::string from = base::UTF16ToUTF8(l10n_util::GetDisplayNameForLocale(source, locale, true));
    const std::string to = base::UTF16ToUTF8(l10n_util::GetDisplayNameForLocale(target, locale, true));
    switch (step) {
      case translate::TRANSLATE_STEP_TRANSLATING:
        if (controller) controller->ShowMessage(ffi::MessageLevel::Info, "Translating to " + to + "…");
        return ShowTranslateBubbleResult::kSuccess;
      case translate::TRANSLATE_STEP_TRANSLATE_ERROR:
        if (controller) controller->ShowMessage(ffi::MessageLevel::Error, "This page could not be translated");
        return ShowTranslateBubbleResult::kSuccess;
      default:
        break;
    }
    const bool translated = step == translate::TRANSLATE_STEP_AFTER_TRANSLATE;
    List actions;
    if (translated) {
      actions.Append(Action("revert", "Show original"));
      actions.Append(Action("done", "Done", "primary"));
    } else {
      actions.Append(Action("never", ("Never translate " + from).c_str()));
      actions.Append(Action("dismiss", "Not now"));
      actions.Append(Action("translate", ("Translate to " + to).c_str(), "primary"));
    }
    // An automatic offer waits behind the toolbar's request button rather
    // than interrupting every page in another language.
    translate_prompt_ = ShowShellPrompt(browser_, Dict().Set("kind", "confirm").Set("anchor", "site").Set("origin", "Translate")
        .Set("quiet", !is_user_gesture)
        .Set("title", translated ? "Translated to " + to : "Translate this page?")
        .Set("message", translated ? "This page was translated from " + from + "."
                                   : "This page is in " + from + ". Merlin can translate it to " + to + ".")
        .Set("actions", std::move(actions)),
        base::BindOnce([](base::WeakPtr<ReactBrowserWindow> self, base::WeakPtr<content::WebContents> contents,
                          std::string source, std::string target, ShellPromptReply reply) {
          if (self) self->translate_prompt_.clear();
          if (!contents) return;
          auto* client = ChromeTranslateClient::FromWebContents(contents.get());
          auto* manager = client ? client->GetTranslateManager() : nullptr;
          if (!manager) return;
          if (reply.action == "translate") manager->TranslatePage(source, target, /*triggered_from_menu=*/false);
          else if (reply.action == "revert") manager->RevertTranslation();
          else if (reply.action == "never") {
            Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
            ChromeTranslateClient::CreateTranslatePrefs(profile->GetPrefs())->BlockLanguage(source);
          }
        }, weak_factory_.GetWeakPtr(), contents->GetWeakPtr(), source, target));
    return ShowTranslateBubbleResult::kSuccess;
  }
  // Merlin has one profile and no avatar button.
  void ShowAvatarBubbleFromAvatarButton(bool) override {}
  void ShowHatsDialog(const std::string&, const std::optional<std::string>&, const std::optional<uint64_t>,
      base::OnceClosure, base::OnceClosure failure, const SurveyBitsData&, const SurveyStringData&) override {
    if (failure) std::move(failure).Run();
  }
  void ShowCaretBrowsingDialog() override {
    ShowShellPrompt(browser_, Dict().Set("kind", "confirm").Set("origin", "Merlin")
        .Set("title", "Turn on caret browsing?")
        .Set("message", "A movable cursor appears in web pages, so you can select text with the keyboard. Press F7 to turn it off.")
        .Set("actions", List().Append(Action("cancel", "Cancel")).Append(Action("always", "Turn on, don't ask again"))
            .Append(Action("on", "Turn on", "primary"))),
        base::BindOnce([](base::WeakPtr<Profile> profile, ShellPromptReply reply) {
          if (!profile || (reply.action != "on" && reply.action != "always")) return;
          if (reply.action == "always") profile->GetPrefs()->SetBoolean(prefs::kShowCaretBrowsingDialog, false);
          profile->GetPrefs()->SetBoolean(prefs::kCaretBrowsingEnabled, true);
        }, browser_->GetProfile()->GetWeakPtr()));
  }
  void ShowIncognitoClearBrowsingDataDialog() override {
    ShowShellPrompt(browser_, Dict().Set("kind", "confirm").Set("origin", "Private browsing")
        .Set("title", "Close private windows?")
        .Set("message", "Private browsing data is deleted when every private window closes.")
        .Set("actions", List().Append(Action("cancel", "Keep browsing")).Append(Action("close", "Close private windows", "danger"))),
        base::BindOnce([](base::WeakPtr<Profile> profile, ShellPromptReply reply) {
          if (profile && reply.action == "close") chrome::CloseAllBrowsersWithIncognitoProfile(profile.get());
        }, browser_->GetProfile()->GetWeakPtr()));
  }
  void ShowIncognitoHistoryDisclaimerDialog() override {
    ShowShellPrompt(browser_, Dict().Set("kind", "alert").Set("origin", "Private browsing")
        .Set("title", "History isn't saved in private windows")
        .Set("message", "Pages you visit here are not added to your history. Downloads and bookmarks are kept.")
        .Set("actions", List().Append(Action("done", "Done", "primary"))), base::DoNothing());
  }
  void ShowChromeLabs() override { chrome::AddTabAt(browser_, GURL("chrome://flags/"), -1, true); }

  ExclusiveAccessContext* GetExclusiveAccessContext() override { return this; }
  // A page's fullscreen request (a video, a PDF, a game) makes the window
  // fullscreen and tells the shell, which then draws only the page, edge to
  // edge, as Chrome does. Browser fullscreen keeps the tabs and toolbar.
  void EnterFullscreen(const url::Origin&, ExclusiveAccessBubbleType, FullscreenTabParams params) override {
    widget_->SetFullscreen(true, params.display_id);
    ExclusiveAccessManager::From(browser_)->fullscreen_controller()->WindowFullscreenStateChanged();
    NotifyShellWindow(browser_);
  }
  void ExitFullscreen() override {
    if (!CanUserExitFullscreen()) return;
    widget_->SetFullscreen(false);
    ExclusiveAccessManager::From(browser_)->fullscreen_controller()->WindowFullscreenStateChanged();
    NotifyShellWindow(browser_);
  }
  // A page going into or out of fullscreen while the window already is
  // (after Control-Command-F): only the shell's chrome changes.
  void UpdateUIForTabFullscreen() override { NotifyShellWindow(browser_); }
  bool CanUserEnterFullscreen() const override { return true; }
  bool CanUserExitFullscreen() const override { return !BrowserWindowFullscreenController::From(browser_)->IsForceFullscreen(); }
  content::WebContents* GetWebContentsForExclusiveAccess() override { return browser_->GetTabStripModel()->GetActiveWebContents(); }
  void UpdateExclusiveAccessBubble(const ExclusiveAccessBubbleParams& params, ExclusiveAccessBubbleHideCallback callback) override {
    const uint64_t generation = ++bubble_generation_;
    // Retain Chromium's security indicator until its RN equivalent has completed
    // runtime qualification; fullscreen must never silently hide the exit hint.
    if (params.type == EXCLUSIVE_ACCESS_BUBBLE_TYPE_NONE && !params.has_download) {
      if (callback) std::move(callback).Run(ExclusiveAccessBubbleHideReason::kNotShown);
      if (bubble_) bubble_->HideImmediately();
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
          base::BindOnce([](base::WeakPtr<ReactBrowserWindow> self, uint64_t generation) {
            if (self && generation == self->bubble_generation_) self->DestroyAnyExclusiveAccessBubble();
          }, weak_factory_.GetWeakPtr(), generation));
    } else if (bubble_) bubble_->Update(params, std::move(callback));
    else bubble_ = std::make_unique<ExclusiveAccessBubbleViews>(this, params, std::move(callback));
  }
  bool IsExclusiveAccessBubbleDisplayed() const override { return bubble_ && bubble_->IsVisible(); }
  void OnExclusiveAccessUserInput() override { if (bubble_) bubble_->OnUserInput(); }
  ExclusiveAccessManager* GetExclusiveAccessManager() override { return ExclusiveAccessManager::From(browser_); }
  gfx::NativeView GetBubbleParentView() const override { return widget_->GetNativeView(); }
  gfx::Rect GetClientAreaBoundsInScreen() const override { return widget_->GetClientAreaBoundsInScreen(); }
  bool IsImmersiveModeEnabled() const override { return false; }
  gfx::Rect GetTopContainerBoundsInScreen() override { return {}; }
  void DestroyAnyExclusiveAccessBubble() override { bubble_.reset(); }

  web_modal::WebContentsModalDialogHost* GetWebContentsModalDialogHost() override { return this; }
  web_modal::WebContentsModalDialogHost* GetWebContentsModalDialogHostFor(content::WebContents*) override { return this; }
  gfx::NativeView GetHostView() const override { return widget_->GetNativeView(); }
  gfx::Point GetDialogPosition(const gfx::Size& size) override { return gfx::Point((page_host_->width() - size.width()) / 2, 56); }
  bool ShouldActivateDialog() const override { return IsActive(); }
  gfx::Size GetMaximumDialogSize() override { return page_host_->size(); }
  void NotifyPositionRequiresUpdate() override { modal_observers_.Notify(&web_modal::ModalDialogHostObserver::OnPositionRequiresUpdate); }
  void AddObserver(web_modal::ModalDialogHostObserver* observer) override { modal_observers_.AddObserver(observer); }
  void RemoveObserver(web_modal::ModalDialogHostObserver* observer) override { modal_observers_.RemoveObserver(observer); }
  void OnWidgetBoundsChanged(views::Widget*, const gfx::Rect&) override {
    NotifyPositionRequiresUpdate();
    if (auto* controller = ModalBrowserController::From(browser_)) controller->OnWindowBoundsChanged();
  }
  void OnWidgetActivationChanged(views::Widget*, bool active) override {
    auto* manager = BrowserActiveStateManager::From(browser_);
    if (active) manager->DidBecomeActive(); else manager->DidBecomeInactive();
  }
 protected:
  void DeleteBrowserWindow() override { delete this; }
 private:
  // Keeps a newly shown window transparent until React has drawn into it,
  // then shows it in one piece. At launch that is about 100 ms before the
  // Views layer under React first composites, which is when Chromium would
  // otherwise show it.
  void HoldUntilDrawn() {
    if (drawn_ || content_observer_) return;
    NSWindow* window = GetNativeWindow().GetNativeNSWindow();
    NSView* root = (__bridge NSView*)root_.get();
    if (!window || !root) { drawn_ = true; return; }
    window.alphaValue = 0;
    base::WeakPtr<ReactBrowserWindow> weak = weak_factory_.GetWeakPtr();
    content_observer_ = [NSNotificationCenter.defaultCenter addObserverForName:@"RCTContentDidAppearNotification"
        object:root queue:nil usingBlock:^(NSNotification*) { if (weak) weak->Reveal(); }];
    // Shown anyway after 300 ms, should React be slow or not report.
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(FROM_HERE,
        base::BindOnce(&ReactBrowserWindow::Reveal, weak), base::Milliseconds(300));
  }
  void Reveal() {
    if (drawn_) return;
    drawn_ = true;
    if (content_observer_) [NSNotificationCenter.defaultCenter removeObserver:content_observer_];
    content_observer_ = nil;
    GetNativeWindow().GetNativeNSWindow().alphaValue = 1;
  }
  void ArmClose() {
    widget_->MakeCloseSynchronous(base::BindOnce(&ReactBrowserWindow::RequestClose, weak_factory_.GetWeakPtr()));
  }
  // Settings > General > Warn before closing a window with multiple tabs.
  // The shell keeps the choice in AppKit's defaults; absent means on.
  static bool WarnBeforeClosing() {
    NSString* value = [NSUserDefaults.standardUserDefaults stringForKey:@"MerlinShell.warnBeforeClosingWindow"];
    return ![value isEqualToString:@"off"];
  }
  bool ShouldAskBeforeClosing() const {
    if (close_confirmed_ || browser_shutdown::IsTryingToQuit() || !WarnBeforeClosing()) return false;
    if (browser_->GetType() != BrowserWindowInterface::TYPE_NORMAL) return false;
    return browser_->GetTabStripModel()->count() > 1;
  }
  void AskBeforeClosing() {
    if (asking_to_close_) return;
    asking_to_close_ = true;
    const int count = browser_->GetTabStripModel()->count();
    ShowShellPrompt(browser_, Dict().Set("kind", "confirm").Set("origin", "Merlin").Set("canSuppress", true)
        .Set("title", "Close this window?").Set("message", "Its " + base::NumberToString(count) + " tabs close with it.")
        .Set("actions", List().Append(Action("cancel", "Keep window")).Append(Action("close", "Close window", "danger"))),
        base::BindOnce([](base::WeakPtr<ReactBrowserWindow> self, ShellPromptReply answer) {
          if (!self) return;
          self->asking_to_close_ = false;
          if (answer.action != "close") return;
          if (answer.suppress)
            [NSUserDefaults.standardUserDefaults setObject:@"off" forKey:@"MerlinShell.warnBeforeClosingWindow"];
          self->close_confirmed_ = true;
          self->widget_->Close();
        }, weak_factory_.GetWeakPtr()));
  }
  void RequestClose(views::Widget::ClosedReason) {
    if (ShouldAskBeforeClosing()) { AskBeforeClosing(); ArmClose(); return; }
    close_confirmed_ = false;
    auto* unload = UnloadController::From(browser_);
    if (!unload->HandleBeforeClose()) { ArmClose(); return; }
    unload->OnWindowClosing();
    if (!browser_->GetTabStripModel()->empty()) widget_->Hide();
  }
  raw_ptr<BrowserWindowInterface> browser_;
  ReactWindowDelegate delegate_;
  ReactLocationBar location_bar_;
  raw_ptr<const MerlinShellAPI> api_;
  std::unique_ptr<autofill::AutofillBubbleHandler> autofill_;
  std::unique_ptr<views::Widget> widget_;
  raw_ptr<views::NativeViewHost> page_host_ = nullptr;
  raw_ptr<void> root_ = nullptr;  // Retained Objective-C view; released through shell ABI.
  // Whether React has drawn the window, and the notification that says so.
  bool drawn_ = false;
  id content_observer_ = nil;
  // The close question is showing, or was answered "Close window".
  bool asking_to_close_ = false;
  bool close_confirmed_ = false;
  bool editable_ = true;
  std::unique_ptr<ExclusiveAccessBubbleViews> bubble_;
  uint64_t bubble_generation_ = 0;
  std::string translate_prompt_;
  base::ObserverList<web_modal::ModalDialogHostObserver> modal_observers_;
  base::WeakPtrFactory<ReactBrowserWindow> weak_factory_{this};
};
}  // namespace
void PrewarmReactShell() {
  if (!ReactShellEnabled()) return;
  auto get = reinterpret_cast<MerlinShellGetAPIFn>(dlsym(RTLD_DEFAULT, "MerlinShellGetAPI"));
  const auto* api = get ? get(1) : nullptr;
  // prewarm was added within ABI 1; an older host has no such field.
  if (api && api->struct_size >= offsetof(MerlinShellAPI, prewarm) + sizeof(api->prewarm) && api->prewarm)
    api->prewarm();
}
void ClearWebKitData(const std::string& json, base::OnceCallback<void(std::string error)> done) {
  // Without the React host there are no WebKit pages, so nothing to clear.
  if (!ReactShellEnabled()) {
    std::move(done).Run(std::string());
    return;
  }
  auto get = reinterpret_cast<MerlinShellGetAPIFn>(dlsym(RTLD_DEFAULT, "MerlinShellGetAPI"));
  const auto* api = get ? get(1) : nullptr;
  // clear_webkit_data was added within ABI 1; an older host has no such field.
  if (!api || api->struct_size < offsetof(MerlinShellAPI, clear_webkit_data) + sizeof(api->clear_webkit_data) ||
      !api->clear_webkit_data) {
    std::move(done).Run("This copy of Merlin can't clear WebKit's data");
    return;
  }
  using Done = base::OnceCallback<void(std::string)>;
  api->clear_webkit_data(json.c_str(), [](const char* error, void* context) {
    std::unique_ptr<Done> done(static_cast<Done*>(context));
    std::move(*done).Run(error ? std::string(error) : std::string());
  }, new Done(std::move(done)));
}
bool RemountReactShell(BrowserWindowInterface* browser) {
  const auto it = ReactWindows().find(browser);
  if (it == ReactWindows().end()) return false;
  it->second->Remount();
  return true;
}
bool ReloadReactShell(const std::string& reason) {
  if (!ReactShellEnabled()) return false;
  auto get = reinterpret_cast<MerlinShellGetAPIFn>(dlsym(RTLD_DEFAULT, "MerlinShellGetAPI"));
  const auto* api = get ? get(1) : nullptr;
  // reload was added within ABI 1; an older host has no such field.
  if (!api || api->struct_size < offsetof(MerlinShellAPI, reload) + sizeof(api->reload) || !api->reload) return false;
  api->reload(reason.c_str());
  return true;
}
std::unique_ptr<BrowserWindow, BrowserWindowDeleter> CreateReactBrowserWindow(BrowserWindowInterface* browser) {
  return std::unique_ptr<BrowserWindow, BrowserWindowDeleter>(new ReactBrowserWindow(browser));
}
}  // namespace modal_browser
