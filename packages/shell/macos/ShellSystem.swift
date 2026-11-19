import AppKit
import ExpoModulesCore
import ServiceManagement
import UniformTypeIdentifiers

// System integration the Settings sheet controls: Finder file icons, the
// default browser, opening at login, thin scroll bars, the ⌘Q warning and the
// Bookmarks menu (the app icon is in AppIcons.swift). Each reads and writes
// macOS state only; the choices themselves are shell preferences
// (MerlinShell.* defaults).

enum ShellDefaults {
  static func string(_ key: String) -> String? { UserDefaults.standard.string(forKey: "MerlinShell.\(key)") }
  static func set(_ key: String, _ value: String?) {
    if let value { UserDefaults.standard.set(value, forKey: "MerlinShell.\(key)") }
    else { UserDefaults.standard.removeObject(forKey: "MerlinShell.\(key)") }
  }
}

enum FileIcons {
  private static var cache: [String: String] = [:]

  /// The Finder icon for files with this extension, as a PNG data URL at twice `size`.
  static func dataURL(ext: String, size: Double) -> String? {
    let key = "\(ext.lowercased())@\(size)"
    if let hit = cache[key] { return hit }
    let type = UTType(filenameExtension: ext) ?? .data
    let icon = NSWorkspace.shared.icon(for: type)
    let pixels = Int(size * 2)
    guard pixels > 0, let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8,
                                                  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                                  bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    rep.size = NSSize(width: size, height: size)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    icon.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
    let url = "data:image/png;base64,\(png.base64EncodedString())"
    cache[key] = url
    return url
  }
}

enum DefaultBrowser {
  static var isDefault: Bool {
    guard let probe = URL(string: "https://example.com"),
          let handler = NSWorkspace.shared.urlForApplication(toOpen: probe) else { return false }
    return Bundle(url: handler)?.bundleIdentifier == Bundle.main.bundleIdentifier
  }

  /// Asks macOS to make this app the browser; macOS confirms with the person first.
  static func make(_ done: @escaping (Bool) -> Void) {
    let app = Bundle.main.bundleURL
    NSWorkspace.shared.setDefaultApplication(at: app, toOpenURLsWithScheme: "http") { _ in
      NSWorkspace.shared.setDefaultApplication(at: app, toOpenURLsWithScheme: "https") { _ in
        DispatchQueue.main.async { done(isDefault) }
      }
    }
  }
}

enum LoginItem {
  /// "enabled", "requiresApproval", "notRegistered" or "notFound".
  static var status: String {
    switch SMAppService.mainApp.status {
    case .enabled: "enabled"
    case .requiresApproval: "requiresApproval"
    case .notFound: "notFound"
    default: "notRegistered"
    }
  }

  static func set(_ on: Bool) throws {
    if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
  }
}

// Thin scroll bars: AppKit, and Chromium's pages with it, draw overlay
// scrollers whatever System Settings says. Chromium sends the preferred style
// to its renderers when the system notification below arrives. From Ardia's
// ThinScrollBars (Apache License 2.0).
enum ThinScrollBars {
  private static var thin = false
  private static var installed = false
  private static let selector = #selector(getter: NSScroller.preferredScrollerStyle)

  static func set(_ on: Bool) {
    guard on != thin else { return }
    if on { install() }
    guard installed else { return }
    thin = on
    NotificationCenter.default.post(name: NSScroller.preferredScrollerStyleDidChangeNotification, object: nil)
  }

  private static func install() {
    guard !installed, let method = class_getClassMethod(NSScroller.self, selector) else { return }
    typealias Preferred = @convention(c) (AnyClass, Selector) -> Int
    let system = unsafeBitCast(method_getImplementation(method), to: Preferred.self)
    let preferred: @convention(block) (AnyClass) -> Int = { scroller in
      thin ? NSScroller.Style.overlay.rawValue : system(scroller, selector)
    }
    method_setImplementation(method, imp_implementationWithBlock(preferred))
    installed = true
  }
}

