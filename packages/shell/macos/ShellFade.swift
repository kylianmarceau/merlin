import AppKit
import ExpoModulesCore

// Fades its content out over the last `fadeLength` points of its width, so a
// tab title that does not fit dissolves instead of ending in an ellipsis.
final class MerlinFade: ExpoView {
  var length: CGFloat = 18 { didSet { needsLayout = true } }
  private let gradient = CAGradientLayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    gradient.colors = [NSColor.black.cgColor, NSColor.black.cgColor, NSColor.clear.cgColor]
    gradient.startPoint = CGPoint(x: 0, y: 0.5)
    gradient.endPoint = CGPoint(x: 1, y: 0.5)
  }

  override func layout() { super.layout(); update() }
  override func setFrameSize(_ size: NSSize) { super.setFrameSize(size); update() }

  private func update() {
    guard let layer, bounds.width > 0 else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    gradient.frame = bounds
    let start = max(0, 1 - length / bounds.width)
    gradient.locations = [0, NSNumber(value: Double(start)), 1]
    if layer.mask !== gradient { layer.mask = gradient }
    CATransaction.commit()
  }
}
