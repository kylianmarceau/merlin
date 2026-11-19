import AppKit

// Merlin's own commands in the menu bar's View menu, as in Dia: where the tabs
// go, hiding them, split view and the address bar's place. Chromium owns the
// menu bar and knows nothing of the shell's layout, so these items only ask
// the shell (onMenuCommand), and the front window's shell answers. Their
// checkmarks follow the state the front window last reported (setMenuState).
final class MerlinMenus: NSObject, NSMenuItemValidation {
  static let shared = MerlinMenus()
  var onCommand: ((String) -> Void)?
  var state: [String: Bool] = [:]
  private static let marker = "merlin.view"
  private var observer: NSObjectProtocol?

  private let items: [(id: String, title: String)] = [
    ("tabs.side", "Show Tabs in Sidebar"),
    ("tabs.top", "Show Tabs on Top"),
    ("tabs.hide", "Hide Tabs"),
    ("-", ""),
    ("split", "Open Split View"),
    ("address.toolbar", "Show Address in Toolbar"),
  ]

  func install() {
    if observer == nil {
      // Chromium may rebuild its View menu; put the items back when a menu opens.
      observer = NotificationCenter.default.addObserver(forName: NSMenu.didBeginTrackingNotification, object: nil, queue: .main) {
        [weak self] _ in self?.install()
      }
    }
    guard let view = Self.viewMenu() else { return }
    if view.items.contains(where: { ($0.representedObject as? String)?.hasPrefix(Self.marker) == true }) { refresh(view); return }
    var index = 0
    for (id, title) in items {
      let item: NSMenuItem
      if id == "-" {
        item = .separator()
      } else {
        item = NSMenuItem(title: title, action: #selector(choose(_:)), keyEquivalent: "")
        item.target = self
      }
      item.representedObject = "\(Self.marker).\(id)"
      view.insertItem(item, at: index)
      index += 1
    }
    view.insertItem(.separator(), at: index)
    refresh(view)
  }

  private func refresh(_ menu: NSMenu) {
    for item in menu.items {
      guard let tag = item.representedObject as? String, tag.hasPrefix(Self.marker + ".") else { continue }
      let id = String(tag.dropFirst(Self.marker.count + 1))
      switch id {
      case "tabs.side": item.state = state["top"] == true ? .off : .on
      case "tabs.top": item.state = state["top"] == true ? .on : .off
      case "tabs.hide": item.title = state["hidden"] == true ? "Show Tabs" : "Hide Tabs"
      case "split": item.title = state["split"] == true ? "Separate Split View" : "Open Split View"
      case "address.toolbar": item.state = state["addressInToolbar"] == true ? .on : .off
      default: break
      }
    }
  }

  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    guard let tag = item.representedObject as? String else { return true }
    if let menu = item.menu { refresh(menu) }
    switch tag {
    case "\(Self.marker).split": return state["canSplit"] == true || state["split"] == true
    case "\(Self.marker).address.toolbar": return state["top"] != true
    default: return state["window"] == true
    }
  }

  @objc private func choose(_ item: NSMenuItem) {
    guard let tag = item.representedObject as? String else { return }
    onCommand?(String(tag.dropFirst(Self.marker.count + 1)))
  }

  private static func viewMenu() -> NSMenu? {
    // Chromium's View menu holds its Stop and Reload items (IDC_STOP, IDC_RELOAD).
    NSApp.mainMenu?.items.compactMap(\.submenu).first { $0.items.contains { $0.tag == 33006 || $0.tag == 33002 } }
  }
}

// Whether an icon is all one dark (or one light) colour, judged from its
// opaque pixels, so a black GitHub mark can be drawn light on a dark shell.
enum IconTone {
  private static var cache: [Int: String] = [:]

  static func tone(dataURL: String) -> String? {
    let key = dataURL.hashValue
    if let hit = cache[key] { return hit }
    guard let comma = dataURL.firstIndex(of: ","), let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
          let image = NSBitmapImageRep(data: data)?.cgImage else { return nil }
    let side = 16
    var pixels = [UInt8](repeating: 0, count: side * side * 4)
    guard let context = CGContext(data: &pixels, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
    var count = 0, dark = 0, light = 0, coloured = 0
    for i in stride(from: 0, to: pixels.count, by: 4) {
      let a = Double(pixels[i + 3]) / 255
      guard a > 0.5 else { continue }
      let r = Double(pixels[i]) / 255 / a, g = Double(pixels[i + 1]) / 255 / a, b = Double(pixels[i + 2]) / 255 / a
      let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      let chroma = max(r, g, b) - min(r, g, b)
      count += 1
      if chroma > 0.2 { coloured += 1 } else if luma < 0.25 { dark += 1 } else if luma > 0.85 { light += 1 }
    }
    guard count > 0 else { return nil }
    let share = { (n: Int) in Double(n) / Double(count) }
    let tone = share(coloured) > 0.1 ? "colour" : share(dark) > 0.8 ? "dark" : share(light) > 0.8 ? "light" : "mixed"
    cache[key] = tone
    return tone
  }
}
