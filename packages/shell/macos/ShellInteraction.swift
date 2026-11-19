import AppKit
import ExpoModulesCore

// Every mouse press in the app passes through one local monitor before
// AppKit, Chromium or React Native sees it. The monitor never consumes a
// press for outside-press areas; a drag region consumes presses it handles.
enum PressWatch {
  private static let regions = NSHashTable<MerlinWindowDragRegion>.weakObjects()
  private static let areas = NSHashTable<MerlinOutsidePress>.weakObjects()
  // Areas in the order they joined their window, newest last: Escape closes the newest.
  private static var stack: [Weak] = []
  private static var monitor: Any?
  private static var keyMonitor: Any?
  private struct Weak { weak var area: MerlinOutsidePress? }

  static func add(_ region: MerlinWindowDragRegion) { install(); regions.add(region) }
  static func remove(_ region: MerlinWindowDragRegion) { regions.remove(region) }
  static func add(_ area: MerlinOutsidePress) {
    install(); areas.add(area)
    stack.removeAll { $0.area == nil || $0.area === area }
    stack.append(Weak(area: area))
  }
  static func remove(_ area: MerlinOutsidePress) { areas.remove(area); stack.removeAll { $0.area == nil || $0.area === area } }

  private static func install() {
    guard monitor == nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { event in
      // Areas hear about every press first, including ones that start a drag.
      for area in areas.allObjects { area.pressed(event) }
      guard event.type == .leftMouseDown else { return event }
      for region in regions.allObjects where region.handles(event) {
        region.drag(event)
        return nil
      }
      return event
    }
    // Escape closes the newest popover that asks for it in the window it was
    // typed in, wherever the focus is, including the web page, and goes no
    // further: the page never sees the Escape that closed a popover.
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
      guard event.keyCode == 53, event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .function]).isEmpty
      else { return event }
      for entry in stack.reversed() {
        guard let area = entry.area, area.closesOnEscape, area.window != nil,
              area.window === (event.window ?? NSApp.keyWindow), !area.isHiddenOrHasHiddenAncestor else { continue }
        area.onOutsidePress(["reason": "escape"])
        return nil
      }
      return event
    }
  }

  // The deepest view under a press, as AppKit would deliver it.
  static func hit(_ event: NSEvent) -> NSView? {
    event.window?.contentView?.superview?.hitTest(event.locationInWindow)
  }
}

// Moves the window when its empty space is dragged and zooms it on a double
// click, like a native title bar. Controls drawn over it keep their clicks.
final class MerlinWindowDragRegion: ExpoView {
  override var mouseDownCanMoveWindow: Bool {
    get { true }
    set {}
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { PressWatch.add(self) } else { PressWatch.remove(self) }
  }

  func handles(_ event: NSEvent) -> Bool {
    guard let window, event.window === window, !isHiddenOrHasHiddenAncestor,
          !event.modifierFlags.contains(.control) else { return false }
    // Only presses on the region itself, not on a control inside it.
    return PressWatch.hit(event) === self
  }

  func drag(_ event: NSEvent) {
    guard let window else { return }
    if event.clickCount == 2 {
      Self.titleBarDoubleClick(window)
    } else {
      window.performDrag(with: event)
    }
  }

  // Follows System Settings > Desktop & Dock > "Double-click a window's title bar to".
  static func titleBarDoubleClick(_ window: NSWindow) {
    switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
    case "Minimize": window.performMiniaturize(nil)
    case "None": break
    default: window.performZoom(nil)
    }
  }
}

// Reports presses outside its subtree in the same window, including presses
// on web pages, and the window losing focus. It never stops the press, so a
// click outside a popover both closes it and does what it was aimed at.
final class MerlinOutsidePress: ExpoView {
  let onOutsidePress = EventDispatcher()
  // Escape anywhere in the window reports {reason: "escape"} to the newest such area.
  var closesOnEscape = false
  private var resign: NSObjectProtocol?

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if let resign { NotificationCenter.default.removeObserver(resign) }
    resign = nil
    guard let window else { PressWatch.remove(self); return }
    PressWatch.add(self)
    resign = NotificationCenter.default.addObserver(forName: NSWindow.didResignKeyNotification, object: window, queue: .main) {
      [weak self] _ in
      // A menu or sheet attached to this window does not count as leaving it.
      guard let self, let window = self.window, window.attachedSheet == nil,
            NSApp.keyWindow?.sheetParent !== window else { return }
      self.onOutsidePress(["reason": "blur"])
    }
  }

  deinit {
    if let resign { NotificationCenter.default.removeObserver(resign) }
  }

  func pressed(_ event: NSEvent) {
    guard let window, event.window === window, !isHiddenOrHasHiddenAncestor else { return }
    if let hit = PressWatch.hit(event), hit.isDescendant(of: self) { return }
    onOutsidePress(["reason": "press"])
  }
}

// Turns a right click or Control-click anywhere inside it into one event, so
// the shell can show a native menu for what was clicked.
final class MerlinContextMenuArea: ExpoView {
  let onContextMenu = EventDispatcher()

  private static func secondary(_ event: NSEvent?) -> Bool {
    guard let event else { return false }
    return event.type == .rightMouseDown || (event.type == .leftMouseDown && event.modifierFlags.contains(.control))
  }
  override func hitTest(_ point: NSPoint) -> NSView? {
    let hit = super.hitTest(point)
    return hit != nil && Self.secondary(NSApp.currentEvent) ? self : hit
  }
  override func rightMouseDown(with event: NSEvent) { onContextMenu([:]) }
  override func mouseDown(with event: NSEvent) {
    if Self.secondary(event) { onContextMenu([:]) } else { super.mouseDown(with: event) }
  }
  override func menu(for event: NSEvent) -> NSMenu? { nil }
}

// Native menus. Items: {id, title, enabled?, checked?, destructive?,
// separator?, symbol?, children?}. Resolves with the chosen id, or nil.
final class MenuChoice: NSObject {
  var chosen: String?
  @objc func choose(_ item: NSMenuItem) { chosen = item.representedObject as? String }

  func menu(_ items: [[String: Any]]) -> NSMenu {
    let menu = NSMenu()
    menu.autoenablesItems = false
    for item in items {
      if item["separator"] as? Bool == true {
        menu.addItem(.separator())
        continue
      }
      guard let title = item["title"] as? String else { continue }
      let entry = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      entry.isEnabled = item["enabled"] as? Bool ?? true
      entry.state = item["checked"] as? Bool == true ? .on : .off
      if let symbol = item["symbol"] as? String {
        entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
      }
      if item["destructive"] as? Bool == true {
        entry.attributedTitle = NSAttributedString(string: title, attributes: [.foregroundColor: NSColor.systemRed])
      }
      if let children = item["children"] as? [[String: Any]] {
        entry.submenu = self.menu(children)
      } else if let id = item["id"] as? String {
        entry.representedObject = id
        entry.target = self
        entry.action = #selector(choose(_:))
      }
      menu.addItem(entry)
    }
    return menu
  }
}
