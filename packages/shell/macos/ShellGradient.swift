import AppKit
import ExpoModulesCore

struct MerlinGradientProfile: Record {
  @Field var stops: [Double] = []
  @Field var fade: [Double] = []
  @Field var fadeStops: [Double] = []
}

// Gradients React Native cannot draw on macOS's classic bridge.
//
// "orb": the new tab page's sphere. Colours are four stops from highlight to
// deep, then the horizon glow along its bottom and its shadow colour.
// "glow": a soft elliptical wash behind the new tab page; one colour that
// fades to nothing at the edges.
// "vertical": colour stops down the view, with a separate left-to-right fade.
final class MerlinGradient: ExpoView {
  var kind = "glow" { didSet { needsLayout = true } }
  var colors: [NSColor] = [] { didSet { needsLayout = true } }

  var profile = MerlinGradientProfile() { didSet { needsLayout = true } }

  private let drop = CALayer()
  private let body = CALayer()
  private let sphere = CAGradientLayer()
  private let stripes = CAShapeLayer()
  private let horizon = CAGradientLayer()
  private let fadeMask = CAGradientLayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  override func layout() { super.layout(); draw() }
  override func setFrameSize(_ size: NSSize) { super.setFrameSize(size); draw() }

  private func draw() {
    guard let layer, bounds.width > 0, bounds.height > 0 else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if body.superlayer !== layer {
      layer.insertSublayer(drop, at: 0)
      layer.insertSublayer(body, above: drop)
      body.addSublayer(sphere)
      body.addSublayer(stripes)
      body.addSublayer(horizon)
      sphere.type = .radial
      horizon.type = .radial
      // Fine diagonal lines that only lift the light parts, like grain.
      stripes.compositingFilter = "softLightBlendMode"
      stripes.fillColor = nil
      stripes.lineWidth = 2
      stripes.strokeColor = NSColor(white: 1, alpha: 0.16).cgColor
    }
    layer.masksToBounds = false
    // Unit points below are measured from the top left, as the page reads.
    let down = isFlipped || layer.isGeometryFlipped
    func unit(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: down ? y : 1 - y) }
    let cg = colors.map(\.cgColor)
    body.frame = bounds
    sphere.frame = bounds
    sphere.type = kind == "vertical" ? .axial : .radial
    body.mask = nil
    if kind == "vertical", cg.count >= 2 {
      body.cornerRadius = 0
      body.masksToBounds = true
      drop.isHidden = true
      horizon.isHidden = true
      stripes.isHidden = true
      sphere.colors = cg
      sphere.locations = profile.stops.count == cg.count ? profile.stops.map { NSNumber(value: $0) } : nil
      sphere.startPoint = unit(0.5, 0)
      sphere.endPoint = unit(0.5, 1)
      if profile.fade.count >= 2 && profile.fade.count == profile.fadeStops.count {
        fadeMask.frame = body.bounds
        fadeMask.colors = profile.fade.map { CGColor(gray: 0, alpha: $0) }
        fadeMask.locations = profile.fadeStops.map { NSNumber(value: $0) }
        fadeMask.startPoint = CGPoint(x: 0, y: 0.5)
        fadeMask.endPoint = CGPoint(x: 1, y: 0.5)
        body.mask = fadeMask
      }
    } else if kind == "orb", cg.count >= 4 {
      let size = min(bounds.width, bounds.height)
      body.cornerRadius = size / 2
      body.masksToBounds = true
      // Lit from the upper left: radial from 34% 28% out to the far corner.
      sphere.colors = Array(cg.prefix(4))
      sphere.locations = [0, 0.34, 0.68, 1]
      sphere.startPoint = unit(0.34, 0.28)
      sphere.endPoint = unit(0.34 + 0.98, 0.28 + 0.98)
      let path = CGMutablePath()
      let step: CGFloat = 7
      var x = -bounds.height
      while x < bounds.width + bounds.height {
        // 118° lines, as in the design.
        path.move(to: CGPoint(x: x, y: 0))
        path.addLine(to: CGPoint(x: x + bounds.height * 0.53, y: bounds.height))
        x += step
      }
      stripes.isHidden = false
      stripes.frame = bounds
      stripes.path = path
      if cg.count >= 5 {
        horizon.isHidden = false
        // An ellipse 120% wide and 62% tall whose top sits at 76% of the orb.
        let h = bounds.height * 0.62
        horizon.frame = CGRect(x: -bounds.width * 0.1, y: down ? bounds.height * 0.76 : -bounds.height * 0.38,
                               width: bounds.width * 1.2, height: h)
        let oval = CAShapeLayer()
        oval.path = CGPath(ellipseIn: CGRect(origin: .zero, size: horizon.frame.size), transform: nil)
        horizon.mask = oval
        horizon.colors = [cg[4], (colors[4].withAlphaComponent(0)).cgColor]
        // CSS "ellipse at 50% 0" fading out by 70% of its reach.
        horizon.startPoint = CGPoint(x: 0.5, y: down ? 0 : 1)
        horizon.endPoint = CGPoint(x: 0.995, y: down ? 0.99 : 0.01)
      } else {
        horizon.isHidden = true
      }
      if cg.count >= 6 {
        drop.isHidden = false
        drop.frame = bounds
        drop.shadowColor = cg[5]
        drop.shadowOpacity = 1
        drop.shadowRadius = 15
        drop.shadowOffset = CGSize(width: 0, height: down ? 18 : -18)
        drop.shadowPath = CGPath(ellipseIn: bounds.insetBy(dx: 12, dy: 12), transform: nil)
      } else {
        drop.isHidden = true
      }
    } else if let first = colors.first {
      body.cornerRadius = 0
      body.masksToBounds = false
      stripes.isHidden = true
      horizon.isHidden = true
      drop.isHidden = true
      sphere.colors = [first.cgColor, first.withAlphaComponent(0).cgColor]
      sphere.locations = [0, 1]
      sphere.startPoint = unit(0.5, 0.5)
      sphere.endPoint = unit(1, 1)
    }
    CATransaction.commit()
  }
}
