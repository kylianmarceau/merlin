import AppKit
import ExpoModulesCore
import ServiceManagement
import UniformTypeIdentifiers

// System integration the Settings sheet controls: Finder file icons, the
// default browser, opening at login, thin scroll bars, the ⌘Q warning, the
// Bookmarks menu and the app icon. Each reads and writes macOS state only;
// the choices themselves are shell preferences (MerlinShell.* defaults).

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

enum BookmarksMenu {
  static func setHidden(_ hidden: Bool) {
    NSApp.mainMenu?.items.first { $0.submenu?.title == "Bookmarks" || $0.title == "Bookmarks" }?.isHidden = hidden
  }
}

// App icons drawn from Merlin's falcon (branding/merlin-mono.svg) on a tile
// in the Apple icon grid, as Ardia draws its variants. The Dock shows the
// chosen one while Merlin runs; the bundle itself is never modified, so its
// signature stays intact and the Dock shows the default after quitting.
enum AppIcons {
  struct Variant { let id: String; let name: String; let plate: (NSColor, NSColor); let ink: String }

  private static func rgb(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat(hex >> 16 & 255) / 255, green: CGFloat(hex >> 8 & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
  }

  static let variants: [Variant] = [
    Variant(id: "midnight", name: "Midnight", plate: (rgb(0x34322F), rgb(0x121110)), ink: "#F3E8D8"),
    Variant(id: "sage", name: "Sage", plate: (rgb(0x4F8F75), rgb(0x214E40)), ink: "#F3EDE2"),
    Variant(id: "ocean", name: "Ocean", plate: (rgb(0x3F86AB), rgb(0x154A62)), ink: "#F1F0EA"),
    Variant(id: "ember", name: "Ember", plate: (rgb(0xC0693F), rgb(0x7A3C21)), ink: "#F6E6D6"),
    Variant(id: "mono", name: "Mono", plate: (rgb(0xFAFAFA), rgb(0xD9D9DC)), ink: "#2C2C2E"),
  ]

  private static let falcon = "M20.484 5.981C20.748 6.047 20.898 6.06 21.128 6.283C21.605 6.746 21.49 7.272 21.148 7.751C21.128 7.644 21.14 7.526 21.088 7.429C20.82 6.931 19.887 7.12 19.459 7.188C19.936 6.855 20.464 6.637 20.464 6.001C20.18 6.76 19.191 6.869 18.634 7.409C17.839 8.181 17.511 9.286 17.125 10.286C17.06 9.934 17.05 9.69 16.884 9.381C15.805 7.371 13.237 7.969 11.553 8.757C8.725 10.08 5.974 11.971 2.743 12.096C1.664 12.138 1.51 12.066 0.55 11.895C1.794 11.481 2.127 11.414 3.346 10.809C5.058 9.958 5.859 9.296 7.651 8.214C8.571 7.658 9.503 7.12 10.447 6.605C11.882 5.822 13.449 4.999 15.073 4.674C16.498 4.389 17.892 4.382 19.278 4.855C19.825 5.042 20.428 5.357 20.484 5.981ZM6.786 17.527C6.916 17.137 6.761 17.562 7.651 16.884C7.916 16.682 8.169 16.464 8.415 16.24C9.671 15.1 10.82 13.729 11.292 12.076C10.114 12.322 9.154 12.572 7.973 12.66C6.524 12.766 6.484 12.712 5.177 12.579C9.324 10.871 5.261 12.606 11.573 9.542C11.952 9.358 12.346 9.206 12.74 9.059C13.677 8.71 15.228 8.361 15.938 9.34C16.088 9.546 16.275 9.88 16.28 10.165C16.285 10.414 16.28 10.664 16.24 10.909C16.206 11.117 16.135 11.317 16.059 11.513C15.901 11.922 15.65 12.382 15.395 12.74C13.467 15.448 10.07 17.254 6.786 17.527ZM17.548 5.398C17.88 5.597 17.673 5.498 18.191 5.639C18.269 5.951 18.363 6.126 18.674 6.243C19.17 6.155 18.937 6.267 19.338 5.84C19.445 5.834 19.552 5.827 19.66 5.82C19.028 5.505 18.247 5.398 17.548 5.398Z"

  static var current: String {
    let id = ShellDefaults.string("appIcon") ?? "default"
    return variants.contains { $0.id == id } ? id : "default"
  }

  static func restore() { if current != "default" { apply() } }

  static func set(_ id: String) {
    ShellDefaults.set("appIcon", id == "default" || !variants.contains { $0.id == id } ? nil : id)
    apply()
  }

  private static func apply() {
    NSApp.applicationIconImage = current == "default" ? nil : image(current, size: 512)
  }

  private static var cache: [String: NSImage] = [:]

  static func image(_ id: String, size: CGFloat) -> NSImage? {
    let key = "\(id)@\(size)"
    if let hit = cache[key] { return hit }
    let made: NSImage?
    if id == "default" {
      made = NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath)
    } else if let variant = variants.first(where: { $0.id == id }) {
      let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 22 22\"><path d=\"\(falcon)\" fill=\"\(variant.ink)\"/></svg>"
      guard let mark = NSImage(data: Data(svg.utf8)) else { return nil }
      made = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
        // Apple's grid: an 824/1024 body, its corners continuous.
        let unit = rect.width / 1024
        let body = rect.insetBy(dx: 100 * unit, dy: 100 * unit)
        let plate = NSBezierPath(roundedRect: body, xRadius: 185 * unit, yRadius: 185 * unit)
        NSGradient(starting: variant.plate.0, ending: variant.plate.1)?.draw(in: plate, angle: -90)
        mark.draw(in: rect.insetBy(dx: 153 * unit, dy: 153 * unit))
        return true
      }
    } else {
      made = nil
    }
    if let made { cache[key] = made }
    return made
  }

  static func choices(size: CGFloat) -> [[String: String]] {
    let all = [("default", "Default")] + variants.map { ($0.id, $0.name) }
    return all.compactMap { id, name in
      guard let picture = image(id, size: size), let tiff = picture.tiffRepresentation,
            let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return nil }
      return ["id": id, "name": name, "preview": "data:image/png;base64,\(png.base64EncodedString())"]
    }
  }
}

// Reports whether its window is in macOS full screen (not a page's own
// fullscreen, which Chromium reports in the snapshot).
final class MerlinWindowState: ExpoView {
  let onFullScreen = EventDispatcher()
  private var observers: [NSObjectProtocol] = []

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
    guard let window else { return }
    for name in [NSWindow.didEnterFullScreenNotification, NSWindow.didExitFullScreenNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in self?.report() })
    }
    report()
  }

  private func report() {
    onFullScreen(["fullScreen": window?.styleMask.contains(.fullScreen) ?? false])
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
