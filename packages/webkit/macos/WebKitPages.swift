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
  /// Private windows share one session, like Chromium's off-the-record
  /// profile: a store never written to disk, which ends with the last
  /// private window (and its last page). The next private page starts a new
  /// one.
  private var privateSession: PrivateSession?

  /// One parking view per window for WebKit pages outside the tab layout.
  private let parking = NSMapTable<NSWindow, NSView>.weakToStrongObjects()

  func page(_ tabId: String) -> WebKitPage? { pages[tabId] }

  /// A folder of WebKit data of the tests' own ($MERLIN_WEBKIT_TEST_FOLDER):
  /// normal pages keep their cookies and site data in a store of their own
  /// and their icons in a cache there, so a test never reads or clears the
  /// person's.
  static let testFolder: URL? = ProcessInfo.processInfo.environment["MERLIN_WEBKIT_TEST_FOLDER"]
    .flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0, isDirectory: true) }

  /// Normal pages' store: WebKit's default one for this app.
  lazy var normalStore: WKWebsiteDataStore = {
    guard let folder = Self.testFolder else { return .default() }
    return WKWebsiteDataStore(forIdentifier: Self.storeIdentifier(in: folder))
  }()

  /// Normal pages' icons, cached in a folder of their own.
  lazy var normalIcons = IconFetcher(cache: Self.testFolder?.appendingPathComponent("icons") ??
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent(Bundle.main.bundleIdentifier ?? "io.github.kylianmarceau.merlin")
      .appendingPathComponent("WebKitIcons"))

  func icons(ephemeral: Bool) -> IconFetcher { ephemeral ? openPrivateSession().icons : normalIcons }

  /// WebKit's part of Clear Browsing Data: "cookies" (cookies and site
  /// data) and "cache" since `since` (seconds since the epoch), or all of a
  /// site's (a registrable domain, as WebKit's records name them). Private
  /// windows clear their own session. Icons' cache goes with either.
  func clear(since: Double, types: Set<String>, site: String?, privateSession isPrivate: Bool,
             completion: @escaping () -> Void) {
    var kinds = Set<String>()
    if types.contains("cookies") { kinds.formUnion(WKWebsiteDataStore.allWebsiteDataTypes().subtracting(Self.cacheTypes)) }
    if types.contains("cache") { kinds.formUnion(Self.cacheTypes) }
    // History: WebKit pages keep none of their own, beyond their tabs' Back lists.
    let session = isPrivate ? privateSession : nil
    guard !kinds.isEmpty, !isPrivate || session != nil else { return completion() }
    let store = session?.store ?? normalStore
    (session?.icons ?? normalIcons).clearCache(since: site == nil ? since : 0)
    if let site {
      // Cookies by their own domain, exactly; other data by WebKit's records,
      // which name the registrable domain (and may group hosts it doesn't
      // know the registry of, such as *.localhost).
      let cookies = store.httpCookieStore
      let matches = { (domain: String) -> Bool in
        let domain = domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return domain == site || domain.hasSuffix("." + site)
      }
      let records = { (done: @escaping () -> Void) in
        store.fetchDataRecords(ofTypes: kinds.subtracting([WKWebsiteDataTypeCookies])) { records in
          store.removeData(ofTypes: kinds.subtracting([WKWebsiteDataTypeCookies]),
                           for: records.filter { $0.displayName.lowercased() == site }, completionHandler: done)
        }
      }
      guard kinds.contains(WKWebsiteDataTypeCookies) else { return records(completion) }
      cookies.getAllCookies { all in
        let group = DispatchGroup()
        for cookie in all where matches(cookie.domain) {
          group.enter()
          cookies.delete(cookie) { group.leave() }
        }
        group.notify(queue: .main) { records(completion) }
      }
    } else {
      store.removeData(ofTypes: kinds, modifiedSince: Date(timeIntervalSince1970: since), completionHandler: completion)
    }
  }

  private static let cacheTypes: Set<String> = [
    WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeOfflineWebApplicationCache,
    WKWebsiteDataTypeFetchCache,
  ]

  /// The test folder's store, named in the folder so the tests can remove it.
  private static func storeIdentifier(in folder: URL) -> UUID {
    let file = folder.appendingPathComponent("webkit-store-id")
    if let text = try? String(contentsOf: file, encoding: .utf8), let id = UUID(uuidString: text.trimmingCharacters(in: .whitespacesAndNewlines)) {
      return id
    }
    let id = UUID()
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    try? id.uuidString.write(to: file, atomically: true, encoding: .utf8)
    return id
  }

  /// Keep the view in its window and preserve the player’s screen position
  /// while WebKit hands its video layer to the floating window.
  func park(_ webView: MerlinWKWebView, inlineFrame: NSRect?) {
    guard let window = webView.window, let content = window.contentView else { return }
    let holder: NSView
    if let existing = parking.object(forKey: window), existing.superview === content {
      holder = existing
    } else {
      let view = WebKitParkingView(frame: content.bounds)
      view.autoresizingMask = [.width, .height]
      // Mask the outgoing page without reporting it hidden to WebKit while
      // its original layer is still needed for the PiP animation.
      view.wantsLayer = true
      view.layer?.opacity = 0
      content.addSubview(view, positioned: .below, relativeTo: nil)
      parking.setObject(view, forKey: window)
      holder = view
    }
    // The shell can already have detached an ancestor when AppKit calls
    // viewWillMove(toWindow:). Use the last frame from the attached layout.
    let frame = holder.convert(inlineFrame ?? webView.convert(webView.bounds, to: nil), from: nil)
    if let responder = window.firstResponder as? NSView, responder.isDescendant(of: webView) {
      window.makeFirstResponder(nil)
    }
    webView.autoresizingMask = []
    holder.addSubview(webView)
    webView.frame = frame
    guard let page = pages.values.first(where: { $0.webView === webView }) else {
      webView.isHidden = true
      return
    }
    if !autoPip || (!page.wasSeen && requestingPiP !== page) {
      webView.isHidden = true
    }
    scheduleSightUpdate(for: page)
  }

  private func finishParking(_ page: WebKitPage) {
    let view = page.webView
    guard requestingPiP !== page, let window = view.window,
          view.superview === parking.object(forKey: window) else { return }
    view.isHidden = true
  }

  // MARK: Automatic picture in picture

  // Chromium and WebKit share the AppKit window's sight decision.
  private let windowSight = NSMapTable<NSWindow, NSNumber>.weakToStrongObjects()
  private var sightObserver: NSObjectProtocol?
  private weak var requestingPiP: WebKitPage?
  private weak var floated: WebKitPage?

  var autoPip = true {
    didSet {
      if !autoPip, let page = floated { returnVideo(in: page) }
    }
  }

  private init() {
    sightObserver = NotificationCenter.default.addObserver(
      forName: Notification.Name("MerlinWindowSightDidChange"), object: nil, queue: nil
    ) { [weak self] note in
      guard let self, let window = note.object as? NSWindow,
        let visible = note.userInfo?["visible"] as? Bool else { return }
      self.windowSight.setObject(NSNumber(value: visible), forKey: window)
      for page in self.pages.values where page.webView.window === window {
        self.scheduleSightUpdate(for: page)
      }
    }
  }

  deinit {
    if let sightObserver { NotificationCenter.default.removeObserver(sightObserver) }
  }

  private func seen(_ page: WebKitPage) -> Bool {
    let view = page.webView
    guard let window = view.window, window.isVisible, view.superview is MerlinWebKitPageView else { return false }
    return windowSight.object(forKey: window)?.boolValue ?? !window.isMiniaturized
  }

  private func scheduleSightUpdate(for page: WebKitPage) {
    page.sightUpdate?.cancel()
    let update = DispatchWorkItem { [weak self, weak page] in
      guard let self, let page, !page.isClosed else { return }
      page.sightUpdate = nil
      let seen = self.seen(page)
      guard seen != page.wasSeen else {
        self.finishParking(page)
        return
      }
      page.wasSeen = seen
      if seen { self.returnVideo(in: page) }
      else { self.maybeFloat(page) }
    }
    page.sightUpdate = update
    // A native layout pass can move a page between hosts within one turn,
    // for example when creating a split. Read the final placement once.
    DispatchQueue.main.async(execute: update)
  }

  private func maybeFloat(_ page: WebKitPage) {
    guard autoPip, requestingPiP == nil, page.webView.window != nil else {
      finishParking(page)
      return
    }
    requestingPiP = page
    let open: () -> Void = { [weak self, weak page] in
      guard let self, let page, self.requestingPiP === page else { return }
      guard self.autoPip, !page.isClosed, !self.seen(page) else {
        self.requestingPiP = nil
        self.finishParking(page)
        return
      }
      page.floatVideo { [weak self, weak page] opened in
        guard let self, let page, self.requestingPiP === page else { return }
        self.requestingPiP = nil
        self.finishParking(page)
        guard opened, !page.isClosed else { return }
        self.floated = page
        if !self.autoPip || self.seen(page) { self.returnVideo(in: page) }
      }
    }
    // WebKit can close a player through its native controls. Check whether
    // the last automatic player is still open before starting another one.
    guard let other = floated, !other.isClosed else {
      open()
      return
    }
    other.isFloating { [weak self, weak page, weak other] active in
      guard let self, let page, self.requestingPiP === page else { return }
      if active {
        self.requestingPiP = nil
        self.finishParking(page)
        return
      }
      if self.floated === other { self.floated = nil }
      open()
    }
  }

  private func returnVideo(in page: WebKitPage) {
    guard floated === page else { return }
    page.returnVideo { [weak self, weak page] closed in
      if closed, let self, let page, self.floated === page { self.floated = nil }
    }
  }

  func pageShown(_ page: WebKitPage) {
    scheduleSightUpdate(for: page)
  }

  func load(tabId: String, url: String, ephemeral: Bool) {
    guard let target = URL(string: url), let scheme = target.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return }
    if let page = pages[tabId], page.ephemeral == ephemeral {
      page.load(target)
      return
    }
    close(tabId: tabId)
    let page = WebKitPage(tabId: tabId, ephemeral: ephemeral, configuration: configuration(ephemeral: ephemeral))
    pages[tabId] = page
    if ephemeral { openPrivateSession().pages.insert(tabId) }
    page.load(target)
    for host in hosts.allObjects where host.tabID == tabId { host.bind() }
  }

  func close(tabId: String) {
    guard let page = pages.removeValue(forKey: tabId) else { return }
    page.sightUpdate?.cancel()
    if floated === page { floated = nil }
    if requestingPiP === page { requestingPiP = nil }
    page.close()
    if page.ephemeral, let session = privateSession {
      session.pages.remove(tabId)
      endPrivateSessionIfUnused()
    }
  }

  /// A private window opened or closed. The shell says so, since the window
  /// and not only its pages keeps the session: a private window showing only
  /// Chromium pages still shares WebKit's sign-ins with the next page.
  func privateWindow(_ windowId: String, open: Bool) {
    if open {
      openPrivateSession().windows.insert(windowId)
    } else if let session = privateSession {
      session.windows.remove(windowId)
      guard session.windows.isEmpty else { return }
      // The last private window: its pages go with it, as Chromium's do.
      for tabId in session.pages { pages.removeValue(forKey: tabId)?.close() }
      session.pages.removeAll()
      endPrivateSessionIfUnused()
    }
  }

  private func openPrivateSession() -> PrivateSession {
    if let session = privateSession { return session }
    let session = PrivateSession()
    privateSession = session
    return session
  }

  /// No private window and no private page: the session ends. Its data is
  /// removed now rather than whenever WebKit lets the store go, and the
  /// store is dropped, so nothing from it reaches a later private page.
  private func endPrivateSessionIfUnused() {
    guard let session = privateSession, session.windows.isEmpty, session.pages.isEmpty else { return }
    privateSession = nil
    session.icons.invalidate()
    let store = session.store
    store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
      // Keeps the store until its data has gone.
      _ = store
    }
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
    configuration.websiteDataStore = ephemeral ? openPrivateSession().store : normalStore
    configuration.applicationNameForUserAgent = "Version/\(Self.safariVersion) Safari/605.1.15"
    configuration.mediaTypesRequiringUserActionForPlayback = []
    configuration.allowsAirPlayForMediaPlayback = true
    configuration.preferences.isElementFullscreenEnabled = true
    // Picture in picture, as in Safari: the player's own button, and video
    // floating when its tab is left (maybeFloat). On macOS WebKit offers it
    // only through this preference, which Safari sets and the public API
    // doesn't name; without it a video "does not support" the mode. Skipped
    // if a WebKit release drops it. Key-value coding finds its `_set…:`
    // setter and passes a real BOOL.
    if configuration.preferences.responds(to: NSSelectorFromString("_setAllowsPictureInPictureMediaPlayback:")) {
      configuration.preferences.setValue(true, forKey: "allowsPictureInPictureMediaPlayback")
    }
    WebKitPictureInPicture.install(on: configuration.userContentController)
    // A pop-up needs a click, except in a test instance, whose pages can't be clicked.
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = Self.testFolder != nil
    // Merlin makes no Safe Browsing lookups in Chromium; nor does WebKit here.
    configuration.preferences.isFraudulentWebsiteWarningEnabled = false
    configuration.defaultWebpagePreferences.preferredContentMode = .desktop
    return configuration
  }
}

