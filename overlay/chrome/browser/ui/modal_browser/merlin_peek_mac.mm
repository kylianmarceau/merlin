// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
// The peek's page is an ordinary WebContents with this card as its delegate,
// so it gets no tab helpers until it becomes a tab: TabModel attaches them
// when the page is promoted (PromoteMerlinPeek).
#include "chrome/browser/ui/modal_browser/merlin_peek.h"

#import <AppKit/AppKit.h>

#include <cstdint>
#include <map>
#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/process/kill.h"
#include "base/scoped_observation.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_collection_observer.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/input/native_web_keyboard_event.h"
#include "content/public/browser/keyboard_event_processing_result.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_delegate.h"
#include "content/public/browser/web_contents_observer.h"
#include "third_party/blink/public/common/input/web_input_event.h"
#include "ui/base/base_window.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/views/cocoa/native_widget_mac_ns_window_host.h"
#include "url/gurl.h"

namespace modal_browser {

namespace {

class Peek;
using Peeks = std::map<int32_t, std::unique_ptr<Peek>>;
Peeks& AllPeeks() {
  static base::NoDestructor<Peeks> peeks;
  return *peeks;
}
int32_t Key(BrowserWindowInterface* browser) {
  return browser->GetSessionID().id();
}

class Peek final : public content::WebContentsDelegate,
                   public content::WebContentsObserver,
                   public BrowserCollectionObserver,
                   public TabStripModelObserver {
 public:
  explicit Peek(BrowserWindowInterface* browser)
      : browser_(browser), key_(Key(browser)) {
    content::WebContents::CreateParams params(browser->GetProfile());
    params.initially_hidden = true;
    contents_ = content::WebContents::Create(params);
    contents_->SetDelegate(this);
    Observe(contents_.get());
    browsers_.Observe(GlobalBrowserCollection::GetInstance());
    browser->GetTabStripModel()->AddObserver(this);
  }
  Peek(const Peek&) = delete;
  Peek& operator=(const Peek&) = delete;
  ~Peek() override {
    StopObservingWindow();
    Observe(nullptr);
    if (contents_) {
      contents_->SetDelegate(nullptr);
    }
  }

  void Load(const GURL& url) {
    content::NavigationController::LoadURLParams params(url);
    params.transition_type = ui::PAGE_TRANSITION_LINK;
    contents_->GetController().LoadURLWithParams(params);
    NotifyShell();
  }

  // Hides the card now and deletes it once the current call stack, which
  // may be inside the page's delegate, has unwound.
  void Dismiss() {
    if (closing_) {
      return;
    }
    closing_ = true;
    if (contents_) {
      [contents_->GetNativeView().GetNativeNSView() removeFromSuperview];
    }
    // Keys go back to the page the card was over.
    if (browser_) {
      if (content::WebContents* page =
              browser_->GetTabStripModel()->GetActiveWebContents()) {
        page->Focus();
      }
    }
    NotifyShell();
    DeleteSoon();
  }

  void Promote() {
    if (closing_ || !browser_) {
      return;
    }
    closing_ = true;
    BrowserWindowInterface* browser = browser_;
    StopObservingWindow();
    Observe(nullptr);
    std::unique_ptr<content::WebContents> contents = std::move(contents_);
    contents->SetDelegate(nullptr);
    // The page container React gave the card isn't the tab's; the window
    // places the view when the new tab becomes active.
    NSView* view = contents->GetNativeView().GetNativeNSView();
    [view removeFromSuperview];
    // A tab's page is square (the card rounded it, AttachPage).
    view.layer.cornerRadius = 0;
    view.layer.masksToBounds = NO;
    TabStripModel* strip = browser->GetTabStripModel();
    const int active = strip->active_index();
    strip->InsertWebContentsAt(
        active + 1, std::move(contents),
        AddTabTypes::ADD_ACTIVE | AddTabTypes::ADD_INHERIT_OPENER,
        active >= 0 ? strip->GetTabGroupForTab(active) : std::nullopt);
    NotifyShellWindow(browser);
    DeleteSoon();
  }

  bool closing() const { return closing_; }
  content::WebContents* contents() const {
    return closing_ ? nullptr : contents_.get();
  }

  base::Value State() const {
    if (closing_ || !contents_) {
      return base::Value();
    }
    return base::Value(
        base::DictValue()
            .Set("url", contents_->GetVisibleURL().spec())
            .Set("title", base::UTF16ToUTF8(contents_->GetTitle()))
            .Set("loading", contents_->IsLoading())
            .Set("canGoBack", contents_->GetController().CanGoBack()));
  }

  // content::WebContentsDelegate:
  content::WebContents* OpenURLFromTab(
      content::WebContents* source,
      const content::OpenURLParams& params,
      base::OnceCallback<void(content::NavigationHandle&)> callback) override {
    if (params.disposition == WindowOpenDisposition::kCurrentTab) {
      content::NavigationController::LoadURLParams load(params);
      auto handle = source->GetController().LoadURLWithParams(load);
      if (callback && handle) {
        std::move(callback).Run(*handle);
      }
      return source;
    }
    // A link the page opens elsewhere (a modified click, the context menu)
    // opens as the window would open it.
    if (browser_) {
      browser_->OpenGURL(params.url, params.disposition);
    }
    return nullptr;
  }
  content::WebContents* AddNewContents(
      content::WebContents*,
      std::unique_ptr<content::WebContents> new_contents,
      const GURL&,
      WindowOpenDisposition disposition,
      const blink::mojom::WindowFeatures&,
      bool,
      bool*) override {
    // window.open() from the peeked page: a tab in the window.
    if (!browser_) {
      return nullptr;
    }
    content::WebContents* added = new_contents.get();
    browser_->GetTabStripModel()->AppendWebContents(
        std::move(new_contents),
        disposition != WindowOpenDisposition::kNewBackgroundTab);
    return added;
  }
  void CloseContents(content::WebContents*) override { Dismiss(); }
  void NavigationStateChanged(content::WebContents*,
                              content::InvalidateTypes) override {
    NotifyShell();
  }
  void LoadingStateChanged(content::WebContents*, bool) override {
    NotifyShell();
  }
  content::KeyboardEventProcessingResult PreHandleKeyboardEvent(
      content::WebContents*,
      const input::NativeWebKeyboardEvent& event) override {
    if (event.GetType() != blink::WebInputEvent::Type::kRawKeyDown) {
      return content::KeyboardEventProcessingResult::NOT_HANDLED;
    }
    const int modifiers = event.GetModifiers() &
                          (blink::WebInputEvent::kShiftKey |
                           blink::WebInputEvent::kControlKey |
                           blink::WebInputEvent::kAltKey |
                           blink::WebInputEvent::kMetaKey);
    const bool command = modifiers == blink::WebInputEvent::kMetaKey;
    if ((event.windows_key_code == ui::VKEY_ESCAPE && modifiers == 0) ||
        (event.windows_key_code == ui::VKEY_W && command)) {
      Dismiss();
      return content::KeyboardEventProcessingResult::HANDLED;
    }
    if (event.windows_key_code == ui::VKEY_RETURN && command) {
      // After the key event has unwound: promoting takes the page away from
      // this delegate.
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE,
          base::BindOnce(&Peek::Promote, weak_factory_.GetWeakPtr()));
      return content::KeyboardEventProcessingResult::HANDLED;
    }
    return content::KeyboardEventProcessingResult::NOT_HANDLED;
  }
  bool HandleKeyboardEvent(content::WebContents*,
                           const input::NativeWebKeyboardEvent& event) override {
    // Window shortcuts (Command-T, Command-L) still work in the card.
    if (!browser_ || !browser_->GetWindow() || event.skip_if_unhandled ||
        !event.os_event ||
        event.os_event.Get().type != NSEventTypeKeyDown) {
      return false;
    }
    auto* host = views::NativeWidgetMacNSWindowHost::GetFromNativeWindow(
        browser_->GetWindow()->GetNativeWindow());
    return host && host->RedispatchKeyEvent(event.os_event.Get());
  }

