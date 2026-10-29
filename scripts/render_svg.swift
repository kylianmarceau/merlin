// Renders an SVG to a square PNG with AppKit (macOS 14+ reads SVG natively).
//   swiftc -O scripts/render_svg.swift -o render_svg
//   render_svg <in.svg> <out.png> <pixels>
import AppKit

let args = CommandLine.arguments
guard args.count == 4, let px = Int(args[3]), px > 0 else {
  FileHandle.standardError.write("usage: render_svg <in.svg> <out.png> <pixels>\n".data(using: .utf8)!)
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
image.draw(in: NSRect(x: 0, y: 0, width: px, height: px))
NSGraphicsContext.restoreGraphicsState()
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