/// Clear Browsing Data's way into WebKit, for the shell host (AppDelegate.mm's
/// clear_webkit_data), which Chromium calls: the request is the JSON that
/// MerlinShellAPI.h describes. The completion gets nil or an error.
@objc(MerlinWebKitData) public final class WebKitData: NSObject {
  @objc public static func clear(_ json: String, completion: @escaping (String?) -> Void) {
    guard let data = json.data(using: .utf8), let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let types = request["types"] as? [String] else { return completion("Invalid request") }
    let site = (request["site"] as? String).flatMap { $0.isEmpty ? nil : $0.lowercased() }
    WebKitPages.shared.clear(since: (request["since"] as? NSNumber)?.doubleValue ?? 0, types: Set(types), site: site,
                             privateSession: request["private"] as? Bool == true) { completion(nil) }
  }
}

/// The private windows' WebKit session: its store, and the private windows
/// and pages (by tab ID) that keep it open.
final class PrivateSession {
  let store = WKWebsiteDataStore.nonPersistent()
  /// Its icons: fetched with no disk cache, cookies or credentials.
  let icons = IconFetcher(cache: nil)
  var windows = Set<String>()
  var pages = Set<String>()
}

/// One tab's WebKit page. It reports its address, title, loading state and
/// colours to the shell, which shows them as the tab's own.
final class WebKitPage: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  fileprivate var wasSeen = false
  fileprivate var sightUpdate: DispatchWorkItem?
  private static let editFocusWorld = WKContentWorld.world(name: "MerlinEditorFocus")
  private static let editFocusMessage = "editorFocus"
  private static let editFocusScript = """
    (() => {
      function report() {
        const field = document.activeElement;
        const editing = field && (field.isContentEditable || field.shadowRoot ||
          field.matches('input, textarea, select, iframe, [role="textbox"], [role="searchbox"]'));
        window.webkit.messageHandlers.editorFocus.postMessage(!!editing);
      }
      addEventListener('focusin', report, true);
      addEventListener('focusout', () => queueMicrotask(report), true);
      addEventListener('pageshow', report);
      report();
    })();
    """

  let tabId: String
  let ephemeral: Bool
  let webView: MerlinWKWebView
  private var observations: [NSKeyValueObservation] = []
  private var queued = false
  private var crashed = false
  private var closed = false
  private var favicon: String?
  private var faviconPage: String?
  private var iconTask: URLSessionTask?
  /// Same-site windows the page opened (sign-in pop-ups), which keep `window.opener`.
  private var popups: [WebKitPopup] = []

  init(tabId: String, ephemeral: Bool, configuration: WKWebViewConfiguration) {
    self.tabId = tabId
    self.ephemeral = ephemeral
    webView = MerlinWKWebView(frame: .zero, configuration: configuration)
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = self
    configuration.userContentController.add(self, contentWorld: Self.editFocusWorld, name: Self.editFocusMessage)
    configuration.userContentController.addUserScript(WKUserScript(source: Self.editFocusScript,
      injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: Self.editFocusWorld))
    webView.allowsBackForwardNavigationGestures = true
    webView.allowsMagnification = true
    webView.isInspectable = true
    webView.onKey = { [weak self] command in
      guard let self else { return }
      if command == "reopenTab" { self.emit("reopenTab", [:]) }
      else { self.emit("pageKey", ["command": command]) }
    }
    webView.onScrollDirection = { [weak self] down in
      self?.emit("toolbarDirection", ["down": down])
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

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.name == Self.editFocusMessage, message.frameInfo.isMainFrame, let editing = message.body as? Bool {
      webView.pageIsEditing = editing
    }
  }

  func close() {
    guard !closed else { return }
    closed = true
    iconTask?.cancel()
    iconTask = nil
    popups.forEach { $0.close() }
    popups = []
    observations = []
    webView.onKey = nil
    webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.editFocusMessage, contentWorld: Self.editFocusWorld)
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    webView.stopLoading()
    webView.pauseAllMediaPlayback(completionHandler: nil)
    webView.closeAllMediaPresentations(completionHandler: nil)
    webView.removeFromSuperview()
  }

  var isClosed: Bool { closed }

  /// Evaluated as the browser's own action, which WebKit counts as a click,
  /// as picture in picture needs.
  private func media(_ script: String, _ done: @escaping (Bool) -> Void) {
    guard !closed else { return done(false) }
    WebKitPictureInPicture.evaluate(script, in: webView, completion: done)
  }

  func floatVideo(_ done: @escaping (Bool) -> Void) { media(WebKitPictureInPicture.floatScript, done) }
  func returnVideo(_ done: @escaping (Bool) -> Void) { media(WebKitPictureInPicture.returnScript, done) }
  func isFloating(_ done: @escaping (Bool) -> Void) { media(WebKitPictureInPicture.floatingScript, done) }

  /// A link or script in a pop-up opened another window: a tab, as from the page.
  func openTab(_ url: URL) { emit("openTab", ["url": url.absoluteString]) }

  func popupClosed(_ popup: WebKitPopup) { popups.removeAll { $0 === popup } }

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
  /// The page's icon as a data URL, fetched once per site, apart from the
  /// page's own networking (IconFetcher).
  private func loadIcon() {
    guard let host = webView.url?.host, faviconPage != host else { return }
    faviconPage = host
    favicon = nil
    iconTask?.cancel()
    iconTask = nil
    webView.evaluateJavaScript(Self.iconScript) { [weak self] value, _ in
      guard let self, !self.closed, self.faviconPage == host, let href = value as? String, let url = URL(string: href),
        url.scheme == "https" || url.scheme == "http" else { return }
      self.iconTask = WebKitPages.shared.icons(ephemeral: self.ephemeral).fetch(url) { [weak self] dataURL in
        guard let self, !self.closed, self.faviconPage == host else { return }
        self.iconTask = nil
        guard let dataURL else { return }
        self.favicon = dataURL
        self.changed()
      }
    }
  }

  // MARK: WKNavigationDelegate

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.allow) }
    let scheme = url.scheme?.lowercased() ?? ""
    // Other apps' links (mailto:, itms-apps:) are not opened from here.
    guard ["http", "https", "about", "data", "blob"].contains(scheme) else { return decisionHandler(.cancel) }
    if action.navigationType == .linkActivated && (scheme == "http" || scheme == "https") {
      let flags = action.modifierFlags.intersection([.shift, .option, .command, .control])
      let peek = UserDefaults.standard.string(forKey: "MerlinShell.peekModifier")
      if (flags == .shift && peek == "shift") || (flags == .option && peek == "option") {
        decisionHandler(.cancel)
        return emit("openTab", ["url": url.absoluteString, "peek": true])
      }
      if flags == .command || (action.targetFrame != nil && action.buttonNumber == 2) {
        decisionHandler(.cancel)
        return emit("openTab", ["url": url.absoluteString, "groupLink": flags == .command])
      }
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

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    self.webView.pageIsEditing = true
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

  /// A window the page opens on its own site (a sign-in or payment pop-up)
  /// opens as a pop-up window that keeps `window.opener`, as sign-in flows
  /// need. Any other opens a tab instead, which goes to whichever engine its
  /// site uses.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    let url = action.request.url
    if Self.sameSite(url, as: webView.url), !closed {
      let popup = WebKitPopup(opener: self, configuration: configuration, features: windowFeatures, parent: webView.window)
      popups.append(popup)
      return popup.webView
    }
    if let url, url.scheme == "https" || url.scheme == "http" {
      emit("openTab", ["url": url.absoluteString])
    }
    return nil
  }

  /// Whether `target` is on the page's site. An empty or about:blank window
  /// is the opener's own, until it navigates. Sites are compared by their
  /// last two labels, or three under a short second-level label (co.uk).
  static func sameSite(_ target: URL?, as page: URL?) -> Bool {
    guard let pageHost = page?.host?.lowercased(), page?.scheme == "https" || page?.scheme == "http" else { return false }
    guard let target, let host = target.host?.lowercased() else {
      return target == nil || target?.absoluteString == "about:blank" || target?.absoluteString.isEmpty == true
    }
    guard target.scheme == "https" || target.scheme == "http" else { return false }
    return site(host) == site(pageHost)
  }

  private static func site(_ host: String) -> String {
    let labels = host.split(separator: ".")
    if labels.count <= 2 || host.allSatisfy({ $0.isNumber || $0 == "." }) { return host }
    let second = labels[labels.count - 2]
    let keep = second.count <= 3 && labels.count >= 3 && ["co", "com", "org", "net", "gov", "ac", "edu", "ne", "or"].contains(String(second)) ? 3 : 2
    return labels.suffix(keep).joined(separator: ".")
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

/// A window a WebKit page opened on its own site: a plain titled window with
/// the page's host, so it can't pass for another site or for Merlin's own,
/// holding a web view WebKit made from the opener's configuration (same
/// store, `window.opener`). It closes when its script closes it, when its
/// opener's page closes, or when the person closes it.
final class WebKitPopup: NSObject, WKUIDelegate, WKNavigationDelegate, NSWindowDelegate {
  let webView: WKWebView
  private let window: NSWindow
  private weak var opener: WebKitPage?
  private var observation: NSKeyValueObservation?
  private var closing = false

  init(opener: WebKitPage, configuration: WKWebViewConfiguration, features: WKWindowFeatures, parent: NSWindow?) {
    self.opener = opener
    let width = CGFloat(features.width?.doubleValue ?? 500), height = CGFloat(features.height?.doubleValue ?? 640)
    let size = NSSize(width: min(max(width, 320), 1600), height: min(max(height, 240), 1200))
    webView = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
    window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .resizable, .miniaturizable],
                      backing: .buffered, defer: false)
    super.init()
    window.isReleasedWhenClosed = false
    window.contentView = webView
    window.delegate = self
    webView.uiDelegate = self
    webView.navigationDelegate = self
    observation = webView.observe(\.url) { [weak self] view, _ in self?.window.title = view.url?.host ?? "" }
    if let parent {
      let frame = parent.frame
      window.setFrameOrigin(NSPoint(x: frame.midX - size.width / 2, y: frame.midY - size.height / 2))
    } else {
      window.center()
    }
    window.makeKeyAndOrderFront(nil)
  }

  func close() {
    guard !closing else { return }
    closing = true
    observation = nil
    webView.uiDelegate = nil
    webView.navigationDelegate = nil
    webView.stopLoading()
    window.delegate = nil
    window.close()
    opener?.popupClosed(self)
  }

  func windowWillClose(_ notification: Notification) { close() }

  func webViewDidClose(_ webView: WKWebView) { close() }

  /// Windows the pop-up opens become tabs.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url, url.scheme == "https" || url.scheme == "http" { opener?.openTab(url) }
    return nil
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    let scheme = action.request.url?.scheme?.lowercased() ?? ""
    decisionHandler(["http", "https", "about", "data", "blob"].contains(scheme) ? .allow : .cancel)
  }
}

