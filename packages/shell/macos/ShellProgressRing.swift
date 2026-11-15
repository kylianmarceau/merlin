import AppKit
import ExpoModulesCore

// A thin ring that fills clockwise from the top with a download's progress.
// A negative progress means the size is not known yet: a short arc circles
// instead. Changes ease, so the ring creeps rather than jumps between the
// browser's updates. Never takes a click.
final class MerlinProgressRing: ExpoView {
  var progress: Double = 0 { didSet { update() } }
  var color: NSColor = .controlAccentColor { didSet { update() } }
  var trackColor: NSColor = .quaternaryLabelColor { didSet { update() } }
  var lineWidth: CGFloat = 2 { didSet { needsLayout = true } }
  var reduceMotion = false { didSet { update() } }

  private let track = CAShapeLayer()
  private let fill = CAShapeLayer()
  private static let spin = "merlin.spin"

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    for shape in [track, fill] {
      shape.fillColor = nil
      shape.lineCap = .round
      layer?.addSublayer(shape)
    }
    fill.strokeEnd = 0
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  override func layout() { super.layout(); place() }
  override func setFrameSize(_ size: NSSize) { super.setFrameSize(size); place() }

  private func place() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let inset = lineWidth / 2
    let rect = bounds.insetBy(dx: inset, dy: inset)
    // Starts at the top and runs clockwise, whichever way the layer is flipped.
    let path = CGMutablePath()
    let center = CGPoint(x: rect.midX, y: rect.midY)
    let radius = max(0, min(rect.width, rect.height) / 2)
    let flipped = layer?.contentsAreFlipped() ?? isFlipped
    path.addArc(center: center, radius: radius, startAngle: flipped ? -.pi / 2 : .pi / 2,
                endAngle: flipped ? 3 * .pi / 2 : -3 * .pi / 2, clockwise: !flipped)
    for shape in [track, fill] {
      shape.frame = bounds
      shape.path = path
      shape.lineWidth = lineWidth
    }
    CATransaction.commit()
    update()
  }

  private func update() {
    track.strokeColor = trackColor.cgColor
    fill.strokeColor = color.cgColor
    let known = progress >= 0
    CATransaction.begin()
    CATransaction.setAnimationDuration(reduceMotion ? 0 : 0.35)
    CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(name: .easeOut))
    fill.strokeStart = 0
    fill.strokeEnd = known ? CGFloat(min(1, max(0.02, progress))) : 0.28
    CATransaction.commit()
    if known || reduceMotion {
      fill.removeAnimation(forKey: Self.spin)
      fill.transform = CATransform3DIdentity
    } else if fill.animation(forKey: Self.spin) == nil {
      fill.anchorPoint = CGPoint(x: 0.5, y: 0.5)
      let turn = CABasicAnimation(keyPath: "transform.rotation.z")
      let flipped = layer?.contentsAreFlipped() ?? isFlipped
      turn.fromValue = 0
      turn.toValue = flipped ? 2 * Double.pi : -2 * Double.pi
      turn.duration = 1
      turn.repeatCount = .infinity
      fill.add(turn, forKey: Self.spin)
    }
  }
}
