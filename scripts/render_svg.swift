// Renders artwork to a square PNG with AppKit (macOS 14+ reads SVG natively).
//   swiftc -O scripts/render_svg.swift -o render_svg
//   render_svg <artwork> <out.png> <pixels> [inset fraction [--falcon-layer]]
import AppKit

let args = CommandLine.arguments
guard (4...6).contains(args.count), let px = Int(args[3]), px > 0,
      let inset = Double(args.count >= 5 ? args[4] : "0"), inset.isFinite, inset < 0.5,
      args.count < 6 || args[5] == "--falcon-layer" else {
  FileHandle.standardError.write(Data("usage: render_svg <artwork> <out.png> <pixels> [inset fraction [--falcon-layer]]\n".utf8))
  exit(2)
}
guard let image = NSImage(contentsOfFile: args[1]) else {
  FileHandle.standardError.write("cannot read \(args[1])\n".data(using: .utf8)!)
  exit(1)
}
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
  bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: px, height: px)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high
let padding = CGFloat(px) * inset
image.draw(in: NSRect(origin: .zero, size: rep.size).insetBy(dx: padding, dy: padding))
NSGraphicsContext.restoreGraphicsState()
if args.count == 6, let data = rep.bitmapData {
  // Ice Blue's cobalt paint has much less green than the pale tile. Keep
  // their antialiased boundary so Icon Composer can tint the separate layers.
  for y in 0..<px {
    for x in 0..<px {
      let offset = y * rep.bytesPerRow + x * 4
      let alpha = Int(data[offset + 3])
      guard alpha > 0 else { continue }
      let green = Int(data[offset + 1]) * 255 / alpha
      let coverage = alpha < 24 ? 0 : min(1, max(0, Double(205 - green) / 45))
      for channel in 0..<4 {
        data[offset + channel] = UInt8((Double(data[offset + channel]) * coverage).rounded())
      }
    }
  }
}
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