/// Fetches WebKit pages' icons, apart from every other networking in
/// Merlin: no cookies are sent or kept and no credentials are used.
/// Normal pages' icons are cached in a folder of their own; private pages'
/// in memory only, for as long as their session. A body stops at 256 KiB
/// while it arrives, and only an image that decodes is shown, redrawn as a
/// PNG of at most 64 pixels. Main thread only.
final class IconFetcher: NSObject, URLSessionDataDelegate {
  static let limit = 256 * 1024
  static let side: CGFloat = 64

  private var session: URLSession!
  private var bodies: [Int: Data] = [:]
  private var done: [Int: (String?) -> Void] = [:]

  /// `cache` is the folder for a disk cache; nil keeps nothing on disk.
  init(cache: URL?) {
    super.init()
    let configuration: URLSessionConfiguration = cache == nil ? .ephemeral : .default
    if let cache {
      configuration.urlCache = URLCache(memoryCapacity: 512 * 1024, diskCapacity: 16 * 1024 * 1024, directory: cache)
    }
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.httpCookieAcceptPolicy = .never
    configuration.urlCredentialStorage = nil
    configuration.timeoutIntervalForRequest = 15
    session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
  }

  /// Fetches `url`; `completion` gets a data URL, or nil. Cancelling the task calls it with nil.
  func fetch(_ url: URL, completion: @escaping (String?) -> Void) -> URLSessionTask {
    let task = session.dataTask(with: url)
    bodies[task.taskIdentifier] = Data()
    done[task.taskIdentifier] = completion
    task.resume()
    return task
  }

