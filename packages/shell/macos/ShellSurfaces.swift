import AppKit
import ExpoModulesCore

// Background-only vibrancy. It sits behind its siblings and never takes a
// click, so whatever is drawn over it stays interactive.
final class MerlinVisualEffect: ExpoView {
  private let effect = NSVisualEffectView()
  var radius: Double = 0 { didSet { applyShape() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    effect.state = .followsWindowActiveState
    effect.blendingMode = .behindWindow
    effect.material = .sidebar
    effect.wantsLayer = true
    addSubview(effect)
  }

  func setMaterial(_ name: String) {
    let materials: [String: NSVisualEffectView.Material] = [
      "sidebar": .sidebar, "popover": .popover, "menu": .menu, "hud": .hudWindow,
      "header": .headerView, "sheet": .sheet, "window": .windowBackground,
      "underWindow": .underWindowBackground, "content": .contentBackground, "titlebar": .titlebar,
      "tooltip": .toolTip,
    ]
    effect.material = materials[name] ?? .sidebar
  }
  func setBlending(_ name: String) { effect.blendingMode = name == "within" ? .withinWindow : .behindWindow }
  func setActive(_ always: Bool) { effect.state = always ? .active : .followsWindowActiveState }
  func setEmphasized(_ on: Bool) { effect.isEmphasized = on }

  override func setFrameSize(_ size: NSSize) {
    super.setFrameSize(size)
    effect.frame = bounds
    applyShape()
  }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  private func applyShape() {
    effect.layer?.cornerRadius = radius
    effect.layer?.cornerCurve = .continuous
    effect.layer?.masksToBounds = radius > 0
  }
}

// A rounded plate with a border and a real layer shadow. React Native's own
// shadow props do not work on macOS views, so popovers, menus and dialogs
// draw their surface here. Children render above the plate.
final class MerlinSurface: ExpoView {
  // Named apart from RCTView's own layer properties, which they would shadow.
  var plateFill: NSColor? { didSet { needsLayout = true } }
  var plateRadius: Double = 0 { didSet { needsLayout = true } }
  var plateBorderColor: NSColor? { didSet { needsLayout = true } }
  var plateBorderWidth: Double = 0 { didSet { needsLayout = true } }
  var dropColor: NSColor? { didSet { needsLayout = true } }
  var dropOpacity: Double = 0 { didSet { needsLayout = true } }
  var dropRadius: Double = 0 { didSet { needsLayout = true } }
  var dropOffsetY: Double = 0 { didSet { needsLayout = true } }

  private let plate = CALayer()
  private let drop = CALayer()
  private let shadowCutout = CAShapeLayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
  }

  override func layout() {
    super.layout()
    draw()
  }
  override func setFrameSize(_ size: NSSize) {
    super.setFrameSize(size)
    draw()
  }

  private func draw() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if plate.superlayer !== layer {
      layer.insertSublayer(plate, at: 0)
      layer.insertSublayer(drop, below: plate)
      // The shadow is cut out under the plate, so a translucent fill does
      // not show a dark smudge through it.
      shadowCutout.fillRule = .evenOdd
      drop.mask = shadowCutout
    }
    layer.masksToBounds = false
    plate.frame = bounds
    plate.cornerRadius = plateRadius
    plate.cornerCurve = .continuous
    plate.backgroundColor = plateFill?.cgColor
    plate.borderColor = plateBorderColor?.cgColor
    plate.borderWidth = plateBorderWidth

    let outline = CGPath(roundedRect: bounds, cornerWidth: plateRadius, cornerHeight: plateRadius, transform: nil)
    drop.frame = bounds
    if let dropColor, dropOpacity > 0 {
      drop.isHidden = false
      drop.shadowColor = dropColor.cgColor
      drop.shadowOpacity = Float(dropOpacity)
      drop.shadowRadius = dropRadius
      // Flipped views draw downwards; a positive offset always means below.
      drop.shadowOffset = CGSize(width: 0, height: isFlipped || layer.isGeometryFlipped ? dropOffsetY : -dropOffsetY)
      drop.shadowPath = outline
      let reach = dropRadius * 3 + abs(dropOffsetY) + 4
      let mask = CGMutablePath()
      mask.addRect(bounds.insetBy(dx: -reach, dy: -reach))
      mask.addPath(outline)
      shadowCutout.frame = bounds
      shadowCutout.path = mask
    } else {
      drop.isHidden = true
    }
    CATransaction.commit()
  }
}
