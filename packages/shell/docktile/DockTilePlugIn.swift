import AppKit

// Merlin's Dock tile plug-in, after Ardia's. The Dock loads it from
// Merlin.app/Contents/PlugIns (Info.plist NSDockTilePlugIn) for a Merlin kept
// in the Dock, and keeps it loaded when Merlin is not running. It shows the
// app icon chosen in Settings › Appearance (AppIcons.swift, compiled in), so
// the Dock keeps that icon after Merlin quits. While Merlin runs, the app sets
// its own icon and the Dock ignores this one.
//
// It reads the choice from Merlin's preferences, hears changes as Merlin
// posts them, and steps aside for macOS's Tinted and Clear icon styles.

@objc(MerlinDockTilePlugIn)
final class MerlinDockTilePlugIn: NSObject, NSDockTilePlugIn {
  private var dockTile: NSDockTile?
  private var observer: NSObjectProtocol?
  private var styleWatcher: IconStyleWatcher?
  private var saved = "default"

  /// Merlin.app: the plug-in is Merlin.app/Contents/PlugIns/MerlinDockTile.plugin.
  private lazy var app: Bundle? = {
    let url = Bundle(for: MerlinDockTilePlugIn.self).bundleURL
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    return Bundle(url: url)
  }()

  /// The Dock's own copy of the choice, in case Merlin's preferences can't be read.
  private var cacheKey: String { "\(app?.bundleIdentifier ?? "merlin").\(AppIcons.defaultsKey)" }

  func setDockTile(_ dockTile: NSDockTile?) {
    if let observer { DistributedNotificationCenter.default().removeObserver(observer) }
    observer = nil
    styleWatcher = nil
    self.dockTile = dockTile
    guard dockTile != nil, let app, let bundleId = app.bundleIdentifier else { return }

    AppIcons.resources = app
    observer = DistributedNotificationCenter.default().addObserver(
      forName: AppIcons.changedNotification(bundleId: bundleId), object: nil, queue: .main
    ) { [weak self] note in
      guard let self, let id = note.userInfo?["icon"] as? String else { return }
      self.saved = AppIcons.validated(id)
      UserDefaults.standard.set(self.saved, forKey: self.cacheKey)
      self.show()
    }
    let stored = CFPreferencesCopyAppValue(AppIcons.defaultsKey as CFString, bundleId as CFString) as? String
    saved = AppIcons.validated(stored ?? UserDefaults.standard.string(forKey: cacheKey))
    styleWatcher = IconStyleWatcher { [weak self] in self?.show() }
    show()
  }

  private func show() {
    guard let dockTile else { return }
    let id = IconStyle.shown(saved: saved, theme: IconStyle.systemTheme)
    if id == "default" {
      dockTile.contentView = nil
    } else if let image = AppIcons.image(id) {
      let view = NSImageView(frame: NSRect(origin: .zero, size: dockTile.size))
      view.image = image
      view.imageScaling = .scaleProportionallyUpOrDown
      dockTile.contentView = view
    }
    dockTile.display()
  }

  deinit {
    if let observer { DistributedNotificationCenter.default().removeObserver(observer) }
  }
}
