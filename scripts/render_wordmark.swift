// Composes the shared tile with the existing font-independent Syne mask.
// render_wordmark <tile> <mask.png> <out.png> <height> <ink hex>
import AppKit

let args = CommandLine.arguments
guard args.count == 6, let height = Int(args[4]), height > 0,
      let hex = UInt32(args[5], radix: 16),
      let tile = NSImage(contentsOfFile: args[1]),
      let maskData = try? Data(contentsOf: URL(fileURLWithPath: args[2])),
      let mask = NSBitmapImageRep(data: maskData) else {
  FileHandle.standardError.write(Data("usage: render_wordmark <tile> <mask.png> <out.png> <height> <ink hex>\n".utf8))
  exit(2)
}
let width = Int(Double(mask.pixelsWide) * Double(height) / Double(mask.pixelsHigh))
let rect = NSRect(x: 0, y: 0, width: width, height: height)
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = rect.size
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let image = NSImage(size: NSSize(width: mask.pixelsWide, height: mask.pixelsHigh))
image.addRepresentation(mask)
image.draw(in: rect)
NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
        green: CGFloat((hex >> 8) & 255) / 255,
        blue: CGFloat(hex & 255) / 255, alpha: 1).setFill()
rect.fill(using: .sourceIn)
tile.draw(in: NSRect(x: 0, y: 0, width: height, height: height))
NSGraphicsContext.restoreGraphicsState()
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[3]))
