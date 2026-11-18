import AppKit

// Merlin's app icons: the painted 'Wrapped' falcon-and-globe in nine colour
// themes. Daylight ("default") is the bundle's own icon; the others are PNGs
// in the app's Resources (MerlinAppIcon-<id>.png, from packages/shell/macos/
// AppIcons). Partly adapted from Ardia's AppIcons (packages/shell/ios,
// Apache License 2.0, Copyright 2026 Mantra Patel; see NOTICE). As in
// Ardia, the chosen icon is a preference: the Dock shows it
// while Merlin runs (NSApp.applicationIconImage) and, through the Dock tile
// plug-in (packages/shell/docktile), after Merlin quits. The bundle itself is
// never modified, so its signature stays intact.
//
// This file and IconStyle are also compiled into the Dock tile plug-in, so
// they use AppKit only.

enum AppIcons {
  struct Variant { let id: String; let name: String }

  /// The shell preference that stores the choice; absent or unknown means Daylight.
  static let defaultsKey = "MerlinShell.appIcon"
  /// Posted to the Dock plug-in when the choice changes.
  static func changedNotification(bundleId: String) -> Notification.Name { .init("\(bundleId).AppIconChanged") }

  /// In Settings order. "default" is the bundle's icon, Daylight.
  static let variants: [Variant] = [
    Variant(id: "default", name: "Daylight"),
    Variant(id: "midnight", name: "Midnight"),
    Variant(id: "cobalt", name: "Cobalt"),
    Variant(id: "ember", name: "Ember"),
    Variant(id: "ocean", name: "Ocean"),
    Variant(id: "aurora", name: "Aurora"),
    Variant(id: "gilt", name: "Gilt"),
    Variant(id: "forest", name: "Forest"),
    Variant(id: "blush", name: "Blush"),
  ]

  /// Ids that were renamed: "original" is Midnight since every theme uses its drawing.
  private static let renamed = ["original": "midnight"]

  /// A known id, or "default" for nil and ids from older versions.
  static func validated(_ id: String?) -> String {
    guard let id else { return "default" }
    let known = renamed[id] ?? id
    return variants.contains(where: { $0.id == known }) ? known : "default"
  }

  static var current: String { validated(UserDefaults.standard.string(forKey: defaultsKey)) }

  /// What the Dock should show for a choice, or nil for the bundle's own icon.
  /// macOS's Tinted and Clear icon styles restyle only the bundle's icon, so
  /// every choice steps aside for them. Otherwise even Daylight, which is the
  /// bundle's icon, is drawn from its picture: given nil, AppKit and the Dock
  /// show the icon macOS cached for the bundle, and that can be an older
  /// Merlin's (the bundle version is Chromium's, the same across releases).
  static func dockImage(for id: String) -> NSImage? {
    IconStyle.restylesIcons(theme: IconStyle.systemTheme) ? nil : image(id)
  }

  private static var styleWatcher: IconStyleWatcher?

  /// At launch: show the saved choice and follow icon style changes.
  static func restore() {
    if styleWatcher == nil { styleWatcher = IconStyleWatcher { apply() } }
    apply()
  }

  static func set(_ id: String) {
    let id = validated(id)
    // Stored even for Daylight, so the Dock plug-in can tell "Daylight" from
    // "couldn't read Merlin's preferences".
    UserDefaults.standard.set(id, forKey: defaultsKey)
    apply()
    if let bundleId = Bundle.main.bundleIdentifier {
      DistributedNotificationCenter.default().postNotificationName(
        changedNotification(bundleId: bundleId), object: nil, userInfo: ["icon": id], deliverImmediately: true)
    }
  }

  private static func apply() {
    NSApp.applicationIconImage = dockImage(for: current)
  }

  // MARK: Artwork

  /// Where the PNGs are: this app, or the app a Dock plug-in belongs to.
  static var resources: Bundle = .main {
    didSet { cache.removeAll() }
  }

  private static var cache: [String: NSImage] = [:]

  static func fileName(_ id: String) -> String { "MerlinAppIcon-\(id == "default" ? "daylight" : id)" }

  /// The icon on Apple's 1024 grid (transparent margin and shadow included).
  static func image(_ id: String) -> NSImage? {
    if let hit = cache[id] { return hit }
    let made = resources.url(forResource: fileName(id), withExtension: "png").flatMap(NSImage.init(contentsOf:))
      ?? (id == "default" ? NSWorkspace.shared.icon(forFile: resources.bundlePath) : nil)
    if let made { cache[id] = made }
    return made
  }

  /// Settings' choices, each with a PNG preview drawn at twice `size`.
  static func choices(size: CGFloat) -> [[String: String]] {
    variants.compactMap { variant in
      guard let picture = image(variant.id), let preview = pngDataURL(picture, size: size) else { return nil }
      return ["id": variant.id, "name": variant.name, "preview": preview]
    }
  }

  private static func pngDataURL(_ image: NSImage, size: CGFloat) -> String? {
    let pixels = Int(size * 2)
    guard pixels > 0, let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8,
                                                  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                                  bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    rep.size = NSSize(width: size, height: size)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
    return "data:image/png;base64,\(png.base64EncodedString())"
  }
}

/// macOS 26's icon style (System Settings › Appearance › Icon & widget style).
enum IconStyle {
  static let defaultsKey = "AppleIconAppearanceTheme"

  static func restylesIcons(theme: String?) -> Bool {
    guard let theme else { return false }
    return theme.hasPrefix("Tinted") || theme.hasPrefix("Clear")
  }

  static var systemTheme: String? { UserDefaults.standard.string(forKey: defaultsKey) }
}

/// Calls back when the icon style changes.
final class IconStyleWatcher: NSObject {
  private let defaults: UserDefaults
  private let onChange: () -> Void

  init(_ defaults: UserDefaults = .standard, onChange: @escaping () -> Void) {
    self.defaults = defaults
    self.onChange = onChange
    super.init()
    defaults.addObserver(self, forKeyPath: IconStyle.defaultsKey, options: [], context: nil)
  }

  deinit {
    defaults.removeObserver(self, forKeyPath: IconStyle.defaultsKey)
  }

  override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey: Any]?,
                             context: UnsafeMutableRawPointer?) {
    DispatchQueue.main.async { [weak self] in self?.onChange() }
  }
}