  // content::WebContentsObserver:
  void PrimaryMainFrameRenderProcessGone(base::TerminationStatus) override {
    Dismiss();
  }
  void TitleWasSet(content::NavigationEntry*) override { NotifyShell(); }

  // BrowserCollectionObserver:
  void OnBrowserClosed(BrowserWindowInterface* browser) override {
    if (browser != browser_) {
      return;
    }
    StopObservingWindow();
    Dismiss();
  }

  // TabStripModelObserver: the card belongs to the tab it was opened over.
  void OnTabStripModelChanged(TabStripModel*,
                              const TabStripModelChange&,
                              const TabStripSelectionChange& selection) override {
    if (selection.active_tab_changed()) {
      Dismiss();
    }
  }

 private:
  void NotifyShell() {
    if (browser_) {
      NotifyShellWindow(browser_);
    }
  }
  void StopObservingWindow() {
    if (browser_) {
      browser_->GetTabStripModel()->RemoveObserver(this);
      browser_ = nullptr;
    }
    browsers_.Reset();
  }
  void DeleteSoon() {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](int32_t key, base::WeakPtr<Peek> peek) {
                         auto& all = AllPeeks();
                         auto it = all.find(key);
                         if (peek && it != all.end() &&
                             it->second.get() == peek.get()) {
                           all.erase(it);
                         }
                       },
                       key_, weak_factory_.GetWeakPtr()));
  }

  raw_ptr<BrowserWindowInterface> browser_;
  const int32_t key_;
  std::unique_ptr<content::WebContents> contents_;
  bool closing_ = false;
  base::ScopedObservation<GlobalBrowserCollection, BrowserCollectionObserver>
      browsers_{this};
  base::WeakPtrFactory<Peek> weak_factory_{this};
};

Peek* Find(BrowserWindowInterface* browser) {
  if (!browser) {
    return nullptr;
  }
  auto& all = AllPeeks();
  auto it = all.find(Key(browser));
  return it == all.end() || it->second->closing() ? nullptr : it->second.get();
}

}  // namespace

bool OpenMerlinPeek(BrowserWindowInterface* browser, const GURL& url) {
  if (!browser || !ReactShellEnabled() || !url.is_valid() ||
      browser->GetType() != BrowserWindowInterface::TYPE_NORMAL) {
    return false;
  }
  Peek* peek = Find(browser);
  if (!peek) {
    // A card still closing from before is replaced.
    auto created = std::make_unique<Peek>(browser);
    peek = created.get();
    AllPeeks()[Key(browser)] = std::move(created);
  }
  peek->Load(url);
  return true;
}

void CloseMerlinPeek(BrowserWindowInterface* browser) {
  if (Peek* peek = Find(browser)) {
    peek->Dismiss();
  }
}

void PromoteMerlinPeek(BrowserWindowInterface* browser) {
  if (Peek* peek = Find(browser)) {
    peek->Promote();
  }
}

content::WebContents* MerlinPeekContents(BrowserWindowInterface* browser) {
  Peek* peek = Find(browser);
  return peek ? peek->contents() : nullptr;
}

base::Value MerlinPeekState(BrowserWindowInterface* browser) {
  Peek* peek = Find(browser);
  return peek ? peek->State() : base::Value();
}

}  // namespace modal_browser
