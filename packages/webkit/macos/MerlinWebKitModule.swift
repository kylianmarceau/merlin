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
    Events("pageState", "openTab", "pageKey", "pageError")

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

    View(MerlinWebKitPageView.self) {
      Prop("tabId") { (view, value: String) in view.tabID = value }
      Prop("active") { (view, value: Bool) in view.active = value }
      OnViewDidUpdateProps { view in view.bind() }
    }
  }
}

/// Places a tab's WebKit page in the layout. The page lives on in
/// WebKitPages while no view shows it, as a background tab's page does.
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
      webView.removeFromSuperview()
      webView.frame = bounds
      webView.autoresizingMask = [.width, .height]
      addSubview(webView)
      shown = webView
      placed = true
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

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    bind()
  }

  private func detach() {
    if let shown, shown.superview === self { shown.removeFromSuperview() }
    shown = nil
  }
}