  /// Forgets cached icons stored since `since` (seconds since the epoch; 0: all).
  func clearCache(since: Double) {
    guard let cache = session.configuration.urlCache else { return }
    if since > 0 { cache.removeCachedResponses(since: Date(timeIntervalSince1970: since)) } else { cache.removeAllCachedResponses() }
  }

  /// Cancels every fetch and releases the session (and its memory cache).
  func invalidate() {
    session.invalidateAndCancel()
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? true
    let image = response.mimeType?.hasPrefix("image/") ?? false
    completionHandler(ok && image && response.expectedContentLength <= Int64(Self.limit) ? .allow : .cancel)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard var body = bodies[dataTask.taskIdentifier] else { return }
    body.append(data)
    if body.count > Self.limit {
      bodies[dataTask.taskIdentifier] = nil
      dataTask.cancel()
      return
    }
    bodies[dataTask.taskIdentifier] = body
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let body = bodies.removeValue(forKey: task.taskIdentifier)
    guard let completion = done.removeValue(forKey: task.taskIdentifier) else { return }
    guard error == nil, let body, !body.isEmpty else { return completion(nil) }
    completion(Self.png(body).map { "data:image/png;base64,\($0.base64EncodedString())" })
  }

  /// The image redrawn as a PNG no larger than `side` pixels; nil if it isn't one.
  static func png(_ data: Data) -> Data? {
    guard let image = NSImage(data: data), image.isValid else { return nil }
    let pixels = image.representations.map { CGFloat(max($0.pixelsWide, $0.pixelsHigh)) }.max() ?? 0
    let natural = pixels > 0 ? pixels : max(image.size.width, image.size.height)
    guard natural > 0, image.size.width > 0, image.size.height > 0 else { return nil }
    let scale = min(side, natural) / max(image.size.width, image.size.height)
    let width = max(1, Int((image.size.width * scale).rounded())), height = max(1, Int((image.size.height * scale).rounded()))
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8,
                                        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                        bytesPerRow: 0, bitsPerPixel: 0),
      let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    image.draw(in: NSRect(x: 0, y: 0, width: width, height: height), from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])
  }
}