// "Warn before quitting": the Quit item's ⌘Q asks first. The item keeps its
// place and title; only its target changes, and the original action runs
// once the person agrees. Quitting from the Dock is not asked about.
final class QuitGuard: NSObject, NSMenuItemValidation {
  static let shared = QuitGuard()
  var onSuppressed: (() -> Void)?
  private weak var item: NSMenuItem?
  private var originalAction: Selector?
  private weak var originalTarget: AnyObject?

  func install() {
    guard item == nil, let quit = Self.findQuitItem() else { return }
    item = quit
    originalAction = quit.action
    originalTarget = quit.target as AnyObject?
    quit.target = self
    quit.action = #selector(confirm(_:))
  }

  private static func findQuitItem() -> NSMenuItem? {
    guard let app = NSApp.mainMenu?.items.first?.submenu else { return nil }
    return app.items.first { $0.keyEquivalent == "q" && $0.keyEquivalentModifierMask == .command }
  }

  func validateMenuItem(_ menuItem: NSMenuItem) -> Bool { true }

  @objc func confirm(_ sender: Any?) {
    if ShellDefaults.string("warnBeforeQuitting") == "on" {
      let alert = NSAlert()
      let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Merlin"
      alert.messageText = "Are you sure you want to quit \(name)?"
      alert.informativeText = "Your windows and tabs open again the next time you start it, if Settings › General says so."
      alert.addButton(withTitle: "Quit")
      alert.addButton(withTitle: "Cancel")
      alert.showsSuppressionButton = true
      alert.suppressionButton?.title = "Don't ask again"
      let response = alert.runModal()
      if alert.suppressionButton?.state == .on {
        ShellDefaults.set("warnBeforeQuitting", nil)
        onSuppressed?()
      }
      guard response == .alertFirstButtonReturn else { return }
    }
    if let action = originalAction, NSApp.sendAction(action, to: originalTarget, from: item) { return }
    NSApp.terminate(nil)
  }
}

// Menu bar items Chromium adds that do nothing in Merlin or read as Chrome:
// the address bar's Lens, AI Mode and search-tools toggles (Merlin's address
// field has none of them), vertical tabs (Merlin has its own sidebar), Cast
// (off), Name Window and the Window menu's Extensions page. Chromium's main
// menu items carry their command IDs as tags. They are hidden again whenever
// the menu bar opens, as Chromium updates its menus as they open.
enum MenuTidy {
  private static let hiddenTags: Set<Int> = [
    40282,  // IDC_SHOW_GOOGLE_LENS_SHORTCUT
    40299,  // IDC_SHOW_AI_MODE_OMNIBOX_BUTTON
    40296,  // IDC_SHOW_SEARCH_TOOLS
    34058,  // IDC_TOGGLE_VERTICAL_TABS
    34061,  // IDC_TOGGLE_VERTICAL_TABS_COLLAPSE
    35011,  // IDC_ROUTE_MEDIA
    34049,  // IDC_NAME_WINDOW
    40022,  // IDC_MANAGE_EXTENSIONS
  ]
  private static let fullScreenTag = 34030  // IDC_FULLSCREEN
  private static var observer: NSObjectProtocol?

  static func install() {
    tidy()
    guard observer == nil else { return }
    observer = NotificationCenter.default.addObserver(forName: NSMenu.didBeginTrackingNotification, object: nil, queue: .main) { _ in
      tidy()
      // Chromium fills its tab list as the menu opens; tidy what it added.
      DispatchQueue.main.async { tidy() }
    }
  }

  private static func tidy() {
    guard let menu = NSApp.mainMenu else { return }
    for item in menu.items { if let submenu = item.submenu { tidy(submenu) } }
  }

