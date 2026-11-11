// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
// Follows ExtensionPopup and ExtensionViewViews: the host's page loads out of
// sight, sizes itself between 25x25 and 800x600 once its main frame is live,
// and is shown after its first load so it does not visibly resize.
#include "chrome/browser/ui/modal_browser/merlin_react_extension_popup.h"

#import <AppKit/AppKit.h>

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/process/kill.h"
#include "base/scoped_observation.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/extensions/extension_view.h"
#include "chrome/browser/extensions/extension_view_host.h"
#include "chrome/browser/extensions/extension_view_host_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_collection_observer.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/input/native_web_keyboard_event.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_registry_observer.h"
#include "extensions/common/extension.h"
#include "ui/base/base_window.h"
#include "ui/gfx/geometry/size.h"
#include "ui/views/cocoa/native_widget_mac_ns_window_host.h"
#include "url/gurl.h"

namespace modal_browser {

namespace {

// Chromium's popup bounds (kExtensionPopupMinSize/MaxSize).
constexpr gfx::Size kMinSize(25, 25);
constexpr gfx::Size kMaxSize(800, 600);

class Popup;
using Popups = std::map<int32_t, std::unique_ptr<Popup>>;
Popups& AllPopups() {
  static base::NoDestructor<Popups> popups;
  return *popups;
}
int32_t Key(BrowserWindowInterface* browser) {
  return browser->GetSessionID().id();
}

class Popup final : public extensions::ExtensionView,
                    public content::WebContentsObserver,
                    public extensions::ExtensionRegistryObserver,
                    public BrowserCollectionObserver,
                    public TabStripModelObserver {
 public:
  Popup(BrowserWindowInterface* browser,
        const extensions::Extension& extension,
        std::unique_ptr<extensions::ExtensionViewHost> host)
      : browser_(browser),
        key_(Key(browser)),
        extension_id_(extension.id()),
        name_(extension.name()),
        host_(std::move(host)) {
    host_->set_view(this);
    host_->SetCloseHandler(
        base::BindOnce(&Popup::OnHostClosed, weak_factory_.GetWeakPtr()));
    Observe(host_->host_contents());
    registry_.Observe(
        extensions::ExtensionRegistry::Get(browser->GetProfile()));
    browsers_.Observe(GlobalBrowserCollection::GetInstance());
    browser->GetTabStripModel()->AddObserver(this);
  }
  Popup(const Popup&) = delete;
  Popup& operator=(const Popup&) = delete;
  ~Popup() override {
    if (browser_) {
      browser_->GetTabStripModel()->RemoveObserver(this);
    }
    Observe(nullptr);
    host_.reset();
  }

  void Start() { host_->CreateRendererSoon(); }

  // Hides the popup now and deletes it once the current call stack, which
  // may be inside the host, has unwound.
  void Dismiss() {
    if (closing_) {
      return;
    }
    closing_ = true;
    if (browser_) {
      NotifyShellWindow(browser_);
    }
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](int32_t key, base::WeakPtr<Popup> popup) {
                         auto& all = AllPopups();
                         auto it = all.find(key);
                         if (popup && it != all.end() &&
                             it->second.get() == popup.get()) {
                           all.erase(it);
                         }
                       },
                       key_, weak_factory_.GetWeakPtr()));
  }

  bool closing() const { return closing_; }
  const std::string& extension_id() const { return extension_id_; }
  content::WebContents* contents() const {
    return closing_ ? nullptr : host_->host_contents();
  }

  base::Value State() const {
    if (closing_) {
      return base::Value();
    }
    return base::Value(base::DictValue()
                           .Set("extensionId", extension_id_)
                           .Set("name", name_)
                           .Set("width", size_.width())
                           .Set("height", size_.height())
                           .Set("ready", ready_));
  }

  // extensions::ExtensionView:
  gfx::NativeView GetNativeView() override {
    return host_->host_contents()->GetNativeView();
  }
  void ResizeDueToAutoResize(content::WebContents*,
                             const gfx::Size& new_size) override {
    gfx::Size size = new_size;
    size.SetToMax(kMinSize);
    size.SetToMin(kMaxSize);
    if (size == size_) {
      return;
    }
    size_ = size;
    if (browser_ && ready_) {
      NotifyShellWindow(browser_);
    }
  }
  void RenderFrameCreated(content::RenderFrameHost* frame) override {
    // Only the initial main frame; speculative ones arrive through
    // RenderFrameHostChanged once they are swapped in.
    if (frame == host_->host_contents()->GetPrimaryMainFrame()) {
      SizeToContent(frame);
    }
  }
  bool HandleKeyboardEvent(content::WebContents*,
                           const input::NativeWebKeyboardEvent& event) override {
    // Window shortcuts (Cmd-W, Cmd-T) still work while the popup has focus.
    if (!browser_ || !browser_->GetWindow() || event.skip_if_unhandled ||
        !event.os_event ||
        event.os_event.Get().type != NSEventTypeKeyDown) {
      return false;
    }
    auto* host = views::NativeWidgetMacNSWindowHost::GetFromNativeWindow(
        browser_->GetWindow()->GetNativeWindow());
    return host && host->RedispatchKeyEvent(event.os_event.Get());
  }
  void OnLoaded() override {
    ready_ = true;
    if (browser_) {
      NotifyShellWindow(browser_);
    }
  }

  // content::WebContentsObserver:
  void RenderFrameHostChanged(content::RenderFrameHost* old_host,
                              content::RenderFrameHost* new_host) override {
    if (old_host && new_host == web_contents()->GetPrimaryMainFrame()) {
      SizeToContent(new_host);
    }
  }
  void PrimaryMainFrameRenderProcessGone(base::TerminationStatus) override {
    Dismiss();
  }

  // extensions::ExtensionRegistryObserver:
  void OnExtensionUnloaded(content::BrowserContext*,
                           const extensions::Extension* extension,
                           extensions::UnloadedExtensionReason) override {
    if (extension->id() == extension_id_) {
      Dismiss();
    }
  }
  void OnShutdown(extensions::ExtensionRegistry*) override {
    registry_.Reset();
    Dismiss();
  }

  // BrowserCollectionObserver:
  void OnBrowserClosed(BrowserWindowInterface* browser) override {
    if (browser != browser_) {
      return;
    }
    browser_->GetTabStripModel()->RemoveObserver(this);
    browser_ = nullptr;
    Dismiss();
  }

  // TabStripModelObserver: a popup belongs to the tab it was opened for.
  void OnTabStripModelChanged(TabStripModel*,
                              const TabStripModelChange&,
                              const TabStripSelectionChange& selection) override {
    if (selection.active_tab_changed()) {
      Dismiss();
    }
  }

 private:
  void OnHostClosed(extensions::ExtensionHost*) { Dismiss(); }

  void SizeToContent(content::RenderFrameHost* frame) {
    if (frame->IsRenderFrameLive() && frame->GetView()) {
      frame->GetView()->EnableAutoResize(kMinSize, kMaxSize);
    }
  }

  raw_ptr<BrowserWindowInterface> browser_;
  const int32_t key_;
  const std::string extension_id_;
  const std::string name_;
  std::unique_ptr<extensions::ExtensionViewHost> host_;
  gfx::Size size_ = kMinSize;
  bool ready_ = false;
  bool closing_ = false;
  base::ScopedObservation<extensions::ExtensionRegistry,
                          extensions::ExtensionRegistryObserver>
      registry_{this};
  base::ScopedObservation<GlobalBrowserCollection, BrowserCollectionObserver>
      browsers_{this};
  base::WeakPtrFactory<Popup> weak_factory_{this};
};

