import AppKit
import ExpoModulesCore

// Two-finger swipes left and right across an area of the shell, the way Zen
// and Arc move between spaces over the sidebar. One local monitor sees every
// scroll-wheel event before the views under the pointer do: a trackpad
// gesture that starts mostly sideways over an area belongs to that area from
// then on, and goes no further, so the list under it doesn't scroll as well.
// Vertical gestures, mouse wheels and momentum pass through untouched.
enum SwipeWatch {
  private static let areas = NSHashTable<MerlinSwipeArea>.weakObjects()
  private static var monitor: Any?
  // The gesture being followed: undecided, sideways in an area, or not ours.
  private enum Tracking { case none, deciding(MerlinSwipeArea, CGFloat, CGFloat), swiping(MerlinSwipeArea), ignored }
  private static var tracking = Tracking.none

  static func add(_ area: MerlinSwipeArea) { install(); areas.add(area) }
  static func remove(_ area: MerlinSwipeArea) { areas.remove(area) }

  // How far fingers move before the gesture counts as sideways or not.
  private static let decideDistance: CGFloat = 6

  private static func install() {
    guard monitor == nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { event in
      handle(event) ? nil : event
    }
  }

  // The finger's movement, whichever way scrolling is set to go.
  private static func fingerDelta(_ event: NSEvent) -> (CGFloat, CGFloat) {
    let sign: CGFloat = event.isDirectionInvertedFromDevice ? 1 : -1
    return (event.scrollingDeltaX * sign, event.scrollingDeltaY * sign)
  }

  private static func area(at event: NSEvent) -> MerlinSwipeArea? {
    guard let window = event.window else { return nil }
    for area in areas.allObjects where area.window === window && area.enabled && !area.isHiddenOrHasHiddenAncestor {
      let point = area.convert(event.locationInWindow, from: nil)
      if area.bounds.contains(point) { return area }
    }
    return nil
  }

  // True when the event was a swipe's and is used up.
  private static func handle(_ event: NSEvent) -> Bool {
    // Momentum after a swipe let go belongs to the swipe too.
    if !event.momentumPhase.isEmpty {
      if case .swiping = tracking { return true }
      return false
    }
    guard event.hasPreciseScrollingDeltas, !event.phase.isEmpty else { return false }
    if event.phase.contains(.mayBegin) { return false }
    let (dx, dy) = fingerDelta(event)
    if event.phase.contains(.began) {
      tracking = .none
      if let area = area(at: event) { tracking = .deciding(area, dx, dy) } else { tracking = .ignored }
      return false
    }
    switch tracking {
    case .none, .ignored:
      if event.phase.contains(.ended) || event.phase.contains(.cancelled) { tracking = .none }
      return false
    case .deciding(let area, let x, let y):
      let total = (x + dx, y + dy)
      if event.phase.contains(.ended) || event.phase.contains(.cancelled) { tracking = .none; return false }
      if abs(total.0) + abs(total.1) < decideDistance {
        tracking = .deciding(area, total.0, total.1)
        return false
      }
      guard abs(total.0) > abs(total.1) * 1.2 else { tracking = .ignored; return false }
      tracking = .swiping(area)
      area.begin(total.0)
      return true
    case .swiping(let area):
      if event.phase.contains(.ended) || event.phase.contains(.cancelled) {
        tracking = .none
        area.end(cancelled: event.phase.contains(.cancelled))
      } else {
        area.move(dx)
      }
      return true
    }
  }
}

// An area that reports sideways two-finger swipes over it: onSwipe with
// phase "begin", "move" or "end" ("cancel" if the system cancelled it), how
// far the fingers have moved in points (`dx`, right is positive) and, at the
// end, their speed in points per second (`velocity`). Its children keep
// their clicks and vertical scrolling.
final class MerlinSwipeArea: ExpoView {
  let onSwipe = EventDispatcher()
  var enabled = true
  private var distance: CGFloat = 0
  // Recent movement, for the speed at the end.
  private var samples: [(time: TimeInterval, dx: CGFloat)] = []

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { SwipeWatch.add(self) } else { SwipeWatch.remove(self) }
  }

  func begin(_ dx: CGFloat) {
    distance = dx
    samples = [(ProcessInfo.processInfo.systemUptime, dx)]
    onSwipe(["phase": "begin", "dx": distance, "velocity": 0])
  }

  func move(_ dx: CGFloat) {
    distance += dx
    let now = ProcessInfo.processInfo.systemUptime
    samples.append((now, dx))
    samples.removeAll { now - $0.time > 0.1 }
    onSwipe(["phase": "move", "dx": distance, "velocity": 0])
  }

  func end(cancelled: Bool) {
    let now = ProcessInfo.processInfo.systemUptime
    let recent = samples.filter { now - $0.time <= 0.1 }
    let span = max(0.016, now - (recent.first?.time ?? now))
    let velocity = recent.reduce(0) { $0 + $1.dx } / span
    onSwipe(["phase": cancelled ? "cancel" : "end", "dx": distance, "velocity": velocity])
    samples = []
    distance = 0
  }
}
