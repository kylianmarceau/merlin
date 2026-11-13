import AppKit
import WebKit

/// Every tab's WebKit page, by the tab's ID, and how they are configured.
/// Main thread only.
final class WebKitPages {
  static let shared = WebKitPages()

  var emit: ((String, [String: Any]) -> Void)?
  /// Views that may be waiting for a page that doesn't exist yet: the shell
  /// asks for a page and lays out its view in the same update.
  let hosts = NSHashTable<MerlinWebKitPageView>.weakObjects()
  private var pages: [String: WebKitPage] = [:]
  /// Private windows share one store that is never written to disk, like
  /// Chromium's off-the-record profile. It goes when Merlin quits.
  private lazy var privateStore = WKWebsiteDataStore.nonPersistent()

  func page(_ tabId: String) -> WebKitPage? { pages[tabId] }

  func load(tabId: String, url: String, ephemeral: Bool) {
    guard let target = URL(string: url), let scheme = target.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return }
    if let page = pages[tabId], page.ephemeral == ephemeral {
      page.load(target)
      return
    }
    pages.removeValue(forKey: tabId)?.close()
    let page = WebKitPage(tabId: tabId, ephemeral: ephemeral, configuration: configuration(ephemeral: ephemeral))
    pages[tabId] = page
    page.load(target)
    for host in hosts.allObjects where host.tabID == tabId { host.bind() }
  }

  func close(tabId: String) {
    pages.removeValue(forKey: tabId)?.close()
  }

  /// Safari's version, so sites that check the browser (Netflix does) see
  /// the Safari they support rather than an unknown app.
  static let safariVersion: String = {
    for path in ["/Applications/Safari.app", "/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app"] {
      if let version = Bundle(path: path)?.infoDictionary?["CFBundleShortVersionString"] as? String {
        return version.split(separator: ".").prefix(2).joined(separator: ".")
      }
    }
    return "18.6"
  }()

  private func configuration(ephemeral: Bool) -> WKWebViewConfiguration {
    let configuration = WKWebViewConfiguration()
    // WebKit keeps its own cookies and sign-ins, apart from Chromium's.
    configuration.websiteDataStore = ephemeral ? privateStore : .default()
    configuration.applicationNameForUserAgent = "Version/\(Self.safariVersion) Safari/605.1.15"
    configuration.mediaTypesRequiringUserActionForPlayback = []
    configuration.allowsAirPlayForMediaPlayback = true
    configuration.preferences.isElementFullscreenEnabled = true
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    // Merlin makes no Safe Browsing lookups in Chromium; nor does WebKit here.
    configuration.preferences.isFraudulentWebsiteWarningEnabled = false
    configuration.defaultWebpagePreferences.preferredContentMode = .desktop
    return configuration
  }
}

/// One tab's WebKit page. It reports its address, title, loading state and
/// colours to the shell, which shows them as the tab's own.
final class WebKitPage: NSObject, WKNavigationDelegate, WKUIDelegate {
  let tabId: String
  let ephemeral: Bool
  let webView: MerlinWKWebView
  private var observations: [NSKeyValueObservation] = []
  private var queued = false
  private var crashed = false
  private var closed = false
  private var favicon: String?
  private var faviconPage: String?

  init(tabId: String, ephemeral: Bool, configuration: WKWebViewConfiguration) {
    self.tabId = tabId
    self.ephemeral = ephemeral
    webView = MerlinWKWebView(frame: .zero, configuration: configuration)
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    webView.allowsMagnification = true
    webView.isInspectable = true
    webView.onKey = { [weak self] command in
      guard let self else { return }
      self.emit("pageKey", ["command": command])
    }
    let changed: (WKWebView) -> Void = { [weak self] _ in self?.changed() }
    observations = [
      webView.observe(\.url) { view, _ in changed(view) },
      webView.observe(\.title) { view, _ in changed(view) },
      webView.observe(\.isLoading) { view, _ in changed(view) },
      webView.observe(\.canGoBack) { view, _ in changed(view) },
      webView.observe(\.canGoForward) { view, _ in changed(view) },
      webView.observe(\.themeColor) { view, _ in changed(view) },
      webView.observe(\.underPageBackgroundColor) { view, _ in changed(view) },
    ]
  }

  func load(_ url: URL) {
    crashed = false
    webView.load(URLRequest(url: url))
  }

  func run(_ command: String) {
    switch command {
    case "back": webView.goBack()
    case "forward": webView.goForward()
    case "reload":
      if crashed, let url = webView.url { return load(url) }
      webView.reload()
    case "reloadFromOrigin":
      if crashed, let url = webView.url { return load(url) }
      webView.reloadFromOrigin()
    case "stop": webView.stopLoading()
    default: break
    }
  }

  func focus(unlessTyping: Bool = false) {
    guard let window = webView.window else { return }
    let responder = window.firstResponder
    if unlessTyping, responder is NSText || responder is NSTextField { return }
    if let view = responder as? NSView, view.isDescendant(of: webView) { return }
    window.makeFirstResponder(webView)
  }

  func close() {
    guard !closed else { return }
    closed = true
    observations = []
    webView.onKey = nil
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    webView.stopLoading()
    webView.pauseAllMediaPlayback(completionHandler: nil)
    webView.closeAllMediaPresentations(completionHandler: nil)
    webView.removeFromSuperview()
  }

  private func emit(_ name: String, _ body: [String: Any]) {
    guard !closed else { return }
    var body = body
    body["tabId"] = tabId
    WebKitPages.shared.emit?(name, body)
  }

