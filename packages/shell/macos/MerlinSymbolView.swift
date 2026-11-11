import AppKit
import ExpoModulesCore

// SF Symbols are native vector assets; the shell supplies their shared color
// and size tokens. They do not introduce an icon font or image download.
final class MerlinSymbolView: ExpoView {
  var symbol = "circle" { didSet { updateImage() } }
  var pointSize: Double = 16 { didSet { updateImage() } }
  var weight = "medium" { didSet { updateImage() } }
  var tint = "#000000" { didSet { imageView.contentTintColor = ShellColor.parse(tint) } }
  private let imageView = NSImageView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    imageView.imageScaling = .scaleProportionallyUpOrDown
    imageView.setAccessibilityElement(false)
    addSubview(imageView)
    updateImage()
  }
  override func layout() {
    super.layout()
    imageView.frame = bounds
  }
  // Icons never take clicks; the control around them does.
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  private func updateImage() {
    let size = min(64, max(8, pointSize))
    let weights: [String: NSFont.Weight] = ["regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold]
    imageView.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
      .withSymbolConfiguration(.init(pointSize: size, weight: weights[weight] ?? .medium))
  }
}
