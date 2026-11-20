import AppKit
import ExpoModulesCore

// Fades its content out over the last `fadeLength` points of its width, so a
// tab title that does not fit dissolves instead of ending in an ellipsis.
final class MerlinFade: ExpoView {
  var length: CGFloat = 18 { didSet { needsLayout = true } }
  /** A fade at the leading edge too (a scrolled strip of tabs); 0 for none. */
  var leading: CGFloat = 0 { didSet { needsLayout = true } }
  /**
   * A scroll view inside sits in the title bar (the tabs across the top):
   * AppKit would inset it by the title bar's height, leaving the top of each
   * tab dead to clicks, so it is kept flush.
   */
  var flushScroll = false { didSet { needsLayout = true } }
  private let gradient = CAGradientLayer()

  // React Native clears a view's layer mask whenever it redraws the view (its
  // corner clipping), which took the fade away and let the text run on past
  // the view, under the tab's close button. This layer keeps the fade.
  private final class FadeLayer: CALayer {
    var fade: CALayer?
    override var mask: CALayer? {
      get { super.mask }
      set { super.mask = fade ?? newValue }
    }
    override init() { super.init() }
    override init(layer: Any) { super.init(layer: layer) }
    required init?(coder: NSCoder) { super.init(coder: coder) }
  }

  override func makeBackingLayer() -> CALayer { FadeLayer() }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    gradient.colors = [NSColor.clear.cgColor, NSColor.black.cgColor, NSColor.black.cgColor, NSColor.clear.cgColor]
    gradient.startPoint = CGPoint(x: 0, y: 0.5)
    gradient.endPoint = CGPoint(x: 1, y: 0.5)
  }

  override func layout() { super.layout(); update(); if flushScroll { flatten(self) } }
  override func didAddSubview(_ subview: NSView) { super.didAddSubview(subview); if flushScroll { flatten(self) } }

  private func flatten(_ view: NSView) {
    for sub in view.subviews {
      if let scroll = sub as? NSScrollView {
        if scroll.automaticallyAdjustsContentInsets {
          scroll.automaticallyAdjustsContentInsets = false
          scroll.contentInsets = NSEdgeInsetsZero
        }
      } else {
        flatten(sub)
      }
    }
  }
  override func setFrameSize(_ size: NSSize) { super.setFrameSize(size); update() }

  private func update() {
    guard let layer, bounds.width > 0 else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    gradient.frame = bounds
    let end = max(0, 1 - length / bounds.width)
    let start = min(end, leading / bounds.width)
    // With no leading fade the first stop is opaque, so nothing fades there.
    gradient.colors = [(leading > 0 ? NSColor.clear : NSColor.black).cgColor, NSColor.black.cgColor,
                       NSColor.black.cgColor, (length > 0 ? NSColor.clear : NSColor.black).cgColor]
    gradient.locations = [0, NSNumber(value: Double(start)), NSNumber(value: Double(end)), 1]
    (layer as? FadeLayer)?.fade = gradient
    if layer.mask !== gradient { layer.mask = gradient }
    CATransaction.commit()
  }
}