/// Parked pages sit behind the tab layout and never receive its clicks.
private final class WebKitParkingView: NSView {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func accessibilityChildren() -> [Any]? { [] }
}

/// The page's web view. The browser's own shortcuts that act on the page
/// (reload, back, forward, stop) go to the shell, which knows when Back
/// leaves WebKit for the Chromium page before it; Chromium's menu would act
/// on the Chromium page behind.
final class MerlinWKWebView: WKWebView {
  var onKey: ((String) -> Void)?
  var onScrollDirection: ((Bool) -> Void)?
  private var toolbarHidden = false
  var pageIsEditing = true

  override func scrollWheel(with event: NSEvent) {
    let dx = event.scrollingDeltaX
    let dy = event.scrollingDeltaY
    if UserDefaults.standard.string(forKey: "MerlinShell.hideToolbarOnScroll") == "on",
       abs(dy) > abs(dx), abs(dy) >= 1, toolbarHidden != (dy < 0) {
      toolbarHidden = dy < 0
      onScrollDirection?(toolbarHidden)
    }
    super.scrollWheel(with: event)
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    // The browser's reserved shortcuts never reach the page, as in Chromium:
    // WebKit offers every key to the page first, and a page that takes all
    // keys (Netflix's player does) would keep Control-Tab from the browser.
    // Declining the key here lets Chromium's own key handling run it.
    if Self.reserved(event) { return false }
    guard let responder = window?.firstResponder as? NSView, responder.isDescendant(of: self), let onKey
    else { return super.performKeyEquivalent(with: event) }
    if !pageIsEditing, Self.isUndo(event),
       UserDefaults.standard.string(forKey: "MerlinShell.undoReopensTab") == "on" {
      onKey("reopenTab")
      return true
    }
    guard let command = Self.command(for: event) else { return super.performKeyEquivalent(with: event) }
    onKey(command)
    return true
  }

  /// Tab cycling, new and closed tabs and windows, quitting: what Chromium
  /// keeps from its own pages (BrowserCommandController::IsReservedCommand
  /// and Merlin's Control-Tab).
  static func reserved(_ event: NSEvent) -> Bool {
    guard event.type == .keyDown else { return false }
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
    if event.keyCode == 48 /* kVK_Tab */ { return flags == [.control] || flags == [.control, .shift] }
    let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
    switch (flags, key) {
    case ([.command], "t"), ([.command, .shift], "t"), ([.command], "w"), ([.command, .shift], "w"),
         ([.command], "n"), ([.command, .shift], "n"), ([.command], "q"):
      return true
    default:
      // Command-Option-Left/Right: the previous and next tab.
      return flags == [.command, .option] && (event.keyCode == 123 || event.keyCode == 124)
    }
  }

  private static func isUndo(_ event: NSEvent) -> Bool {
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
    return flags == [.command] && event.charactersIgnoringModifiers?.lowercased() == "z"
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