  /// KVO fires several times per navigation; the shell hears once per turn.
  private func changed() {
    guard !queued, !closed else { return }
    queued = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.queued = false
      self.emitState()
    }
  }

  private func emitState() {
    var state: [String: Any] = [
      "url": webView.url?.absoluteString ?? "",
      "title": webView.title ?? "",
      "loading": webView.isLoading,
      "canGoBack": webView.canGoBack,
      "canGoForward": webView.canGoForward,
      "crashed": crashed,
    ]
    if let color = webView.themeColor.flatMap({ hex($0) }) { state["color"] = color }
    if let surface = hex(webView.underPageBackgroundColor) { state["surface"] = surface }
    if let favicon, faviconPage == webView.url?.host { state["favicon"] = favicon }
    emit("pageState", state)
  }

  private func hex(_ color: NSColor) -> String? {
    var rgb: NSColor?
    webView.effectiveAppearance.performAsCurrentDrawingAppearance { rgb = color.usingColorSpace(.sRGB) }
    guard let rgb, rgb.alphaComponent > 0.5 else { return nil }
    let channel = { (value: CGFloat) in max(0, min(255, Int((value * 255).rounded()))) }
    return String(format: "#%02X%02X%02X", channel(rgb.redComponent), channel(rgb.greenComponent), channel(rgb.blueComponent))
  }

  // MARK: Icons

  private static let iconScript = """
    (() => {
      const links = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')];
      const size = l => parseInt((l.sizes && l.sizes.value || '').split('x')[0], 10) || 0;
      links.sort((a, b) => Math.abs(size(a) - 32) - Math.abs(size(b) - 32));
      return links.length ? links[0].href : new URL('/favicon.ico', location.href).href;
    })()
    """
  private static let iconLimit = 256 * 1024

  /// The page's icon as a data URL, fetched once per site.
  private func loadIcon() {
    guard let host = webView.url?.host, faviconPage != host else { return }
    faviconPage = host
    favicon = nil
    webView.evaluateJavaScript(Self.iconScript) { [weak self] value, _ in
      guard let self, let href = value as? String, let url = URL(string: href), url.scheme == "https" || url.scheme == "http" else { return }
      URLSession.shared.dataTask(with: url) { data, response, _ in
        guard let data, !data.isEmpty, data.count <= Self.iconLimit,
          let type = (response as? HTTPURLResponse)?.mimeType ?? response?.mimeType, type.hasPrefix("image/") else { return }
        let dataURL = "data:\(type);base64,\(data.base64EncodedString())"
        DispatchQueue.main.async {
          guard !self.closed, self.faviconPage == host else { return }
          self.favicon = dataURL
          self.changed()
        }
      }.resume()
    }
  }

  // MARK: WKNavigationDelegate

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.allow) }
    let scheme = url.scheme?.lowercased() ?? ""
    // Other apps' links (mailto:, itms-apps:) are not opened from here.
    guard ["http", "https", "about", "data", "blob"].contains(scheme) else { return decisionHandler(.cancel) }
    if action.navigationType == .linkActivated, action.targetFrame != nil,
      action.modifierFlags.contains(.command) || action.buttonNumber == 2 {
      decisionHandler(.cancel)
      return emit("openTab", ["url": url.absoluteString])
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
               decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    // WebKit pages don't download; Chromium does.
    if response.isForMainFrame && !response.canShowMIMEType {
      decisionHandler(.cancel)
      if let url = response.response.url { emit("openTab", ["url": url.absoluteString, "download": true]) }
      return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loadIcon()
    changed()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    report(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    report(error)
  }

  private func report(_ error: Error) {
    let error = error as NSError
    changed()
    // A newer navigation, or a page the policy above turned away.
    if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return }
    if error.domain == "WebKitErrorDomain" && error.code == 102 { return }
    emit("pageError", ["message": error.localizedDescription])
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    crashed = true
    changed()
  }

  // MARK: WKUIDelegate

  /// Links and scripts that open a window open a tab instead, which goes to
  /// whichever engine its site uses.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url, url.scheme == "https" || url.scheme == "http" {
      emit("openTab", ["url": url.absoluteString])
    }
    return nil
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    guard let window = webView.window else { return completionHandler() }
    let alert = alertFor(frame, message)
    alert.addButton(withTitle: "OK")
    alert.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    guard let window = webView.window else { return completionHandler(false) }
    let alert = alertFor(frame, message)
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
    guard let window = webView.window else { return completionHandler(nil) }
    let alert = alertFor(frame, prompt)
    let field = NSTextField(string: defaultText ?? "")
    field.frame = NSRect(x: 0, y: 0, width: 260, height: 24)
    alert.accessoryView = field
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    guard let window = webView.window else { return completionHandler(nil) }
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.canChooseFiles = true
    panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
  }

  private func alertFor(_ frame: WKFrameInfo, _ message: String) -> NSAlert {
    let alert = NSAlert()
    let host = frame.securityOrigin.host
    alert.messageText = host.isEmpty ? "This page says" : "\(host) says"
    alert.informativeText = message
    return alert
  }
}

/// The page's web view. The browser's own shortcuts that act on the page
/// (reload, back, forward, stop) go to the shell, which knows when Back
/// leaves WebKit for the Chromium page before it; Chromium's menu would act
/// on the Chromium page behind.
final class MerlinWKWebView: WKWebView {
  var onKey: ((String) -> Void)?

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard let responder = window?.firstResponder as? NSView, responder.isDescendant(of: self), let onKey,
      let command = Self.command(for: event)
    else { return super.performKeyEquivalent(with: event) }
    onKey(command)
    return true
  }

  static func command(for event: NSEvent) -> String? {
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
    let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
    switch (flags, key) {
    case ([.command], "r"): return "reload"
    case ([.command, .shift], "r"): return "reloadFromOrigin"
    case ([.command], "["): return "back"
    case ([.command], "]"): return "forward"
    case ([.command], "."): return "stop"
    default: return nil
    }
  }
}
