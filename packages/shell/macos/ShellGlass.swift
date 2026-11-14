import AppKit
import ExpoModulesCore
import SwiftUI

// macOS Liquid Glass for the shell's controls and popovers, with the older
// vibrancy where it is missing. Adapted from Ardia's GlassEffect,
// LiquidGlass and PopoverBubble (packages/shell/ios, Apache License 2.0,
// Copyright 2026 Mantra Patel; see NOTICE).
//
// Liquid Glass is AppKit's NSGlassEffectView and SwiftUI's glassEffect,
// both macOS 26 and later. Each draws the lensing, specular edge and its own
// shadow, so glass surfaces get no extra edge or layer shadow.
enum LiquidGlass {
  static let available: Bool = {
    guard #available(macOS 26.0, *) else { return false }
    return NSClassFromString("NSGlassEffectView") != nil
  }()

  @available(macOS 26.0, *)
  static func apply(_ glass: NSGlassEffectView, cornerRadius: Double, tint: NSColor?, clear: Bool) {
    if glass.responds(to: #selector(setter: NSGlassEffectView.cornerRadius)) { glass.cornerRadius = cornerRadius }
    if glass.responds(to: #selector(setter: NSGlassEffectView.tintColor)) { glass.tintColor = tint }
    if glass.responds(to: #selector(setter: NSGlassEffectView.style)) { glass.style = clear ? .clear : .regular }
  }
}

// A glass plate behind a control (a button, a field, a pinned tile). It never
// takes a click; the control is drawn over it as a sibling.
final class MerlinGlass: ExpoView {
  private let effect: NSView
  private let tintLayer = CALayer()
  var radius: Double = 0 { didSet { apply() } }
  var tint: NSColor? { didSet { apply() } }
  var clear = false { didSet { apply() } }

  required init(appContext: AppContext? = nil) {
    if #available(macOS 26.0, *), LiquidGlass.available {
      effect = NSGlassEffectView()
    } else {
      let material = NSVisualEffectView()
      material.material = .popover
      material.blendingMode = .withinWindow
      material.state = .active
      material.wantsLayer = true
      tintLayer.actions = ["backgroundColor": NSNull(), "bounds": NSNull(), "position": NSNull()]
      material.layer?.addSublayer(tintLayer)
      effect = material
    }
    super.init(appContext: appContext)
    addSubview(effect)
    apply()
  }

  private func apply() {
    if #available(macOS 26.0, *), let glass = effect as? NSGlassEffectView {
      LiquidGlass.apply(glass, cornerRadius: radius, tint: tint, clear: clear)
      return
    }
    effect.layer?.cornerRadius = radius
    effect.layer?.cornerCurve = .continuous
    effect.layer?.masksToBounds = radius > 0
    tintLayer.frame = effect.bounds
    tintLayer.backgroundColor = tint?.cgColor
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    effect.frame = bounds
    if tintLayer.superlayer != nil { tintLayer.frame = effect.bounds }
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

// A popover's surface: a rounded panel, with an arrow pointing at its control
// when it has one. As glass it is one SwiftUI glass shape in that outline. As
// a solid panel it is an opaque fill with a hairline edge and a layer shadow
// cut out under the fill. Its content is drawn over it by React.
final class MerlinPopoverBubble: ExpoView {
  enum Edge: String { case top, bottom, none }

  private let overlay = BubbleOverlay()
  private let shadowLayer = CALayer()
  private let shadowMask = CAShapeLayer()
  private let fillLayer = CAShapeLayer()
  private let edgeLayer = CAShapeLayer()
  private let edgeMask = CAShapeLayer()
  private var glassHost: NSView?
  private var glassKey = ""

  var cornerRadius: Double = 12 { didSet { needsLayout = true } }
  var arrowEdge: Edge = .none { didSet { needsLayout = true } }
  var arrowX: Double = 0 { didSet { needsLayout = true } }
  var arrowWidth: Double = 20 { didSet { needsLayout = true } }
  var arrowHeight: Double = 9 { didSet { needsLayout = true } }
  var fill: NSColor? { didSet { needsLayout = true } }
  var edgeColor: NSColor? { didSet { needsLayout = true } }
  var edgeWidth: Double = 0 { didSet { needsLayout = true } }
  var dropColor: NSColor? { didSet { needsLayout = true } }
  var dropOpacity: Double = 0 { didSet { needsLayout = true } }
  var dropRadius: Double = 0 { didSet { needsLayout = true } }
  var dropOffsetY: Double = 0 { didSet { needsLayout = true } }
  var glass = false { didSet { needsLayout = true } }
  var clearGlass = false { didSet { needsLayout = true } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    overlay.wantsLayer = true
    overlay.layer?.masksToBounds = false
    shadowMask.fillRule = .evenOdd
    shadowLayer.mask = shadowMask
    edgeLayer.fillColor = nil
    edgeLayer.mask = edgeMask
    overlay.layer?.addSublayer(shadowLayer)
    overlay.layer?.addSublayer(fillLayer)
    overlay.layer?.addSublayer(edgeLayer)
    addSubview(overlay)
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    apply()
  }

  override func layout() {
    super.layout()
    apply()
  }

  // The outline in flipped (top-down) coordinates. The arrow rises from the
  // top edge, or hangs from the bottom one, with rounded tips and shoulders.
  static func shape(size: CGSize, radius: CGFloat, edge: Edge, arrowX: CGFloat, arrowWidth: CGFloat, arrowHeight: CGFloat) -> CGPath {
    let lift = edge == .none ? 0 : min(arrowHeight, size.height)
    let body = CGRect(x: 0, y: lift, width: size.width, height: size.height - lift)
    let r = max(0, min(radius, body.width / 2, body.height / 2))
    let half = arrowWidth / 2
    guard edge != .none, half > 0, body.width >= 2 * (r + half) else {
      return CGPath(roundedRect: body, cornerWidth: r, cornerHeight: r, transform: nil)
    }
    let x = min(max(arrowX, r + half), body.width - r - half)
    let top = body.minY
    let path = CGMutablePath()
    path.move(to: CGPoint(x: r, y: top))
    path.addArc(tangent1End: CGPoint(x: x - half, y: top), tangent2End: CGPoint(x: x, y: 0), radius: 3)
    path.addArc(tangent1End: CGPoint(x: x, y: 0), tangent2End: CGPoint(x: x + half, y: top), radius: 2.5)
    path.addArc(tangent1End: CGPoint(x: x + half, y: top), tangent2End: CGPoint(x: body.maxX - r, y: top), radius: 3)
    path.addArc(tangent1End: CGPoint(x: body.maxX, y: top), tangent2End: CGPoint(x: body.maxX, y: body.maxY), radius: r)
    path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.maxY), tangent2End: CGPoint(x: body.minX, y: body.maxY), radius: r)
    path.addArc(tangent1End: CGPoint(x: body.minX, y: body.maxY), tangent2End: CGPoint(x: body.minX, y: top), radius: r)
    path.addArc(tangent1End: CGPoint(x: body.minX, y: top), tangent2End: CGPoint(x: r, y: top), radius: r)
    path.closeSubpath()
    if edge == .top { return path }
    var flip = CGAffineTransform(translationX: 0, y: size.height).scaledBy(x: 1, y: -1)
    return path.copy(using: &flip) ?? path
  }

  private var drawsGlass: Bool { glass && LiquidGlass.available }

  private func applyGlass(path: CGPath, key: String) {
    guard #available(macOS 26.0, *), drawsGlass else {
      glassHost?.removeFromSuperview()
      glassHost = nil
      glassKey = ""
      return
    }
    let next = "\(key) \(fill?.description ?? "") \(clearGlass)"
    let view = BubbleGlass(outline: BubbleOutline(outline: Path(path)), tint: fill.map { Color(nsColor: $0) }, clear: clearGlass)
    if let host = glassHost as? NSHostingView<BubbleGlass> {
      if next != glassKey { host.rootView = view }
    } else {
      let host = NSHostingView(rootView: view)
      host.sizingOptions = []
      addSubview(host, positioned: .below, relativeTo: overlay)
      glassHost = host
    }
    glassKey = next
    glassHost?.frame = bounds
  }

