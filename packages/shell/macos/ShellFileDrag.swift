import AppKit
import ExpoModulesCore

// Lets a file be dragged out of the shell, as from Finder: a downloaded file
// to the desktop, Mail or a page's upload field. Clicks inside still reach
// React; once the pointer moves a few points with the button down, the press
// becomes an AppKit drag of the file and React's touch is cancelled, so the
// row's own press (open the file) never fires.
final class MerlinFileDrag: ExpoView, NSDraggingSource {
  var path = ""
  let onDragEnd = EventDispatcher()

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { FileDragWatch.add(self) } else { FileDragWatch.remove(self) }
  }

  var url: URL? {
    guard !path.isEmpty, FileManager.default.fileExists(atPath: path) else { return nil }
    return URL(fileURLWithPath: path)
  }

  func contains(_ event: NSEvent) -> Bool {
    guard let window, event.window === window, !isHiddenOrHasHiddenAncestor,
          let hit = PressWatch.hit(event) else { return false }
    return hit.isDescendant(of: self)
  }

  func beginDrag(_ url: URL, from press: NSEvent, with event: NSEvent) {
    FileDragWatch.cancelReactTouches(in: self)
    let item = NSDraggingItem(pasteboardWriter: url as NSURL)
    let side: CGFloat = 32
    let icon = NSWorkspace.shared.icon(forFile: url.path)
    icon.size = NSSize(width: side, height: side)
    let at = convert(event.locationInWindow, from: nil)
    item.setDraggingFrame(NSRect(x: at.x - side / 2, y: at.y - side / 2, width: side, height: side), contents: icon)
    let session = beginDraggingSession(with: [item], event: press, source: self)
    session.animatesToStartingPositionsOnCancelOrFail = true
    session.draggingFormation = .none
  }

  func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
    // Copy, as from a browser's downloads: the file stays in Downloads.
    [.copy, .link, .generic]
  }

  func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
    onDragEnd(["dropped": operation != []])
  }
}

enum FileDragWatch {
  private static let areas = NSHashTable<MerlinFileDrag>.weakObjects()
  private static var monitor: Any?
  private static var press: (area: MerlinFileDrag, event: NSEvent)?
  /** How far the pointer moves before a press becomes a drag, as in Finder. */
  private static let threshold: CGFloat = 4

  static func add(_ area: MerlinFileDrag) { install(); areas.add(area) }
  static func remove(_ area: MerlinFileDrag) { areas.remove(area) }

  private static func install() {
    guard monitor == nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]) { event in
      switch event.type {
      case .leftMouseDown:
        press = nil
        // The innermost area under the press, if it has a file to give.
        let hits = areas.allObjects.filter { $0.contains(event) && $0.url != nil }
        if let area = hits.first(where: { candidate in !hits.contains { $0 !== candidate && $0.isDescendant(of: candidate) } }) {
          press = (area, event)
        }
        return event
      case .leftMouseDragged:
        guard let (area, start) = press, start.window === event.window else { return event }
        let dx = event.locationInWindow.x - start.locationInWindow.x
        let dy = event.locationInWindow.y - start.locationInWindow.y
        guard hypot(dx, dy) >= threshold else { return event }
        press = nil
        guard let url = area.url else { return event }
        area.beginDrag(url, from: start, with: event)
        return nil
      default:
        press = nil
        return event
      }
    }
  }

  // React Native's touch handler is a gesture recognizer on the root view.
  // Turning a recognizer off and on resets it, which sends React a touch
  // cancel: the press ends without a click.
  static func cancelReactTouches(in view: NSView) {
    var current: NSView? = view
    while let v = current {
      for recognizer in v.gestureRecognizers where NSStringFromClass(type(of: recognizer)).contains("RCTTouchHandler") {
        recognizer.isEnabled = false
        recognizer.isEnabled = true
      }
      current = v.superview
    }
  }
}
