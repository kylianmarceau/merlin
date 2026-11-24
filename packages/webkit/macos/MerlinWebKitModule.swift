import AppKit
import ExpoModulesCore

// WebKit pages for the sites Chromium can't play. Unsigned Chromium builds
// have no working Widevine, so Netflix and similar services refuse them;
// WebKit plays them with FairPlay, as Safari does. The shell decides which
// tabs show a WebKit page (apps/browser/src/state/webkit.ts); Chromium keeps
// owning the tab itself. This module knows nothing about Chromium.
//
// Pages are keyed by the Chromium tab's ID. One module, one view: on React
// Native's classic bridge a module draws only its first view definition.
public final class MerlinWebKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinWebKit")
    Events("pageState", "openTab", "pageKey", "pageError", "toolbarDirection")

    OnCreate { [weak self] in
      WebKitPages.shared.emit = { [weak self] name, body in self?.sendEvent(name, body) }
    }

    // Loads `url` in the tab's WebKit page, making the page if it has none.
    AsyncFunction("load") { (tabId: String, url: String, ephemeral: Bool) in
      WebKitPages.shared.load(tabId: tabId, url: url, ephemeral: ephemeral)
    }.runOnQueue(.main)

    // back, forward, reload, reloadFromOrigin or stop.
    AsyncFunction("command") { (tabId: String, command: String) in
      WebKitPages.shared.page(tabId)?.run(command)
    }.runOnQueue(.main)

    // Keys go to the page again, after the address field or a panel.
    AsyncFunction("focus") { (tabId: String) in
      WebKitPages.shared.page(tabId)?.focus()
    }.runOnQueue(.main)

    // The tab closed or went back to Chromium: the page and its media stop.
    AsyncFunction("close") { (tabId: String) in
      WebKitPages.shared.close(tabId: tabId)
    }.runOnQueue(.main)

    // A private window opened or closed; the last to close ends WebKit's
    // private session.
    AsyncFunction("privateWindow") { (windowId: String, open: Bool) in
      WebKitPages.shared.privateWindow(windowId, open: open)
    }.runOnQueue(.main)

    // Settings › General › Float videos when you switch tabs.
    AsyncFunction("autoPip") { (on: Bool) in
      WebKitPages.shared.autoPip = on
    }.runOnQueue(.main)

    View(MerlinWebKitPageView.self) {
      Prop("tabId") { (view, value: String) in view.tabID = value }
      Prop("active") { (view, value: Bool) in view.active = value }
      OnViewDidUpdateProps { view in view.bind() }
    }
  }
}

/// Places a tab's WebKit page in the layout. The page lives on in
/// WebKitPages while no view shows it, as a background tab's page does.
///
/// A page never leaves its window on a tab switch: it moves between this
/// view and the window's hidden parking view (WebKitPages.park) with
/// addSubview alone. Taken out of the window, WebKit drops the layer that
/// shows protected (FairPlay) video, and Netflix comes back black with its
/// sound still playing. Ardia keeps its WebKit pages in the window too.
final class MerlinWebKitPageView: ExpoView {
  var tabID = ""
  var active = false
  private weak var shown: MerlinWKWebView?
  private var wasActive = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    WebKitPages.shared.hosts.add(self)
  }

  func bind() {
    guard window != nil, !tabID.isEmpty, let page = WebKitPages.shared.page(tabID) else {
      detach()
      return
    }
    let webView = page.webView
    var placed = false
    if shown !== webView || webView.superview !== self {
      detach()
      webView.frame = bounds
      webView.autoresizingMask = [.width, .height]
      // From the parking view, or another place in this window: a move
      // within the window, never through no window at all.
      addSubview(webView)
      shown = webView
      placed = true
      WebKitPages.shared.pageShown(page)
    }
    // The active page takes the keys when it appears, unless a text field
    // (the address, the command menu) has them, as Chromium's pages do.
    if active && (placed || !wasActive) { page.focus(unlessTyping: true) }
    wasActive = active
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    shown?.frame = bounds
  }

  // React removes this view when its tab stops showing; park the page while
  // this view is still in the window, so the page stays in it.
  override func viewWillMove(toWindow newWindow: NSWindow?) {
    if newWindow !== window { detach() }
    super.viewWillMove(toWindow: newWindow)
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    bind()
  }

  private func detach() {
    if let shown, shown.superview === self { WebKitPages.shared.park(shown) }
    shown = nil
  }
}