  private static func tidy(_ menu: NSMenu) {
    var touched = false
    // AppKit adds its own Enter Full Screen to a View menu that already has Chromium's.
    let chromiumFullScreen = menu.items.contains { $0.tag == fullScreenTag }
    for item in menu.items where item.title.hasPrefix("chrome://newtab") || item.title.hasPrefix("chrome://new-tab-page") {
      // The Tab menu lists the window's tabs; a new tab has no title, and Chromium fell back to its raw address.
      item.title = "New Tab"
    }
    for item in menu.items {
      let appKitFullScreen = chromiumFullScreen && item.tag != fullScreenTag
        && item.action == #selector(NSWindow.toggleFullScreen(_:))
      if hiddenTags.contains(item.tag) || appKitFullScreen {
        if !item.isHidden { item.isHidden = true }
        touched = true
      }
      if let submenu = item.submenu { tidy(submenu) }
    }
    guard touched else { return }
    // A separator with nothing left between it and the previous one, the
    // start or the end of the menu goes too. Only in menus we took items
    // from, so one that fills in later (History) keeps its separators.
    var previousWasSeparator = true
    var trailing: NSMenuItem?
    for item in menu.items where !item.isHidden {
      if item.isSeparatorItem {
        if previousWasSeparator { item.isHidden = true; continue }
        previousWasSeparator = true
        trailing = item
      } else {
        previousWasSeparator = false
        trailing = nil
      }
    }
    trailing?.isHidden = true
  }
}

enum BookmarksMenu {
  static func setHidden(_ hidden: Bool) {
    NSApp.mainMenu?.items.first { $0.submenu?.title == "Bookmarks" || $0.title == "Bookmarks" }?.isHidden = hidden
  }
}

// Reports whether its window is in macOS full screen (not a page's own
// fullscreen, which Chromium reports in the snapshot).
final class MerlinWindowState: ExpoView {
  let onFullScreen = EventDispatcher()
  // Whether the window is in front (key), and which of its edges meet the
  // screen's, so the hidden tabs' edge strip can be wider when they don't.
  let onWindowState = EventDispatcher()
  private var observers: [NSObjectProtocol] = []
  private var titleWatch: NSKeyValueObservation?
  // The traffic lights. Hidden while the tabs are, as in Dia, and shown again
  // when the tabs peek in from the edge. Never hidden in macOS full screen,
  // where they live in the menu bar's drop-down title bar.
  var windowButtons = true { didSet { applyButtons() } }
  // The window's name in the Window menu and Mission Control: the front tab's
  // title, as in Dia. Chromium names every window "Merlin" whenever a tab
  // changes, so the name is put back each time it does.
  var windowTitle: String? { didSet { applyTitle() } }

  private func applyButtons() {
    guard let window else { return }
    let hide = !windowButtons && !window.styleMask.contains(.fullScreen)
    for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
      if let button = window.standardWindowButton(kind), button.isHidden != hide { button.isHidden = hide }
    }
  }

  private func applyTitle() {
    guard let window, let title = windowTitle, !title.isEmpty, window.title != title else { return }
    window.title = title
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
    titleWatch = nil
    guard let window else { return }
    for name in [NSWindow.didEnterFullScreenNotification, NSWindow.didExitFullScreenNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
        self?.report()
        self?.applyButtons()
        self?.reportState()
      })
    }
    for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification, NSWindow.didMoveNotification,
                 NSWindow.didResizeNotification, NSWindow.didChangeScreenNotification, NSApplication.didBecomeActiveNotification,
                 NSApplication.didResignActiveNotification] {
      let object: Any? = name.rawValue.hasPrefix("NSApplication") ? nil : window
      observers.append(NotificationCenter.default.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in
        self?.reportState()
      })
    }
    titleWatch = window.observe(\.title, options: [.new]) { [weak self] _, _ in
      DispatchQueue.main.async { self?.applyTitle() }
    }
    report()
    applyButtons()
    applyTitle()
    reportState()
  }

  private func report() {
    onFullScreen(["fullScreen": window?.styleMask.contains(.fullScreen) ?? false])
  }

  private var lastState: [String: Bool] = [:]
  private func reportState() {
    guard let window else { return }
    let screen = (window.screen ?? NSScreen.main)?.visibleFrame ?? .zero
    let frame = window.frame
    let slack: CGFloat = 2
    let state = [
      "key": window.isKeyWindow && NSApp.isActive,
      "leftEdge": frame.minX <= screen.minX + slack,
      "topEdge": frame.maxY >= screen.maxY - slack,
    ]
    guard state != lastState else { return }
    lastState = state
    onWindowState(state)
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