  private func apply() {
    let size = bounds.size
    overlay.frame = bounds
    guard size.width > 0, size.height > 0 else { return }
    let path = Self.shape(size: size, radius: cornerRadius, edge: arrowEdge, arrowX: arrowX, arrowWidth: arrowWidth, arrowHeight: arrowHeight)
    let key = "\(size.width)x\(size.height) \(cornerRadius) \(arrowEdge.rawValue) \(arrowX) \(arrowWidth) \(arrowHeight)"
    applyGlass(path: path, key: key)
    let glassy = drawsGlass

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let local = overlay.bounds
    fillLayer.frame = local
    fillLayer.path = path
    fillLayer.fillColor = glassy ? nil : fill?.cgColor

    edgeLayer.frame = local
    edgeMask.frame = local
    edgeMask.path = path
    edgeLayer.path = path
    // Stroked at twice the width and masked to the outline: the edge sits inside it.
    edgeLayer.lineWidth = edgeWidth * 2
    edgeLayer.strokeColor = edgeColor?.cgColor
    edgeLayer.isHidden = glassy || edgeColor == nil || edgeWidth <= 0

    shadowLayer.frame = local
    if let dropColor, dropOpacity > 0, !glassy {
      shadowLayer.isHidden = false
      shadowLayer.shadowColor = dropColor.cgColor
      shadowLayer.shadowOpacity = Float(dropOpacity)
      shadowLayer.shadowRadius = dropRadius
      let flipped = overlay.layer?.isGeometryFlipped == true || overlay.isFlipped
      shadowLayer.shadowOffset = CGSize(width: 0, height: flipped ? dropOffsetY : -dropOffsetY)
      shadowLayer.shadowPath = path
      // The shadow is cut out under the panel, so a fill never shows it through.
      let reach = dropRadius * 3 + abs(dropOffsetY) + 4
      let mask = CGMutablePath()
      mask.addRect(local.insetBy(dx: -reach, dy: -reach))
      mask.addPath(path)
      shadowMask.frame = local
      shadowMask.path = mask
    } else {
      shadowLayer.isHidden = true
    }
    CATransaction.commit()
  }
}

private final class BubbleOverlay: NSView {
  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

@available(macOS 26.0, *)
private struct BubbleGlass: View {
  let outline: BubbleOutline
  let tint: Color?
  let clear: Bool

  var body: some View {
    Color.clear
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .glassEffect((clear ? Glass.clear : Glass.regular).tint(tint), in: outline)
  }
}

private struct BubbleOutline: Shape {
  let outline: Path
  func path(in rect: CGRect) -> Path { outline }
}
