import AppKit
import ExpoModulesCore

// SF Symbols are native vector assets; the shell supplies their shared color
// and size tokens. They do not introduce an icon font or image download.
final class MerlinSymbolView: ExpoView {
  var symbol = "circle" { didSet { updateImage() } }
  var pointSize: Double = 16 { didSet { updateImage() } }
  var tint = "#000000" { didSet { updateTint() } }
  private let imageView = NSImageView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    imageView.imageScaling = .scaleProportionallyUpOrDown
    imageView.setAccessibilityElement(false)
    addSubview(imageView)
    updateImage()
    updateTint()
  }
  override func layout() {
    super.layout()
    imageView.frame = bounds
  }
  private func updateImage() {
    let size = min(64, max(8, pointSize))
    imageView.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
      .withSymbolConfiguration(.init(pointSize: size, weight: .medium))
  }
  private func updateTint() {
    let value = tint.hasPrefix("#") ? String(tint.dropFirst()) : tint
    guard value.count == 6, let rgb = UInt32(value, radix: 16) else { return }
    imageView.contentTintColor = NSColor(srgbRed: CGFloat((rgb >> 16) & 255) / 255,
      green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: 1)
  }
}