Popup* Find(BrowserWindowInterface* browser) {
  if (!browser) {
    return nullptr;
  }
  auto& all = AllPopups();
  auto it = all.find(Key(browser));
  return it == all.end() || it->second->closing() ? nullptr : it->second.get();
}

}  // namespace

void ShowShellExtensionPopup(BrowserWindowInterface* browser,
                             const extensions::Extension& extension,
                             const GURL& url) {
  // Pressing the same extension again closes its popup, as in Chromium.
  if (Popup* open = Find(browser)) {
    const bool same = open->extension_id() == extension.id();
    CloseShellExtensionPopup(browser);
    if (same) {
      return;
    }
  }
  auto host = extensions::ExtensionViewHostFactory::CreatePopupHost(
      extension, url, browser);
  if (!host) {
    return;
  }
  auto popup = std::make_unique<Popup>(browser, extension, std::move(host));
  Popup* started = popup.get();
  AllPopups()[Key(browser)] = std::move(popup);
  started->Start();
  NotifyShellWindow(browser);
}

void CloseShellExtensionPopup(BrowserWindowInterface* browser) {
  if (Popup* popup = Find(browser)) {
    popup->Dismiss();
  }
}

content::WebContents* ShellExtensionPopupContents(
    BrowserWindowInterface* browser) {
  Popup* popup = Find(browser);
  return popup ? popup->contents() : nullptr;
}

base::Value ShellExtensionPopupState(BrowserWindowInterface* browser) {
  Popup* popup = Find(browser);
  return popup ? popup->State() : base::Value();
}

}  // namespace modal_browser
